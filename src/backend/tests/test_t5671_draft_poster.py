"""T5671: Draft poster thumbnails (backend).

Covers:
- draft_poster_rel_path: deterministic per-project key scheme (no DB column).
- ensure_draft_poster: cache hit (no ffmpeg / no upload), generate-on-miss
  (clearest frame within the clip's [in, out] region), no-clips -> None,
  missing-source (SourceUnavailable) -> None (the 404 basis), R2-upload-failure
  -> None, never raises.
- invalidate_draft_poster: deletes the deterministic key; never raises.
- GET /api/projects/{id}/poster.jpg: 200 image/jpeg on success, 404 when no
  poster; _serve_draft_poster_jpeg 404 (no presign) / 502 (bad fetch).
- Invalidation is wired into add/upload/reorder/remove clip handlers, and an R2
  delete failure NEVER breaks the clip action (poster failure is best-effort).
- _load_first_clip_for_poster: first clip by sort_order (latest version); [] ->
  None.

Tests mock R2 + ffmpeg (no network, no real encode); the DB-backed tests use a
throwaway profile SQLite in tmp_path.
"""

import asyncio
import sqlite3
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services import poster as poster_mod
from app.services.export_helpers import SourceUnavailable

USER_ID = "test-user-t5671"
PROFILE_ID = "t5671prof"
PROJECT_ID = 777
REL_PATH = f"posters/drafts/{PROJECT_ID}.v2.jpg"  # T5682: versioned, forces regen at card size


# ---------------------------------------------------------------------------
# Key scheme
# ---------------------------------------------------------------------------

def test_draft_poster_rel_path_is_deterministic():
    assert poster_mod.draft_poster_rel_path(PROJECT_ID) == REL_PATH
    assert poster_mod.draft_poster_rel_path(1) == "posters/drafts/1.v2.jpg"


# ---------------------------------------------------------------------------
# ensure_draft_poster
# ---------------------------------------------------------------------------

def _clip(**over):
    base = {
        "id": 11,
        "raw_clip_id": 5,
        "uploaded_filename": None,
        "sort_order": 0,
        "raw_filename": "extract.mp4",
        "game_id": 3,
        "video_sequence": 0,
        "raw_start_time": 10.0,
        "raw_end_time": 16.0,
        "raw_duration": 6.0,
        "game_blake3_hash": "abc123",
    }
    base.update(over)
    return base


def test_ensure_draft_poster_cache_hit_no_ffmpeg():
    # Object already in R2 -> return the path without loading a clip, extracting,
    # or uploading (this is the "second GET is a cache hit, no ffmpeg" property).
    with patch("app.storage.file_exists_in_r2", return_value=True), \
         patch.object(poster_mod, "_load_first_clip_for_poster") as load, \
         patch.object(poster_mod, "extract_clearest_frame_jpeg") as ex, \
         patch("app.storage.upload_bytes_to_r2") as up:
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) == REL_PATH
    load.assert_not_called()
    ex.assert_not_called()
    up.assert_not_called()


def test_ensure_draft_poster_generates_within_clip_window(tmp_path):
    captured = {}

    def fake_extract(source, output_path, window=None, resize_width=None, jpeg_quality=3):
        captured["window"] = window
        captured["source"] = source
        captured["resize_width"] = resize_width  # T5682
        captured["jpeg_quality"] = jpeg_quality
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpegbytes")
        return True

    def fake_upload(user_id, rel_path, data, *, fast=False, content_type=None, metadata=None):
        captured.update(
            up_user=user_id, up_key=rel_path, content_type=content_type,
            metadata=metadata, size=len(data),
        )
        return True

    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=_clip()), \
         patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/game.mp4?sig=1", 10.0, 16.0, True)), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", side_effect=fake_extract), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=(1080, 1920)), \
         patch("app.storage.upload_bytes_to_r2", side_effect=fake_upload):
        result = poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID)

    assert result == REL_PATH
    # Clearest frame sampled WITHIN the clip's source region [in, out].
    assert captured["window"] == (10.0, 16.0)
    assert captured["source"] == "https://r2/game.mp4?sig=1"
    assert captured["resize_width"] == 480  # T5682: card-size thumbnail
    assert captured["jpeg_quality"] == 3  # q~70%
    assert captured["up_user"] == USER_ID
    assert captured["up_key"] == REL_PATH
    assert captured["content_type"] == "image/jpeg"
    assert captured["metadata"] == {"width": 1080, "height": 1920}


