"""T4890: Share-link first-frame preview image (poster).

Covers:
- poster key scheme (basename + per-profile rel path)
- real ffmpeg first-frame extraction on a tiny MP4 (test seam)
- generate_and_store_poster: content-type + width/height metadata on upload
- finalize wiring: _finalize_overlay_export freezes poster_filename on the row
  (and is best-effort -- None when generation fails, no crash)
- profile_db v024 migration: adds the column, idempotent
- admin backfill: generate / skip-if-poster-exists / skip-if-video-gone / idempotent
- share resolution: _resolve_poster emits (url,w,h) only when the object exists
- moved reels carry poster_filename AND the poster object rides the copy list
"""

import shutil
import sqlite3
import subprocess
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.poster import (
    backfill_posters,
    generate_and_store_poster,
    poster_basename,
    poster_rel_path,
)

USER_ID = "test-user-t4890"
PROFILE_ID = "t4890prof"

_HAS_FFMPEG = shutil.which("ffmpeg") is not None


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path):
    """A real ensure_database() profile DB (canonical schema incl. poster_filename)."""
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _tiny_mp4(path):
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
         "-frames:v", "15", str(path)],
        capture_output=True, check=True,
    )
    return str(path)


# ---------------------------------------------------------------------------
# Key scheme
# ---------------------------------------------------------------------------

def test_poster_key_scheme():
    assert poster_basename("reel_ab12.mp4") == "reel_ab12.mp4.jpg"
    assert poster_rel_path("reel_ab12.mp4.jpg") == "final_videos/posters/reel_ab12.mp4.jpg"


# ---------------------------------------------------------------------------
# Real ffmpeg first-frame extraction
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
def test_extract_first_frame_real(tmp_path):
    mp4 = _tiny_mp4(tmp_path / "clip.mp4")
    out = tmp_path / "poster.jpg"
    assert poster_mod.extract_first_frame_jpeg(mp4, str(out)) is True
    assert out.exists() and out.stat().st_size > 0
    assert poster_mod._jpeg_dimensions(str(out)) == (320, 240)


@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
def test_extract_first_frame_bad_source(tmp_path):
    out = tmp_path / "poster.jpg"
    assert poster_mod.extract_first_frame_jpeg(str(tmp_path / "nope.mp4"), str(out)) is False


# ---------------------------------------------------------------------------
# generate_and_store_poster: metadata + content type
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _HAS_FFMPEG, reason="ffmpeg not available")
def test_generate_and_store_poster_sets_content_type_and_dims(tmp_path):
    mp4 = _tiny_mp4(tmp_path / "clip.mp4")
    captured = {}

    def fake_upload(user_id, rel_path, data, *, fast=False, content_type=None, metadata=None):
        captured.update(rel_path=rel_path, content_type=content_type, metadata=metadata, size=len(data))
        return True

    with patch.object(poster_mod, "generate_presigned_url", return_value=mp4), \
         patch.object(poster_mod, "upload_bytes_to_r2", side_effect=fake_upload):
        basename = generate_and_store_poster(USER_ID, "reel_x.mp4")

    assert basename == "reel_x.mp4.jpg"
    assert captured["rel_path"] == "final_videos/posters/reel_x.mp4.jpg"
    assert captured["content_type"] == "image/jpeg"
    assert captured["metadata"] == {"width": 320, "height": 240}
    assert captured["size"] > 0


def test_generate_and_store_poster_no_url_returns_none():
    with patch.object(poster_mod, "generate_presigned_url", return_value=None):
        assert generate_and_store_poster(USER_ID, "reel_x.mp4") is None


# ---------------------------------------------------------------------------
# Finalize wiring: poster_filename frozen on the row
# ---------------------------------------------------------------------------

def _seed_project(db_path, name="My Reel", aspect="9:16", duration=12.0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)", (name, aspect))
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'wv.mp4', 1, ?)", (pid, duration))
    cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (cur.lastrowid, pid))
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) "
        "VALUES ('c.mp4', 5, 0.0, 5.0)")
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
        "VALUES (?, ?, 1, 0)", (pid, rc))
    cur.execute(
        "INSERT INTO export_jobs (id, project_id, type, input_data) "
        "VALUES ('expP', ?, 'overlay', x'00')", (pid,))
    conn.commit()
    conn.close()
    return pid


