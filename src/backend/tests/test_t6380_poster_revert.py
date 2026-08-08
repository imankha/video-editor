"""T6380: "Remove" a custom cover is a real revert (not a local-only no-op), and
the uploaded cover state is hydrated on overlay load.

Two bugs from the T5410 cover controls:

Bug 1 -- Remove was `setPosterUploadedFilename(null)` with NO backend call, so the
uploaded image stayed the served cover in R2 and poster_source stayed 'upload'.
Fixed by `POST /poster/revert` -> `revert_to_auto_poster`, which REUSES the single
poster-selection path (`generate_poster_at_export`) to regenerate the auto/marker
frame and OVERWRITE the deterministic poster key. The proof that this is not a
UI-only reset: the frame-grab/upload write path fires at the deterministic key
(the R2 object is regenerated), and poster_source returns to 'auto'/'overlay'.

Bug 2 -- `posterUploadedFilename` was never read back, so a reload lost the
"Custom image in use" state. Fixed by returning poster_source/poster_filename from
`/overlay-data` (column-guarded so a below-head profile does not 500 the hot read).

Covers:
- revert_to_auto_poster: reuses generate_poster_at_export (grab fires at the
  deterministic key); poster_source -> 'auto' (no marker) / 'overlay' (marker set);
  frozen-column duration used; None on unresolvable duration.
- /poster/revert endpoint: 400 with no final video (loud failure, no silent no-op);
  happy path reports the resulting source.
- /overlay-data: returns poster_source/poster_filename for hydration; column-guarded
  (below-head profile still returns 200).
"""

import json
import sqlite3
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.services import poster as poster_mod
from app.services.poster import (
    revert_to_auto_poster,
    set_project_poster_marker_time,
)

USER_ID = "test-user-t6380"
PROFILE_ID = "t6380prof"


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


def _seed_project(db_path):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('R', '9:16')")
    pid = cur.lastrowid
    conn.commit()
    conn.close()
    return pid


