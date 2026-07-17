"""T5280: capture the share poster at PUBLISH ("Move to My Reels"), not at render.

Covers:
- Render finalize freezes the slow-mo section but does NOT extract a poster
  (poster_filename stays NULL) -- both overlay finalize paths.
- generate_poster_at_publish: prefers the frozen section columns; reconstructs +
  heals when unfrozen (live working_clips); no slow-mo -> first frame; sets
  final_videos.poster_filename; never raises (best effort); idempotent overwrite.
- publish_to_my_reels captures the poster BEFORE archive_project, passing the
  row's frozen section columns; poster failure never fails publish (still 200).
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services import poster as poster_mod
from app.services.poster import generate_poster_at_publish
from app.utils.encoding import encode_data

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


def _seed_published_final(db_path, *, frozen=None, filename="reel.mp4"):
    """A published final_videos row with optional frozen slow-mo columns."""
    conn = _connect(db_path)
    cur = conn.cursor()
    start, end = (frozen if frozen else (None, None))
    cur.execute(
        "INSERT INTO final_videos (filename, version, published_at, "
        "slowmo_section_start, slowmo_section_end) "
        "VALUES (?, 1, '2026-01-01', ?, ?)",
        (filename, start, end),
    )
    fv_id = cur.lastrowid
    conn.commit()
    conn.close()
    return fv_id


def _seed_project_with_clips(db_path, segments, *, filename="r.mp4", raw_end=6.0):
    """A project with live working_clips + a published final referencing it
    (slow-mo section left UNFROZEN so the helper must reconstruct)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) "
        "VALUES ('c.mp4', 5, 0.0, ?)", (raw_end,))
    rc = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
        "VALUES (?, ?, 1, 0, ?)", (pid, rc, encode_data(segments)))
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, published_at) "
        "VALUES (?, ?, 1, '2026-01-01')", (pid, filename))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, pid))
    conn.commit()
    conn.close()
    return pid, fv_id


def _poster_col(db_path, fv_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT poster_filename, slowmo_section_start, slowmo_section_end "
        "FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    conn.close()
    return row


# ---------------------------------------------------------------------------
# generate_poster_at_publish: section resolution + poster_filename write
# ---------------------------------------------------------------------------

def test_publish_helper_prefers_frozen_section(db):
    fv_id = _seed_published_final(db, frozen=(1.5, 5.5), filename="f.mp4")
    seen = {}

    def capture(user_id, filename, slowmo_section=None):
        seen["section"] = slowmo_section
        seen["filename"] = filename
        return "f.mp4.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=capture), \
         patch.object(poster_mod, "resolve_slowmo_section") as reconstruct:
        res = generate_poster_at_publish(USER_ID, fv_id, "f.mp4", 500, 1.5, 5.5)

    assert res == "f.mp4.jpg"
    assert seen["section"] == (1.5, 5.5)     # frozen columns used verbatim
    assert seen["filename"] == "f.mp4"
    reconstruct.assert_not_called()          # frozen wins -> no reconstruction
    assert _poster_col(db, fv_id)["poster_filename"] == "f.mp4.jpg"


def test_publish_helper_reconstructs_and_heals_when_unfrozen(db):
    # NULL frozen columns + live working_clips (present at publish, before archive):
    # reconstruct the section, pass it to the generator, AND heal the frozen columns.
    segments = {"boundaries": [0, 2, 4, 6], "segmentSpeeds": {"1": 0.5}}
    pid, fv_id = _seed_project_with_clips(db, segments, filename="r.mp4")
    seen = {}

    def capture(user_id, filename, slowmo_section=None):
        seen["section"] = slowmo_section
        return "r.mp4.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=capture):
        res = generate_poster_at_publish(USER_ID, fv_id, "r.mp4", pid, None, None)

    assert res == "r.mp4.jpg"
    assert seen["section"] == (2.0, 6.0)     # reconstructed from live working_clips
    row = _poster_col(db, fv_id)
    assert row["poster_filename"] == "r.mp4.jpg"
    assert (row["slowmo_section_start"], row["slowmo_section_end"]) == (2.0, 6.0)  # healed


def test_publish_helper_no_slowmo_uses_first_frame(db):
    # No slow-mo in live clips + NULL frozen -> section None (plain first frame),
    # but the poster is still captured + the column set.
    segments = {"boundaries": [0, 6], "segmentSpeeds": {}}
    pid, fv_id = _seed_project_with_clips(db, segments, filename="p.mp4")
    seen = {}

    def capture(user_id, filename, slowmo_section=None):
        seen["section"] = slowmo_section
        return "p.mp4.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=capture):
        res = generate_poster_at_publish(USER_ID, fv_id, "p.mp4", pid, None, None)

    assert res == "p.mp4.jpg"
    assert seen["section"] is None
    row = _poster_col(db, fv_id)
    assert row["poster_filename"] == "p.mp4.jpg"
    assert (row["slowmo_section_start"], row["slowmo_section_end"]) == (None, None)


def test_publish_helper_never_raises_on_generation_error(db):
    # Poster generation raising must NOT propagate (publish invariant) and must
    # leave poster_filename untouched.
    fv_id = _seed_published_final(db, frozen=(1.0, 3.0), filename="e.mp4")

    def boom(*a, **k):
        raise RuntimeError("ffmpeg exploded")

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=boom):
        res = generate_poster_at_publish(USER_ID, fv_id, "e.mp4", 1, 1.0, 3.0)

    assert res is None
    assert _poster_col(db, fv_id)["poster_filename"] is None