def test_finalize_freezes_poster_filename(db):
    from app.routers.export import overlay
    pid = _seed_project(db)
    with patch("app.analytics.record_milestone"), \
         patch.object(overlay, "generate_and_store_poster", return_value="out.mp4.jpg"):
        fv_id = overlay._finalize_overlay_export(pid, "out.mp4", "expP", USER_ID)
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    assert row["poster_filename"] == "out.mp4.jpg"


def test_finalize_best_effort_when_no_poster(db):
    from app.routers.export import overlay
    pid = _seed_project(db)
    with patch("app.analytics.record_milestone"), \
         patch.object(overlay, "generate_and_store_poster", return_value=None):
        fv_id = overlay._finalize_overlay_export(pid, "out.mp4", "expP", USER_ID)
    row = _connect(db).execute(
        "SELECT poster_filename FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    assert row["poster_filename"] is None


# ---------------------------------------------------------------------------
# v024 migration
# ---------------------------------------------------------------------------

def _pre_poster_db(path):
    """A profile DB whose final_videos table PREDATES the poster_filename column."""
    conn = sqlite3.connect(str(path))  # tuple row factory, like the real runner
    conn.execute("""
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            published_at TIMESTAMP
        )
    """)
    conn.execute("INSERT INTO final_videos (filename, published_at) VALUES ('r.mp4', CURRENT_TIMESTAMP)")
    conn.execute("PRAGMA user_version = 23")
    conn.commit()
    return conn


def test_v024_adds_column_and_is_idempotent(tmp_path):
    from app.migrations.profile_db import RUNNER

    path = tmp_path / "profile.sqlite"
    conn = _pre_poster_db(path)

    def _cols():
        return {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}

    assert "poster_filename" not in _cols()
    applied = RUNNER.run(conn, "profile_db")
    assert 24 in [m.version for m in applied]
    assert "poster_filename" in _cols()
    # v25+ also apply from this below-head DB (v23) -> DB lands at head.
    assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version

    # Re-run: nothing pending, column stays, no error.
    assert RUNNER.run(conn, "profile_db") == []
    assert "poster_filename" in _cols()
    conn.close()


# ---------------------------------------------------------------------------
# Admin backfill
# ---------------------------------------------------------------------------

def test_backfill_generates_heals_skips_and_is_idempotent(db):
    conn = _connect(db)
    # r1: needs generation (video present, no poster)
    # r2: poster already exists in R2 -> heal column only
    # r3: video gone -> skipped
    # r4: unpublished -> never a candidate
    conn.executemany(
        "INSERT INTO final_videos (id, filename, published_at) VALUES (?, ?, ?)",
        [(1, "r1.mp4", "2026-01-01"), (2, "r2.mp4", "2026-01-01"),
         (3, "r3.mp4", "2026-01-01")],
    )
    conn.execute("INSERT INTO final_videos (id, filename, published_at) VALUES (4, 'r4.mp4', NULL)")
    conn.commit()
    conn.close()

    def fake_exists(user_id, rel_path):
        if rel_path == "final_videos/posters/r2.mp4.jpg":
            return True   # r2 poster already present
        if rel_path == "final_videos/r3.mp4":
            return False  # r3 video gone
        return rel_path.startswith("final_videos/") and not rel_path.startswith("final_videos/posters/")

    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch.object(poster_mod, "generate_and_store_poster", return_value="r1.mp4.jpg") as gen, \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        res = backfill_posters(limit=25, dry_run=False)

    assert set(res["generated"]) == {1}
    assert set(res["already_present"]) == {2}
    assert set(res["skipped_gone"]) == {3}
    # T5090: backfill now resolves + passes the reel's frozen/reconstructed slow-mo
    # section. r1 has no project rows here (unreconstructable) -> None (first frame).
    gen.assert_called_once_with(USER_ID, "r1.mp4", None)

    # Columns healed/set for r1 + r2.
    rows = {r["id"]: r["poster_filename"]
            for r in _connect(db).execute("SELECT id, poster_filename FROM final_videos").fetchall()}
    assert rows[1] == "r1.mp4.jpg"
    assert rows[2] == "r2.mp4.jpg"
    assert rows[3] is None and rows[4] is None

    # Idempotent: a second run finds no NULL-poster published candidates for r1/r2.
    with patch("app.services.auth_db.get_all_users_for_admin", return_value=[{"user_id": USER_ID}]), \
         patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
         patch("app.storage.file_exists_in_r2", side_effect=fake_exists), \
         patch.object(poster_mod, "generate_and_store_poster", return_value="x") as gen2, \
         patch("app.database.sync_db_to_r2_explicit", return_value=True):
        res2 = backfill_posters(limit=25, dry_run=False)
    assert res2["generated"] == [] and res2["already_present"] == []
    assert set(res2["skipped_gone"]) == {3}  # r3 still a NULL candidate, still gone
    gen2.assert_not_called()


# ---------------------------------------------------------------------------
# Share resolution
# ---------------------------------------------------------------------------

def _share(filename="reel_z.mp4"):
    return {
        "share_token": "tok123",
        "sharer_user_id": USER_ID,
        "sharer_profile_id": PROFILE_ID,
        "video_filename": filename,
    }


def test_resolve_poster_present():
    from app.routers import shares
    with patch.object(shares, "r2_head_object_global",
                      return_value={"Metadata": {"width": "1080", "height": "1920"}}):
        url, w, h = shares._resolve_poster(_share())
    # STABLE relative proxy path, never a presigned URL: crawlers refetch
    # og:image after the signature would have expired (bug found live on
    # staging - unfurl tools showed no image).
    assert url == "/api/shared/tok123/poster.jpg"
    assert (w, h) == (1080, 1920)


def test_resolve_poster_absent_omits():
    from app.routers import shares
    with patch.object(shares, "r2_head_object_global", return_value=None):
        url, w, h = shares._resolve_poster(_share())
    assert (url, w, h) == (None, None, None)


def test_resolve_poster_present_without_dims():
    from app.routers import shares
    with patch.object(shares, "r2_head_object_global", return_value={"Metadata": {}}):
        url, w, h = shares._resolve_poster(_share())
    assert url == "/api/shared/tok123/poster.jpg"
    assert (w, h) == (None, None)


def test_poster_endpoint_serves_jpeg_with_cache_header():
    import asyncio
    from unittest.mock import MagicMock

    from app.routers import shares

    share = {**_share(), "revoked_at": None}
    fake_resp = MagicMock(status_code=200, content=b"\xff\xd8jpegbytes")

    class _FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url): return fake_resp

    import httpx
    with patch.object(shares, "get_share_by_token", return_value=share), \
         patch.object(shares, "r2_head_object_global", return_value={"Metadata": {}}), \
         patch.object(shares, "generate_presigned_url_global", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _FakeClient):
        resp = asyncio.run(shares.get_shared_poster("tok123"))
    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "public, max-age=86400"
    assert resp.body == b"\xff\xd8jpegbytes"


