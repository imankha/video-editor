"""
T16535: archiving a finished project keeps its clips.

Owner ruling (2026-11-16, design option A): archive keeps the working clips
(crop + spotlight data) and the working video, and only marks the project
archived. It writes no msgpack and touches no game video (the game video
leaves on its own paid storage expiry). Projects archived before this change
(rows deleted, msgpack in R2) still reopen through the old restore path.

Drives the real handlers: publish_to_my_reels (publish + archive) and
restore_project_from_archive (the redo/re-edit entry), with R2 replaced by an
in-memory store (same harness as test_t4050_publish_restore_roundtrip.py).
"""

import io
import sqlite3
from unittest.mock import patch

import msgpack
import pytest

USER_ID = "t16535-user"
PROFILE_ID = "testdefault"


class _NoSuchKey(Exception):
    pass


class _FakeR2Client:
    def __init__(self, store, reads):
        self._store = store
        self._reads = reads
        self.exceptions = type("exc", (), {"NoSuchKey": _NoSuchKey})

    def get_object(self, Bucket=None, Key=None):
        self._reads.append(Key)
        if Key not in self._store:
            raise _NoSuchKey(Key)
        return {"Body": io.BytesIO(self._store[Key])}


@pytest.fixture()
def env(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    store = {}  # full_r2_key -> bytes
    reads = []  # every R2 key read through the archive service

    def _fake_upload(user_id, path, data, *, fast=False):
        from app.services import project_archive
        store[project_archive.r2_key(user_id, path)] = bytes(data)
        return True

    def _fake_exists(user_id, path):
        from app.services import project_archive
        return project_archive.r2_key(user_id, path) in store

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        db_path = get_database_path()

        with patch("app.services.project_archive.R2_ENABLED", True), \
             patch("app.services.project_archive.upload_bytes_to_r2", _fake_upload, create=True), \
             patch("app.storage.upload_bytes_to_r2", _fake_upload), \
             patch("app.services.project_archive.get_r2_client",
                   lambda: _FakeR2Client(store, reads)), \
             patch("app.storage.file_exists_in_r2", _fake_exists), \
             patch("app.routers.auth.mark_user_archived", lambda *a, **k: None):
            yield db_path, store, reads


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


GAME_HASH = "b3" * 32


def _seed_published_reel(db_path):
    """Project + 1 working clip (crop + segments) + working video (spotlight) +
    a published final video + the game's paid storage row. Returns
    (project_id, final_video_id, working_video_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Quick Turn', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw1.mp4', 5, 10.0, 20.0, 7, 0)")
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)", (project_id, raw_clip_id, b"\x91\x80", b"\x80"))
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration, effect_type, highlights_data) "
        "VALUES (?, 'wv.mp4', 1, 10.0, 'brightness_boost', ?)", (project_id, b"\x91\x80"))
    working_video_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, duration, "
        " aspect_ratio, clip_count, source_clip_id, published_at) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', 'Quick Turn', 10.0, '9:16', 1, ?, CURRENT_TIMESTAMP)",
        (project_id, raw_clip_id))
    final_video_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, final_video_id, project_id))
    cur.execute(
        "INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
        "VALUES (?, 1000000000, datetime('now', '+20 days'))", (GAME_HASH,))
    conn.commit()
    conn.close()
    return project_id, final_video_id, working_video_id


def _counts(db_path, project_id):
    conn = _connect(db_path)
    wc = conn.execute("SELECT COUNT(*) c FROM working_clips WHERE project_id = ?", (project_id,)).fetchone()["c"]
    wv = conn.execute("SELECT COUNT(*) c FROM working_videos WHERE project_id = ?", (project_id,)).fetchone()["c"]
    proj = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return wc, wv, proj


@pytest.mark.asyncio
async def test_c1_archive_keeps_clips_and_redo_needs_no_restore(env):
    """T16535:C1 - after publish archives the project, its working clips,
    working video and working_video_id are still in the DB, and the redo entry
    (restore-project) reopens it without reading any archive from R2."""
    db_path, _store, reads = env
    from app.routers.downloads import publish_to_my_reels, restore_project_from_archive

    project_id, final_video_id, working_video_id = _seed_published_reel(db_path)
    await publish_to_my_reels(project_id)

    wc, wv, proj = _counts(db_path, project_id)
    assert proj["archived_at"] is not None, "publish must still mark the project archived"
    assert wc == 1, f"archive deleted the working clips (count={wc})"
    assert wv == 1, f"archive deleted the working video (count={wv})"
    assert proj["working_video_id"] == working_video_id, "archive cleared working_video_id"

    result = await restore_project_from_archive(final_video_id)
    assert result == {"project_id": project_id, "restored": False}, result
    assert reads == [], f"redo read an archive from R2: {reads}"
    wc, wv, proj = _counts(db_path, project_id)
    assert (wc, wv) == (1, 1)
    assert proj["archived_at"] is None, "reopening must clear archived_at"
    assert proj["working_video_id"] == working_video_id


@pytest.mark.asyncio
async def test_c2_archive_stores_nothing_and_leaves_game_to_its_expiry(env):
    """T16535:C2 (option A) - archive writes no copy of the project's data to R2
    and does not touch the game's paid storage row: the game video leaves on its
    own expiry through the existing sweep."""
    db_path, store, _reads = env
    from app.services.project_archive import archive_project

    project_id, _, _ = _seed_published_reel(db_path)
    conn = _connect(db_path)
    before = [tuple(r) for r in conn.execute("SELECT * FROM game_storage")]
    conn.close()

    with patch("app.services.project_archive.delete_from_r2") as del_r2:
        assert archive_project(project_id, USER_ID) is True
    assert store == {}, f"archive uploaded to R2: {sorted(store)}"
    del_r2.assert_not_called()

    conn = _connect(db_path)
    after = [tuple(r) for r in conn.execute("SELECT * FROM game_storage")]
    conn.close()
    assert after == before, "archive changed the game's paid storage row"


@pytest.mark.asyncio
async def test_c2_expiry_sweep_removes_archived_projects_game_video(env):
    """T16535:C2 (option A) - once the game's paid storage runs out, the
    existing expiry sweep deletes the game video of an archived project: its
    kept clips and working video do not hold the game video in storage, and
    archive did not extend the paid expiry."""
    db_path, _store, _reads = env
    from app.routers.downloads import publish_to_my_reels
    from app.services.auto_export import ArtifactVerdict
    from app.services.sweep_scheduler import do_sweep

    project_id, _, _ = _seed_published_reel(db_path)
    conn = _connect(db_path)
    conn.execute("INSERT INTO games (id, name, blake3_hash, auto_export_status) "
                 "VALUES (7, 'Game', ?, 'complete')", (GAME_HASH,))
    conn.commit()
    conn.close()
    await publish_to_my_reels(project_id)

    # The 20 paid days run out (time moves; the stored expiry stays as archive left it).
    conn = _connect(db_path)
    conn.execute("UPDATE game_storage SET storage_expires_at = datetime(storage_expires_at, '-21 days')")
    conn.commit()
    conn.close()

    grace = []  # hashes the sweep queued for R2 deletion
    sweep = "app.services.sweep_scheduler"
    with patch(f"{sweep}.get_expiring_ref_profiles", return_value=[(USER_ID, PROFILE_ID)]), \
         patch("app.services.auth_db.get_pg"), \
         patch(f"{sweep}.has_remaining_refs", return_value=False), \
         patch(f"{sweep}.insert_grace_deletion", lambda h, *a: grace.append(h)), \
         patch(f"{sweep}.get_expired_grace_deletions", lambda: list(grace)), \
         patch(f"{sweep}.get_grace_queued_by", return_value=(USER_ID, PROFILE_ID)), \
         patch(f"{sweep}.get_ref_holders", return_value=[]), \
         patch(f"{sweep}.delete_grace_deletion"), \
         patch(f"{sweep}.auto_export_game") as auto_export, \
         patch(f"{sweep}.recap_artifacts_present", return_value=ArtifactVerdict.PRESENT), \
         patch("app.storage.APP_ENV", "production"), \
         patch(f"{sweep}.r2_delete_object_global") as r2_delete:
        do_sweep()

    auto_export.assert_not_called()
    r2_delete.assert_called_once_with(f"games/{GAME_HASH}.mp4")
    conn = _connect(db_path)
    left = conn.execute("SELECT COUNT(*) c FROM game_storage WHERE blake3_hash = ?", (GAME_HASH,)).fetchone()["c"]
    conn.close()
    assert left == 0, "the archived project's game is still stored after its expiry"
    wc, wv, proj = _counts(db_path, project_id)
    assert proj["archived_at"] is not None and (wc, wv) == (1, 1)


def _archive_old_style(db_path, store, project_id):
    """Reproduce what archive_project did before T16535: msgpack the rows to R2,
    then delete them and clear working_video_id."""
    from app.services import project_archive
    conn = _connect(db_path)
    project = dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    clips = [dict(r) for r in conn.execute("SELECT * FROM working_clips WHERE project_id = ?", (project_id,))]
    videos = [dict(r) for r in conn.execute("SELECT * FROM working_videos WHERE project_id = ?", (project_id,))]
    archive = {"version": 2, "archived_at": "2026-11-01T00:00:00Z", "project": project,
               "working_clips": clips, "working_videos": videos}
    store[project_archive.r2_key(USER_ID, f"archive/{project_id}.msgpack")] = msgpack.packb(
        archive, use_bin_type=True, default=str)
    conn.execute("UPDATE projects SET working_video_id = NULL, archived_at = CURRENT_TIMESTAMP WHERE id = ?",
                 (project_id,))
    conn.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
    conn.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_c3_old_archive_still_restores(env):
    """T16535:C3 - a project archived before this change (rows deleted, msgpack
    in R2) still reopens for redo through the existing restore path."""
    db_path, store, _reads = env
    from app.routers.downloads import restore_project_from_archive

    project_id, final_video_id, working_video_id = _seed_published_reel(db_path)
    _archive_old_style(db_path, store, project_id)

    result = await restore_project_from_archive(final_video_id)
    assert result == {"project_id": project_id, "restored": True}, result
    wc, wv, proj = _counts(db_path, project_id)
    assert (wc, wv) == (1, 1), "old archive did not bring the working data back"
    assert proj["working_video_id"] == working_video_id
    assert proj["archived_at"] is None


SHARER_ID = "sharer-user"  # in conftest._TEST_USER_IDS: pg_conn cleans it up


@pytest.fixture()
def gallery_client(pg_conn, tmp_path):
    from fastapi.testclient import TestClient

    from app.services.auth_db import create_user
    from app.session_init import _init_cache

    create_user(SHARER_ID, email="sharer@example.com")
    _init_cache[SHARER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.routers.auth.mark_user_archived", lambda *a, **k: None):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_c4_archived_highlight_keeps_playing_and_its_share_link(gallery_client):
    """T16535:C4 - after publish archives the project, the finished highlight
    still plays from My Reels (the gallery list serves its video URL) and a
    share link to it still resolves to the same video, through the real routes."""
    from app.database import get_database_path
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    headers = {"X-User-ID": SHARER_ID}
    gallery_client.get("/api/downloads", headers=headers)  # creates the profile DB
    set_current_user_id(SHARER_ID)
    set_current_profile_id(PROFILE_ID)
    db_path = get_database_path()
    project_id, final_video_id, _ = _seed_published_reel(db_path)

    resp = gallery_client.post(f"/api/downloads/publish/{project_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    _, _, proj = _counts(db_path, project_id)
    assert proj["archived_at"] is not None, "publish must archive the project"

    def presign(user_id, relative_path, **_kw):
        return f"https://r2.test/{user_id}/{relative_path}"

    with patch("app.routers.downloads.R2_ENABLED", True), \
         patch("app.routers.downloads.generate_presigned_url", presign):
        resp = gallery_client.get("/api/downloads", headers=headers)
    assert resp.status_code == 200, resp.text
    reels = {d["id"]: d for d in resp.json()["downloads"]}
    assert final_video_id in reels, f"archived project's highlight left My Reels: {sorted(reels)}"
    assert reels[final_video_id]["file_url"] == f"https://r2.test/{SHARER_ID}/final_videos/final.mp4"

    resp = gallery_client.post(f"/api/gallery/{final_video_id}/share",
                               json={"recipient_emails": [], "is_public": True}, headers=headers)
    assert resp.status_code == 200, resp.text
    token = resp.json()["shares"][0]["share_token"]
    with patch("app.routers.shares.generate_presigned_url_global", lambda key, **_kw: f"https://r2.test/{key}"):
        resp = gallery_client.get(f"/api/shared/{token}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["video_url"].endswith(
        f"/users/{SHARER_ID}/profiles/{PROFILE_ID}/final_videos/final.mp4"), resp.json()["video_url"]