def test_ensure_draft_poster_no_clips_returns_none():
    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=None), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg") as ex:
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) is None
    ex.assert_not_called()


def test_ensure_draft_poster_missing_source_returns_none():
    # SourceUnavailable (game reclaimed, no extract/recap) -> None -> the endpoint
    # 404s; NO fabricated image (no-silent-fallback rule).
    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=_clip()), \
         patch("app.services.export_helpers.resolve_clip_source",
               side_effect=SourceUnavailable(11)), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg") as ex, \
         patch("app.storage.upload_bytes_to_r2") as up:
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) is None
    ex.assert_not_called()
    up.assert_not_called()


def test_ensure_draft_poster_upload_failure_returns_none(tmp_path):
    def fake_extract(source, output_path, window=None, resize_width=None, jpeg_quality=3):
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8jpegbytes")
        return True

    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=_clip()), \
         patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/game.mp4?sig=1", 10.0, 16.0, True)), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", side_effect=fake_extract), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=None), \
         patch("app.storage.upload_bytes_to_r2", return_value=False):
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) is None


def test_ensure_draft_poster_extract_failure_returns_none():
    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=_clip()), \
         patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/game.mp4?sig=1", 10.0, 16.0, True)), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", return_value=False), \
         patch("app.storage.upload_bytes_to_r2") as up:
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) is None
    up.assert_not_called()


def test_ensure_draft_poster_never_raises():
    # An unexpected error anywhere -> None (best effort), never propagates.
    with patch("app.storage.file_exists_in_r2", side_effect=RuntimeError("r2 down")):
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) is None


def test_ensure_draft_poster_degenerate_window_falls_back_no_window():
    # out <= in (bad bounds) -> no window passed; the helper grabs the first frame.
    captured = {}

    def fake_extract(source, output_path, window=None, resize_width=None, jpeg_quality=3):
        captured["window"] = window
        captured["resize_width"] = resize_width
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8x")
        return True

    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "_load_first_clip_for_poster", return_value=_clip()), \
         patch("app.services.export_helpers.resolve_clip_source",
               return_value=("https://r2/x.mp4?sig=1", 5.0, 5.0, False)), \
         patch.object(poster_mod, "extract_clearest_frame_jpeg", side_effect=fake_extract), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=None), \
         patch("app.storage.upload_bytes_to_r2", return_value=True):
        assert poster_mod.ensure_draft_poster(PROJECT_ID, USER_ID) == REL_PATH
    assert captured["window"] is None
    assert captured["resize_width"] == 480  # T5682: card-size thumbnail


# ---------------------------------------------------------------------------
# invalidate_draft_poster
# ---------------------------------------------------------------------------

def test_invalidate_draft_poster_deletes_key():
    with patch("app.user_context.get_current_user_id", return_value=USER_ID), \
         patch("app.storage.delete_from_r2", return_value=True) as delete:
        poster_mod.invalidate_draft_poster(PROJECT_ID)
    delete.assert_called_once_with(USER_ID, REL_PATH)


def test_invalidate_draft_poster_never_raises():
    with patch("app.user_context.get_current_user_id", return_value=USER_ID), \
         patch("app.storage.delete_from_r2", side_effect=RuntimeError("r2 down")):
        # Must not propagate -- poster invalidation can never fail a clip action.
        poster_mod.invalidate_draft_poster(PROJECT_ID)