def _seed_final_video(db_path, project_id, filename="f.mp4", *, duration=10.0,
                      poster_source="upload", link=True):
    """A final video for `project_id` that already carries an uploaded cover
    (poster_source='upload'), mirroring the post-upload state Remove reverts."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, duration, "
        "poster_filename, poster_frame_time, poster_source) "
        "VALUES (?, ?, 1, ?, ?, NULL, ?)",
        (project_id, filename, duration, f"{filename}.jpg", poster_source),
    )
    fv_id = cur.lastrowid
    if link:
        cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id


# ---------------------------------------------------------------------------
# revert_to_auto_poster: reuses the single selection path, overwrites the key
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revert_no_marker_regenerates_auto_and_overwrites_key(db):
    pid = _seed_project(db)
    fv_id = _seed_final_video(db, pid, "auto.mp4", duration=10.0, poster_source="upload")

    # generate_poster_at_export (the SINGLE selection path) runs for real; only
    # the R2 frame grab/upload is stubbed. That the grab fires at the
    # deterministic basename is the proof the object is regenerated -- NOT a
    # local-only reset (bug 1). No slow-mo section -> window (0, 10-0.3) ->
    # T6630 round 7 changed the default from the window midpoint to
    # start + 2.0 (clamped to end): min(0.0 + 2.0, 9.7) = 2.0.
    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="auto.mp4.jpg") as grab:
        stored = await revert_to_auto_poster(USER_ID, pid, fv_id, "auto.mp4")

    assert stored == "auto.mp4.jpg"
    grab.assert_called_once_with(USER_ID, "auto.mp4", pytest.approx(2.0))

    row = _connect(db).execute(
        "SELECT poster_filename, poster_frame_time, poster_source FROM final_videos WHERE id = ?",
        (fv_id,),
    ).fetchone()
    assert row["poster_filename"] == "auto.mp4.jpg"
    assert row["poster_frame_time"] == pytest.approx(2.0)
    # The whole point: poster_source is no longer 'upload', so backfill_posters
    # no longer skips the reel.
    assert row["poster_source"] == "auto"


@pytest.mark.asyncio
async def test_revert_with_marker_regenerates_overlay_source(db):
    pid = _seed_project(db)
    fv_id = _seed_final_video(db, pid, "marked.mp4", duration=10.0, poster_source="upload")
    # The project still carries an overlay marker -> revert restores THAT frame,
    # source 'overlay' (not 'auto').
    set_project_poster_marker_time(pid, 2.5)

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="marked.mp4.jpg") as grab:
        stored = await revert_to_auto_poster(USER_ID, pid, fv_id, "marked.mp4")

    assert stored == "marked.mp4.jpg"
    grab.assert_called_once_with(USER_ID, "marked.mp4", pytest.approx(2.5))  # marker verbatim

    row = _connect(db).execute(
        "SELECT poster_frame_time, poster_source FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_frame_time"] == pytest.approx(2.5)
    assert row["poster_source"] == "overlay"


@pytest.mark.asyncio
async def test_revert_uses_single_selection_path(db):
    # No forked re-derivation: revert MUST go through generate_poster_at_export.
    pid = _seed_project(db)
    fv_id = _seed_final_video(db, pid, "one.mp4", duration=8.0)

    async def _fake_gen(*args, **kwargs):
        return "one.mp4.jpg"

    with patch.object(poster_mod, "generate_poster_at_export", side_effect=_fake_gen) as gen:
        stored = await revert_to_auto_poster(USER_ID, pid, fv_id, "one.mp4")

    assert stored == "one.mp4.jpg"
    gen.assert_called_once()
    # user_marker_time (last positional arg) is None when the project has none.
    assert gen.call_args.args[0] == USER_ID
    assert gen.call_args.args[1] == fv_id
    assert gen.call_args.args[-1] is None


@pytest.mark.asyncio
async def test_revert_duration_unresolvable_returns_none(db):
    # No frozen duration AND no R2 presign -> cannot regenerate; None (never raises).
    pid = _seed_project(db)
    fv_id = _seed_final_video(db, pid, "nodur.mp4", duration=None)

    with patch.object(poster_mod, "generate_presigned_url", return_value=None), \
         patch.object(poster_mod, "_grab_and_store_poster_frame") as grab:
        stored = await revert_to_auto_poster(USER_ID, pid, fv_id, "nodur.mp4")

    assert stored is None
    grab.assert_not_called()


# ---------------------------------------------------------------------------
# /poster/revert endpoint: loud failure precondition + happy path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revert_endpoint_no_final_video_fails_loudly(db):
    # Requires a final video (same precondition as upload). No final video ->
    # 400, NOT a silent no-op (the bug this task fixes).
    from app.routers.export.overlay import revert_poster_image

    pid = _seed_project(db)  # project with no final_video_id

    with pytest.raises(HTTPException) as exc:
        await revert_poster_image(pid)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_revert_endpoint_missing_project_404(db):
    from app.routers.export.overlay import revert_poster_image

    with pytest.raises(HTTPException) as exc:
        await revert_poster_image(999999)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_revert_endpoint_happy_path_reports_source(db):
    from app.routers.export.overlay import revert_poster_image

    pid = _seed_project(db)
    fv_id = _seed_final_video(db, pid, "ok.mp4", duration=10.0, poster_source="upload")

    with patch.object(poster_mod, "_grab_and_store_poster_frame", return_value="ok.mp4.jpg"):
        response = await revert_poster_image(pid)

    body = json.loads(response.body)
    assert body["success"] is True
    assert body["poster_filename"] == "ok.mp4.jpg"
    assert body["poster_source"] == "auto"  # no marker on the project

    row = _connect(db).execute(
        "SELECT poster_source FROM final_videos WHERE id = ?", (fv_id,)
    ).fetchone()
    assert row["poster_source"] == "auto"


# ---------------------------------------------------------------------------
# /overlay-data: hydration payload + below-head column guard (bug 2)
# ---------------------------------------------------------------------------

def _seed_working_video(db_path, project_id, filename="wv.mp4"):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, ?, 1, 10.0)",
        (project_id, filename),
    )
    conn.commit()
    conn.close()


@pytest.mark.asyncio
async def test_overlay_data_returns_poster_source_for_hydration(db):
    from app.routers.export.overlay import get_overlay_data

    pid = _seed_project(db)
    _seed_working_video(db, pid)
    _seed_final_video(db, pid, "hyd.mp4", poster_source="upload")

    response = await get_overlay_data(pid)
    body = json.loads(response.body)
    # bug 2: the served cover is an upload, so a reload must restore it.
    assert body["poster_source"] == "upload"
    assert body["poster_filename"] == "hyd.mp4.jpg"


@pytest.mark.asyncio
async def test_overlay_data_poster_source_auto_after_revert(db):
    from app.routers.export.overlay import get_overlay_data

    pid = _seed_project(db)
    _seed_working_video(db, pid)
    _seed_final_video(db, pid, "rev.mp4", poster_source="auto")

    response = await get_overlay_data(pid)
    body = json.loads(response.body)
    assert body["poster_source"] == "auto"


@pytest.mark.asyncio
async def test_overlay_data_below_head_profile_does_not_500(db):
    # Migration-window landmine: poster_source is a v032 column on this hot read
    # path. A below-head profile missing it must still return 200 (mirrors the
    # detections_data / poster_marker_time guards in the same endpoint).
    from app.routers.export.overlay import get_overlay_data

    pid = _seed_project(db)
    _seed_working_video(db, pid)
    _seed_final_video(db, pid, "old.mp4", poster_source="upload")

    conn = sqlite3.connect(str(db))
    conn.execute("ALTER TABLE final_videos DROP COLUMN poster_source")
    conn.commit()
    conn.close()

    # Must not raise "no such column: poster_source".
    response = await get_overlay_data(pid)
    assert response.status_code == 200
    body = json.loads(response.body)
    assert body["poster_source"] is None
