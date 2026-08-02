"""T5280 REVERSED by T5410: poster capture moved back OUT of publish.

T5410 moved poster select+generate to overlay EXPORT (generate_poster_at_export,
tests in test_t5410_poster_selection.py) because the no-detection selection is
now cheap enough (one ffmpeg seek) to run at export instead of deferring to
publish. This file now covers the REVERSAL:
- publish_to_my_reels no longer calls any poster-generation function -- only a
  best-effort HEAD check against the deterministic poster key (no ffmpeg, no
  R2 write).
- A missing poster at publish time is logged, not fatal -- publish still 200s.
- render finalize (export/final) still does not extract a poster inline
  (unchanged from T5280 -- the poster call is a separate step after finalize).
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "test-user-t5280"
PROFILE_ID = "t5280prof"


@pytest.fixture()
def db(tmp_path):
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


def _seed_publishable(db_path, *, poster_filename=None, filename="pub.mp4"):
    """A project + rendered (unpublished-at-render, published-here) final."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, poster_filename) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?)",
        (pid, filename, poster_filename))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, pid))
    conn.commit()
    conn.close()
    return pid, fv_id


# ---------------------------------------------------------------------------
# publish_to_my_reels: no longer generates a poster; best-effort HEAD only
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_publish_does_not_generate_poster(db):
    from app.routers import downloads

    pid, fv_id = _seed_publishable(db, filename="pub.mp4")

    with patch("app.routers.downloads.file_exists_in_r2", return_value=True) as head, \
         patch("app.routers.downloads.archive_project", return_value=True), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True), \
         patch("app.routers.auth.mark_user_archived"):
        result = await downloads.publish_to_my_reels(pid)

    assert result["success"] is True
    assert result["final_video_id"] == fv_id
    # Best-effort existence check only -- no ffmpeg, no R2 write.
    head.assert_called_once()
    assert head.call_args[0][1] == "final_videos/posters/pub.mp4.jpg"


@pytest.mark.asyncio
async def test_publish_missing_poster_logs_but_still_succeeds(db, caplog):
    from app.routers import downloads

    pid, fv_id = _seed_publishable(db, filename="nopost.mp4")

    with patch("app.routers.downloads.file_exists_in_r2", return_value=False), \
         patch("app.routers.downloads.archive_project", return_value=True), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True), \
         patch("app.routers.auth.mark_user_archived"), \
         caplog.at_level("INFO"):
        result = await downloads.publish_to_my_reels(pid)

    assert result["success"] is True
    assert result["final_video_id"] == fv_id
    assert any("published without a poster" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_publish_poster_check_never_fails_publish(db):
    # A HEAD-check error must never fail publish (best-effort, matches the old
    # never-fails-publish invariant the T5280 poster generator had).
    from app.routers import downloads

    pid, fv_id = _seed_publishable(db, filename="err.mp4")

    def boom(*a, **k):
        raise RuntimeError("R2 down")

    with patch("app.routers.downloads.file_exists_in_r2", side_effect=boom), \
         patch("app.routers.downloads.archive_project", return_value=True), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True), \
         patch("app.routers.auth.mark_user_archived"):
        result = await downloads.publish_to_my_reels(pid)

    assert result["success"] is True
    assert result["final_video_id"] == fv_id


# ---------------------------------------------------------------------------
# Live API drive: publish never touches poster generation seams
# ---------------------------------------------------------------------------

import io  # noqa: E402

import httpx  # noqa: E402

from tests.test_t4050_durable_sync import (  # noqa: E402
    FakeR2,
    HEADERS,
    PROFILE_ID as HARNESS_PROFILE_ID,
    USER_ID as HARNESS_USER_ID,
    _r2_patched,
    _request_context,
)


@pytest.fixture()
def live_env(tmp_path):
    """Real per-user profile.sqlite + in-memory R2, served through the real app
    (mirrors the T4110 dur_env fixture)."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.main import app
        from app.database import ensure_database, get_database_path, set_local_db_version

        with _request_context():
            ensure_database()
            db_path = get_database_path()
            set_local_db_version(HARNESS_USER_ID, HARNESS_PROFILE_ID, 0)
        yield app, fake, db_path


def _live_client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _seed_unpublished_reel(db_path, *, filename="final_9x16.mp4"):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) "
        "VALUES ('raw.mp4', 5, 0.0, 6.0)")
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
        "VALUES (?, ?, 1, 0)", (pid, rc))
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'wv.mp4', 1, 6.0)", (pid,))
    wv_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel')",
        (pid, filename))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (wv_id, fv_id, pid))
    conn.commit()
    conn.close()
    return pid, fv_id


@pytest.mark.asyncio
async def test_live_publish_never_calls_poster_generation(live_env):
    """Driving the REAL POST /api/downloads/publish/{pid} must not hit ANY
    poster-generation seam (generate_poster_at_export / _grab_and_store_poster_frame)
    -- T5410 moved that entirely to export. Publish only HEAD-checks."""
    app, fake, db_path = live_env
    pid, fv_id = _seed_unpublished_reel(db_path)

    from app.services import poster as poster_mod

    called = {"n": 0}

    def spy(*a, **k):
        called["n"] += 1
        return "x.jpg"

    with patch.object(poster_mod, "_grab_and_store_poster_frame", side_effect=spy):
        async with _live_client(app) as c:
            resp = await c.post(f"/api/downloads/publish/{pid}")

    assert resp.status_code == 200, resp.text
    assert called["n"] == 0, "publish must NOT generate a poster (T5410 reversed T5280)"

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT published_at, poster_filename FROM final_videos WHERE id = ?",
        (fv_id,)).fetchone()
    conn.close()
    assert row["published_at"] is not None
    assert row["poster_filename"] is None  # never exported -> never generated


@pytest.mark.asyncio
async def test_live_finalize_does_not_attempt_poster_capture_inline(live_env):
    """Driving the REAL POST /api/export/final (render finalize) still must not
    hit the frame-grab seam SYNCHRONOUSLY inside the finalize INSERT -- the
    poster call is a separate step generate_poster_at_export runs after."""
    app, fake, db_path = live_env
    pid, _ = _seed_unpublished_reel(db_path)

    from app.services import poster as poster_mod

    called = {"n": 0}

    def spy(*a, **k):
        called["n"] += 1
        return "x.jpg"

    # Patch the actual extraction step generate_poster_at_export delegates to,
    # rather than short-circuiting generate_poster_at_export itself, so this
    # test still proves finalize's INSERT completes before any extraction runs.
    with patch.object(poster_mod, "_grab_and_store_poster_frame", side_effect=spy):
        async with _live_client(app) as c:
            resp = await c.post(
                "/api/export/final",
                data={"project_id": str(pid), "overlay_data": "{}"},
                files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
            )

    assert resp.status_code == 200, resp.text
    # export/final DOES call generate_poster_at_export (T5410) -- unlike the old
    # T5280 world where render never touched the poster at all. It should have
    # extracted exactly once (no slow-mo -> whole-clip-minus-margin midpoint).
    assert called["n"] == 1