def test_poster_endpoint_404_when_absent_or_revoked():
    import asyncio

    import pytest
    from fastapi import HTTPException

    from app.routers import shares

    with patch.object(shares, "get_share_by_token", return_value=None):
        with pytest.raises(HTTPException) as e:
            asyncio.run(shares.get_shared_poster("tok123"))
        assert e.value.status_code == 404

    share = {**_share(), "revoked_at": "2026-07-12"}
    with patch.object(shares, "get_share_by_token", return_value=share):
        with pytest.raises(HTTPException) as e:
            asyncio.run(shares.get_shared_poster("tok123"))
        assert e.value.status_code == 404

    live = {**_share(), "revoked_at": None}
    with patch.object(shares, "get_share_by_token", return_value=live), \
         patch.object(shares, "r2_head_object_global", return_value=None):
        with pytest.raises(HTTPException) as e:
            asyncio.run(shares.get_shared_poster("tok123"))
        assert e.value.status_code == 404


def test_build_poster_r2_key():
    from app.routers import shares
    key = shares._build_poster_r2_key(_share("reel_z.mp4"))
    assert key.endswith(f"/users/{USER_ID}/profiles/{PROFILE_ID}/final_videos/posters/reel_z.mp4.jpg")


# ---------------------------------------------------------------------------
# Moved reels carry the poster (T4850 x T4890)
# ---------------------------------------------------------------------------

