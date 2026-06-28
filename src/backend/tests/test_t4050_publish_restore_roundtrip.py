"""
T4050 STEP 1 — Publish/Restore round-trip idempotency (isolation harness).

Goal: isolate the publish/unpublish/archive/restore round-trip from the
reframe/framing-export path. If editing a published reel and re-publishing it
(with NO content changes) is itself lossy or non-idempotent, the bug lives in
archive/restore and we'd see it here BEFORE reframing is ever involved.

The two gestures the UI fires, exercised directly against the real handlers:
  - Edit ............ POST /api/downloads/{id}/restore-project
                      -> restore_project_from_archive (unpublish + restore working data)
  - Move to My Reels  POST /api/downloads/publish/{project_id}
                      -> publish_to_my_reels (publish + archive working data)

R2 is replaced with an in-memory store so the *full* archive->restore round-trip
actually runs (the existing archive/restore tests skip when R2 is disabled).

If this test PASSES, the round trip is clean and the reframe-never-materializes
bug is downstream in the framing-export / source-extraction path (see
test file docstring in test_t4010_reexport_in_place.py and the T4050 task file).
If it FAILS, capture exactly what diverges on which cycle.
"""

import io
import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t4050-user"
PROFILE_ID = "testdefault"

N_CYCLES = 4  # >= 3 required by the isolation strategy


# ---------------------------------------------------------------------------
# In-memory R2 fake: archive_project uploads msgpack here; restore reads it back.
# ---------------------------------------------------------------------------

class _NoSuchKey(Exception):
    pass


class _FakeR2Client:
    def __init__(self, store):
        self._store = store
        self.exceptions = type("exc", (), {"NoSuchKey": _NoSuchKey})

    def get_object(self, Bucket=None, Key=None):
        if Key not in self._store:
            raise _NoSuchKey(Key)
        return {"Body": io.BytesIO(self._store[Key])}


@pytest.fixture()
def env(tmp_path):
    """Real profile DB (via ensure_database) + in-memory R2 patched into the
    archive service so the full archive->restore round-trip executes."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    store = {}  # full_r2_key -> bytes

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
             patch("app.services.project_archive.upload_bytes_to_r2", _fake_upload), \
             patch("app.services.project_archive.get_r2_client",
                   lambda: _FakeR2Client(store)), \
             patch("app.storage.file_exists_in_r2", _fake_exists), \
             patch("app.routers.auth.mark_user_archived", lambda *a, **k: None):
            yield db_path, store


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_published_reel(db_path):
    """A realistic published reel: project + 1 working clip (crop+segments) +
    working video (overlay) + a published final_video, pointers wired.
    Returns (project_id, final_video_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Brilliant Dribble', '9:16')")
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw56.mp4', 5, 3566.0, 3625.0, 7, 0)")
    raw_clip_id = cur.lastrowid

    cur.execute(
        "INSERT INTO working_clips "
        "(project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)",
        (project_id, raw_clip_id, b"\x91\x80", b"\x80"))

    cur.execute(
        "INSERT INTO working_videos "
        "(project_id, filename, version, duration, effect_type, overlay_version) "
        "VALUES (?, 'wv_9x16.mp4', 1, 59.4, 'brightness_boost', 3)",
        (project_id,))
    working_video_id = cur.lastrowid

    cur.execute(
        "INSERT INTO final_videos "
        "(project_id, filename, version, source_type, name, duration, aspect_ratio, "
        " clip_count, rating, rd, match_count, source_clip_id, published_at) "
        "VALUES (?, 'final_9x16.mp4', 1, 'custom_project', 'Brilliant Dribble', 59.4, "
        " '9:16', 1, 1500.0, 350.0, 0, ?, CURRENT_TIMESTAMP)",
        (project_id, raw_clip_id))
    final_video_id = cur.lastrowid

    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (working_video_id, final_video_id, project_id))
    conn.commit()
    conn.close()
    return project_id, final_video_id


# Content columns whose values must be invariant across cycles (timestamps excluded).
_FINAL_COLS = ("id", "version", "aspect_ratio", "filename", "duration",
               "source_clip_id", "clip_count", "rating", "rd", "match_count",
               "name", "game_ids")
_WCLIP_COLS = ("id", "project_id", "raw_clip_id", "version", "sort_order",
               "crop_data", "segments_data")
_WVIDEO_COLS = ("id", "project_id", "filename", "version", "duration",
                "effect_type", "overlay_version", "highlights_data")