def test_publish_helper_generation_returns_none(db):
    # Generation returning None (e.g. R2 presign failed) -> None, column stays NULL.
    fv_id = _seed_published_final(db, frozen=(1.0, 3.0), filename="n.mp4")
    with patch.object(poster_mod, "generate_and_store_poster", return_value=None):
        res = generate_poster_at_publish(USER_ID, fv_id, "n.mp4", 1, 1.0, 3.0)
    assert res is None
    assert _poster_col(db, fv_id)["poster_filename"] is None


def test_publish_helper_idempotent_overwrite(db):
    # Re-publish (unpublish -> publish again) captures at the SAME deterministic
    # key each time -- overwrite in place, same policy -> same basename.
    fv_id = _seed_published_final(db, frozen=(1.0, 3.0), filename="i.mp4")
    calls = []

    def capture(user_id, filename, slowmo_section=None):
        calls.append((filename, slowmo_section))
        return "i.mp4.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=capture):
        first = generate_poster_at_publish(USER_ID, fv_id, "i.mp4", 1, 1.0, 3.0)
        second = generate_poster_at_publish(USER_ID, fv_id, "i.mp4", 1, 1.0, 3.0)

    assert first == second == "i.mp4.jpg"
    assert calls == [("i.mp4", (1.0, 3.0)), ("i.mp4", (1.0, 3.0))]  # deterministic
    assert _poster_col(db, fv_id)["poster_filename"] == "i.mp4.jpg"


# ---------------------------------------------------------------------------
# publish_to_my_reels: captures the poster BEFORE archive; never fails publish
# ---------------------------------------------------------------------------