def test_moved_reel_carries_poster_and_copies_object(tmp_path):
    import asyncio

    from app.profile_context import set_current_profile_id
    from app.services import user_db as user_db_mod
    from app.user_context import set_current_req_id, set_current_user_id

    U, SRC, DST = "test-user-t4890-move", "srcp4890", "dstp4890"
    set_current_user_id(U)
    set_current_req_id("req-t4890-move")

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.materialization.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database
        from app.routers import downloads
        from app.routers.downloads import MoveToProfileRequest, move_reels_to_profile

        user_db_mod.create_profile(U, SRC, "A", "#f00", is_default=True)
        user_db_mod.create_profile(U, DST, "B", "#00f")
        for pid in (SRC, DST):
            set_current_profile_id(pid)
            ensure_database()
        set_current_profile_id(SRC)

        src_db = tmp_path / U / "profiles" / SRC / "profile.sqlite"
        c = sqlite3.connect(str(src_db))
        c.execute(
            "INSERT INTO final_videos (id, filename, version, published_at, poster_filename, rating) "
            "VALUES (9100, 'reelm.mp4', 1, '2026-01-01', 'reelm.mp4.jpg', NULL)")
        c.commit()
        c.close()

        copied: list[str] = []
        with patch.object(downloads, "copy_profile_object",
                          side_effect=lambda u, s, t, rel: (copied.append(rel), True)[1]), \
             patch.object(downloads, "profile_object_exists", return_value=True), \
             patch.object(downloads, "delete_profile_object", return_value=True):
            asyncio.run(move_reels_to_profile(
                MoveToProfileRequest(video_ids=[9100], target_profile_id=DST), _durable=None))

        # BOTH the video and its poster object are relocated to the target prefix.
        assert "final_videos/reelm.mp4" in copied
        assert "final_videos/posters/reelm.mp4.jpg" in copied

        dst_db = tmp_path / U / "profiles" / DST / "profile.sqlite"
        ct = sqlite3.connect(str(dst_db))
        ct.row_factory = sqlite3.Row
        moved = ct.execute(
            "SELECT poster_filename FROM final_videos WHERE filename='reelm.mp4'").fetchone()
        ct.close()
        assert moved["poster_filename"] == "reelm.mp4.jpg"

        # --- Second reel: poster_filename set but object MISSING -> move still
        # succeeds (best-effort), poster NOT copied, target ref nulled (no dangle).
        set_current_profile_id(SRC)
        c2 = sqlite3.connect(str(src_db))
        c2.execute(
            "INSERT INTO final_videos (id, filename, version, published_at, poster_filename, rating) "
            "VALUES (9200, 'reeln.mp4', 1, '2026-01-01', 'reeln.mp4.jpg', NULL)")
        c2.commit()
        c2.close()

        copied2: list[str] = []
        with patch.object(downloads, "copy_profile_object",
                          side_effect=lambda u, s, t, rel: (copied2.append(rel), True)[1]), \
             patch.object(downloads, "profile_object_exists", return_value=False), \
             patch.object(downloads, "delete_profile_object", return_value=True):
            asyncio.run(move_reels_to_profile(
                MoveToProfileRequest(video_ids=[9200], target_profile_id=DST), _durable=None))

        assert "final_videos/reeln.mp4" in copied2          # video moved
        assert "final_videos/posters/reeln.mp4.jpg" not in copied2  # poster skipped
        ct2 = sqlite3.connect(str(dst_db))
        ct2.row_factory = sqlite3.Row
        moved2 = ct2.execute(
            "SELECT poster_filename FROM final_videos WHERE filename='reeln.mp4'").fetchone()
        ct2.close()
        assert moved2["poster_filename"] is None


# ---------------------------------------------------------------------------
# Clearest-frame selection (unfurl audit follow-up)
# ---------------------------------------------------------------------------

def test_clearest_frame_skips_blurry_opening(tmp_path):
    """A clip whose opening is black and whose middle has detail must NOT
    poster the black frame. JPEG-size heuristic: detail encodes larger."""
    import subprocess

    from app.services import poster as poster_mod

    src = str(tmp_path / "clip.mp4")
    # 1s black, then 2s of detailed test pattern
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", "color=black:s=320x240:d=1",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
         "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]",
         "-map", "[v]", src],
        capture_output=True, check=True, timeout=60,
    )
    out = str(tmp_path / "poster.jpg")
    assert poster_mod.extract_clearest_frame_jpeg(src, out)

    first = str(tmp_path / "first.jpg")
    assert poster_mod.extract_first_frame_jpeg(src, first)

    from pathlib import Path
    # The selected frame must be substantially richer than the black opener.
    assert Path(out).stat().st_size > Path(first).stat().st_size * 2


def test_clearest_frame_falls_back_when_probe_fails(tmp_path, monkeypatch):
    from app.services import poster as poster_mod

    monkeypatch.setattr(poster_mod, "_probe_duration", lambda source: None)
    called = {}

    def fake_first(source, output_path):
        called["yes"] = True
        return True

    monkeypatch.setattr(poster_mod, "extract_first_frame_jpeg", fake_first)
    assert poster_mod.extract_clearest_frame_jpeg("whatever.mp4", str(tmp_path / "o.jpg"))
    assert called.get("yes")