def _published_snapshot(db_path, project_id, store):
    """State that must be identical every time the reel is back in My Reels."""
    conn = _connect(db_path)
    finals = [tuple(r[c] for c in _FINAL_COLS) for r in conn.execute(
        "SELECT * FROM final_videos WHERE project_id = ? ORDER BY version", (project_id,))]
    published_flags = [r["published_at"] is not None for r in conn.execute(
        "SELECT published_at FROM final_videos WHERE project_id = ? ORDER BY version", (project_id,))]
    proj = conn.execute(
        "SELECT working_video_id, final_video_id, archived_at FROM projects WHERE id = ?",
        (project_id,)).fetchone()
    wc = conn.execute("SELECT COUNT(*) c FROM working_clips WHERE project_id = ?", (project_id,)).fetchone()["c"]
    wv = conn.execute("SELECT COUNT(*) c FROM working_videos WHERE project_id = ?", (project_id,)).fetchone()["c"]
    conn.close()
    return {
        "finals": finals,
        "all_published": all(published_flags) and len(published_flags) > 0,
        "final_video_id": proj["final_video_id"],
        "working_video_id_is_null": proj["working_video_id"] is None,
        "archived": proj["archived_at"] is not None,
        "working_clips_count": wc,
        "working_videos_count": wv,
        "r2_keys": sorted(store.keys()),
    }


def _restored_snapshot(db_path, project_id):
    """Working data that must be faithfully restored every Edit."""
    conn = _connect(db_path)
    wclips = [tuple(r[c] for c in _WCLIP_COLS) for r in conn.execute(
        "SELECT * FROM working_clips WHERE project_id = ? ORDER BY version, sort_order", (project_id,))]
    wvideos = [tuple(r[c] for c in _WVIDEO_COLS) for r in conn.execute(
        "SELECT * FROM working_videos WHERE project_id = ? ORDER BY version", (project_id,))]
    proj = conn.execute(
        "SELECT working_video_id, final_video_id, archived_at FROM projects WHERE id = ?",
        (project_id,)).fetchone()
    any_published = conn.execute(
        "SELECT COUNT(*) c FROM final_videos WHERE project_id = ? AND published_at IS NOT NULL",
        (project_id,)).fetchone()["c"]
    conn.close()
    return {
        "working_clips": wclips,
        "working_videos": wvideos,
        "working_video_id": proj["working_video_id"],
        "final_video_id": proj["final_video_id"],
        "archived": proj["archived_at"] is not None,
        "any_published": any_published,
    }


@pytest.mark.asyncio
async def test_publish_restore_roundtrip_is_idempotent(env):
    """Edit (restore) -> Move to My Reels (publish), N times, NO content changes.
    Every cycle must return EXACTLY to the original published+archived state, and
    every Edit must faithfully restore the same working data."""
    db_path, store = env

    from app.routers.downloads import publish_to_my_reels, restore_project_from_archive

    project_id, final_video_id = _seed_published_reel(db_path)

    # Bring the seed to the canonical "in My Reels" state: published + archived
    # (this is how a published reel actually sits — working data lives only in R2).
    await publish_to_my_reels(project_id)

    original_published = _published_snapshot(db_path, project_id, store)
    assert original_published["all_published"], "seed reel should be published"
    assert original_published["archived"], "published reel should be archived"
    assert original_published["working_clips_count"] == 0, "archive should delete working_clips from DB"
    assert original_published["working_videos_count"] == 0, "archive should delete working_videos from DB"

    original_restored = None
    divergences = []

    for cycle in range(1, N_CYCLES + 1):
        # --- Edit: restore project to Drafts ---
        await restore_project_from_archive(final_video_id)
        restored = _restored_snapshot(db_path, project_id)

        assert restored["working_clips"], f"cycle {cycle}: Edit restored ZERO working_clips (data lost)"
        assert restored["working_videos"], f"cycle {cycle}: Edit restored ZERO working_videos (data lost)"
        assert not restored["archived"], f"cycle {cycle}: archived_at not cleared on restore"
        assert restored["any_published"] == 0, f"cycle {cycle}: restore (Edit) must unpublish the reel"

        if original_restored is None:
            original_restored = restored
        elif restored != original_restored:
            divergences.append((cycle, "restored", original_restored, restored))

        # --- Move to My Reels: publish + archive ---
        await publish_to_my_reels(project_id)
        published = _published_snapshot(db_path, project_id, store)

        if published != original_published:
            divergences.append((cycle, "published", original_published, published))

    assert not divergences, (
        "Round trip is NON-IDEMPOTENT. Divergences (cycle, phase):\n" +
        "\n".join(
            f"  cycle {c} [{phase}]:\n    orig={orig}\n    got ={got}"
            for c, phase, orig, got in divergences
        )
    )