# ---------------------------------------------------------------------------
# GET /api/projects/{id}/poster.jpg + _serve_draft_poster_jpeg
# ---------------------------------------------------------------------------

def _fake_poster_r2_client(status_code=200, content=b"\xff\xd8jpegbytes", etag='"r2etag123"'):
    """A stand-in for storage.get_poster_r2_client() -- the pooled client used
    to fetch a presigned R2 URL (T5682, replaces the old per-request
    httpx.AsyncClient())."""
    from unittest.mock import AsyncMock
    fake_resp = MagicMock(status_code=status_code, content=content)
    fake_resp.headers = {"etag": etag} if etag else {}
    client = MagicMock()
    client.get = AsyncMock(return_value=fake_resp)
    return client


def _fake_request(if_none_match=None):
    """A minimal Request stand-in exposing .headers.get() (T5682)."""
    req = MagicMock()
    req.headers = {"if-none-match": if_none_match} if if_none_match else {}
    return req


def test_get_draft_poster_serves_jpeg():
    from app.routers import projects

    with patch("app.services.poster.ensure_draft_poster", return_value=REL_PATH), \
         patch("app.routers.projects.get_current_user_id", return_value=USER_ID), \
         patch.object(projects, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        resp = asyncio.run(projects.get_draft_poster(PROJECT_ID, _fake_request()))

    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=86400"  # T5682: long cache + ETag
    assert "etag" in resp.headers  # T5682: ETag for 304 hits
    assert resp.body == b"\xff\xd8jpegbytes"


def test_get_draft_poster_404_when_no_poster():
    from app.routers import projects
    with patch("app.services.poster.ensure_draft_poster", return_value=None), \
         patch("app.routers.projects.get_current_user_id", return_value=USER_ID):
        resp = asyncio.run(projects.get_draft_poster(PROJECT_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"


def test_get_draft_poster_304_when_if_none_match_matches():
    # T5682: a matching If-None-Match short-circuits to 304 via a SINGLE HEAD
    # against the deterministic key -- BEFORE ensure_draft_poster's own
    # cache-check HEAD runs.
    from app.routers import projects

    with patch("app.services.poster.ensure_draft_poster") as ensure, \
         patch("app.routers.projects.get_current_user_id", return_value=USER_ID), \
         patch("app.storage.r2_head_object", return_value={"ETag": '"r2etag123"'}) as head:
        resp = asyncio.run(projects.get_draft_poster(PROJECT_ID, _fake_request('"r2etag123"')))

    assert resp.status_code == 304
    head.assert_called_once_with(USER_ID, REL_PATH)
    # Short-circuited before ensure_draft_poster ran at all.
    ensure.assert_not_called()


def test_serve_draft_poster_404_when_no_presign():
    from app.routers import projects
    with patch("app.routers.projects.get_current_user_id", return_value=USER_ID), \
         patch.object(projects, "generate_presigned_url", return_value=None), \
         pytest.raises(HTTPException) as e:
        asyncio.run(projects._serve_draft_poster_jpeg(REL_PATH))
    assert e.value.status_code == 404


def test_serve_draft_poster_502_on_bad_fetch():
    from app.routers import projects
    with patch("app.routers.projects.get_current_user_id", return_value=USER_ID), \
         patch.object(projects, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client(status_code=403)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(projects._serve_draft_poster_jpeg(REL_PATH))
    assert e.value.status_code == 502


# ---------------------------------------------------------------------------
# DB-backed: _load_first_clip_for_poster + handler invalidation wiring
# ---------------------------------------------------------------------------

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


def _seed_project(db_path, *, aspect="9:16"):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Draft', ?)", (aspect,))
    pid = cur.lastrowid
    conn.commit()
    conn.close()
    return pid


def _seed_raw_clip(db_path, *, filename="c.mp4", start=0.0, end=6.0, rating=5):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES (?, ?, ?, ?)",
        (filename, rating, start, end),
    )
    rc = cur.lastrowid
    conn.commit()
    conn.close()
    return rc


def _seed_working_clip(db_path, project_id, raw_clip_id, *, sort_order=0, version=1):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) "
        "VALUES (?, ?, ?, ?)",
        (project_id, raw_clip_id, sort_order, version),
    )
    wc = cur.lastrowid
    conn.commit()
    conn.close()
    return wc


def test_load_first_clip_for_poster_orders_by_sort_order(db):
    pid = _seed_project(db)
    rc_a = _seed_raw_clip(db, filename="a.mp4", end=5.0)
    rc_b = _seed_raw_clip(db, filename="b.mp4", end=7.0)
    _seed_working_clip(db, pid, rc_b, sort_order=1)
    _seed_working_clip(db, pid, rc_a, sort_order=0)

    clip = poster_mod._load_first_clip_for_poster(pid)
    assert clip is not None
    assert clip["raw_filename"] == "a.mp4"      # sort_order 0 wins
    assert clip["raw_start_time"] == 0.0
    assert clip["raw_end_time"] == 5.0
    assert clip["raw_duration"] == 5.0


def test_load_first_clip_for_poster_empty_project_none(db):
    pid = _seed_project(db)
    assert poster_mod._load_first_clip_for_poster(pid) is None


def test_remove_clip_invalidates_poster(db):
    from app.routers import clips
    pid = _seed_project(db)
    rc = _seed_raw_clip(db)
    wc = _seed_working_clip(db, pid, rc)

    with patch.object(clips, "invalidate_draft_poster") as inval:
        res = asyncio.run(clips.remove_clip_from_project(pid, wc))
    assert res == {"success": True}
    inval.assert_called_once_with(pid)


def test_reorder_clips_invalidates_poster(db):
    from app.routers import clips
    pid = _seed_project(db)
    rc_a = _seed_raw_clip(db, filename="a.mp4", end=5.0)
    rc_b = _seed_raw_clip(db, filename="b.mp4", end=7.0)
    wc_a = _seed_working_clip(db, pid, rc_a, sort_order=0)
    wc_b = _seed_working_clip(db, pid, rc_b, sort_order=1)

    with patch.object(clips, "invalidate_draft_poster") as inval:
        res = asyncio.run(clips.reorder_clips(pid, [wc_b, wc_a]))
    assert res == {"success": True}
    inval.assert_called_once_with(pid)


def test_add_clip_invalidates_poster(db):
    from app.routers import clips
    pid = _seed_project(db)
    rc = _seed_raw_clip(db)

    with patch.object(clips, "invalidate_draft_poster") as inval:
        # T8370 Slice D: add_clip_to_project's file= branch (Path 2) was
        # retired -- it has no live frontend caller (addClipFromLibrary only
        # ever sends raw_clip_id), so the handler no longer takes a `file` arg.
        res = asyncio.run(clips.add_clip_to_project(pid, raw_clip_id=rc,
                                                    background_tasks=None))
    assert res.project_id == pid
    inval.assert_called_once_with(pid)


def test_clip_action_survives_r2_delete_failure(db):
    # "Poster failure does not break clip actions": force the R2 delete to raise;
    # the real invalidate_draft_poster must swallow it and the remove still 200s.
    from app.routers import clips
    pid = _seed_project(db)
    rc = _seed_raw_clip(db)
    wc = _seed_working_clip(db, pid, rc)

    with patch("app.storage.delete_from_r2", side_effect=RuntimeError("r2 write failed")):
        res = asyncio.run(clips.remove_clip_from_project(pid, wc))
    assert res == {"success": True}
    # And the row really was removed (the action completed).
    conn = _connect(db)
    remaining = conn.execute(
        "SELECT COUNT(*) AS n FROM working_clips WHERE project_id = ?", (pid,)
    ).fetchone()["n"]
    conn.close()
    assert remaining == 0