def _seed_publishable(db_path, *, frozen=None, filename="pub.mp4"):
    """A project + rendered (unpublished-at-render, published-here) final."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    pid = cur.lastrowid
    start, end = (frozen if frozen else (None, None))
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "slowmo_section_start, slowmo_section_end) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?)",
        (pid, filename, start, end))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, pid))
    conn.commit()
    conn.close()
    return pid, fv_id


@pytest.mark.asyncio
async def test_publish_captures_poster_before_archive(db):
    from app.routers import downloads

    pid, fv_id = _seed_publishable(db, frozen=(2.0, 6.0), filename="pub.mp4")
    order = []

    def fake_poster(user_id, final_video_id, final_filename, project_id, fs, fe):
        order.append(("poster", final_video_id, final_filename, project_id, fs, fe))
        return "pub.mp4.jpg"

    def fake_archive(project_id, user_id):
        order.append(("archive", project_id))
        return True

    with patch.object(downloads, "generate_poster_at_publish", side_effect=fake_poster), \
         patch("app.routers.downloads.archive_project", side_effect=fake_archive), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True), \
         patch("app.routers.auth.mark_user_archived"):
        result = await downloads.publish_to_my_reels(pid)

    assert result["success"] is True
    assert result["final_video_id"] == fv_id
    # Poster capture ran BEFORE archive, with the row's frozen section columns.
    assert order[0] == ("poster", fv_id, "pub.mp4", pid, 2.0, 6.0)
    assert order[1] == ("archive", pid)


@pytest.mark.asyncio
async def test_publish_poster_failure_still_returns_200(db):
    # A poster generation error inside the helper must never fail publish.
    from app.routers import downloads

    pid, fv_id = _seed_publishable(db, frozen=(1.0, 3.0), filename="pf.mp4")

    def boom(*a, **k):
        raise RuntimeError("ffmpeg died")

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=boom), \
         patch("app.routers.downloads.archive_project", return_value=False), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        result = await downloads.publish_to_my_reels(pid)

    assert result["success"] is True
    assert result["final_video_id"] == fv_id
    # published_at still set despite the poster failure.
    conn = _connect(db)
    published = conn.execute(
        "SELECT published_at, poster_filename FROM final_videos WHERE id = ?",
        (fv_id,)).fetchone()
    conn.close()
    assert published["published_at"] is not None
    assert published["poster_filename"] is None  # poster failed, best effort


# ---------------------------------------------------------------------------
# Live API drive (real ASGI stack + in-memory R2): the extraction seam is hit at
# PUBLISH, NOT at render finalize. Reuses the T4050 FakeR2 harness.
# ---------------------------------------------------------------------------

import io

import httpx

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


def _seed_unpublished_reel(db_path, *, frozen=(2.0, 6.0), filename="final_9x16.mp4"):
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
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "slowmo_section_start, slowmo_section_end) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?)",
        (pid, filename, frozen[0], frozen[1]))
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ?, final_video_id = ? WHERE id = ?",
                (wv_id, fv_id, pid))
    conn.commit()
    conn.close()
    return pid, fv_id


@pytest.mark.asyncio
async def test_live_publish_attempts_poster_capture(live_env):
    """Driving the REAL POST /api/downloads/publish/{pid} hits the extraction
    seam (generate_and_store_poster) with the row's frozen section, and the
    poster_filename column is written -- all before the 200 returns."""
    app, fake, db_path = live_env
    pid, fv_id = _seed_unpublished_reel(db_path, frozen=(2.0, 6.0))

    seen = {}

    def spy(user_id, final_filename, slowmo_section=None):
        seen["called"] = True
        seen["filename"] = final_filename
        seen["section"] = slowmo_section
        return f"{final_filename}.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=spy):
        async with _live_client(app) as c:
            resp = await c.post(f"/api/downloads/publish/{pid}")

    assert resp.status_code == 200, resp.text
    assert seen.get("called") is True                 # poster attempted AT publish
    assert seen["filename"] == "final_9x16.mp4"
    assert seen["section"] == (2.0, 6.0)              # frozen section threaded through

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT published_at, poster_filename FROM final_videos WHERE id = ?",
        (fv_id,)).fetchone()
    conn.close()
    assert row["published_at"] is not None
    assert row["poster_filename"] == "final_9x16.mp4.jpg"


@pytest.mark.asyncio
async def test_live_finalize_does_not_attempt_poster_capture(live_env):
    """Driving the REAL POST /api/export/final (render finalize) must NOT hit the
    extraction seam -- poster capture no longer happens at render (T5280)."""
    app, fake, db_path = live_env
    pid, _ = _seed_unpublished_reel(db_path, frozen=(2.0, 6.0))

    called = {"n": 0}

    def spy(*a, **k):
        called["n"] += 1
        return "x.jpg"

    with patch.object(poster_mod, "generate_and_store_poster", side_effect=spy):
        async with _live_client(app) as c:
            resp = await c.post(
                "/api/export/final",
                data={"project_id": str(pid), "overlay_data": "{}"},
                files={"video": ("final.mp4", io.BytesIO(b"fake-mp4-bytes"), "video/mp4")},
            )

    assert resp.status_code == 200, resp.text
    assert called["n"] == 0, "render finalize must NOT extract a poster (T5280)"
