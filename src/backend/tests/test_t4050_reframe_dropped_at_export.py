"""
T4050 (CORRECTED) — Re-framing a reel 9:16 -> 16:9 does not change the exported
output geometry.

Corrected ground truth (supervisor, verified against PROD):
  - The reel's game source IS present (not a missing-source failure).
  - The failing export COMPLETED and produced a VALID 9:16 video (808x1440),
    even though the user had set the reel to 16:9.
  - i.e. the new aspect ratio is silently dropped somewhere between the editor
    and the framing export; the pixels stay 9:16.

What these tests pin down (DIAGNOSIS ONLY — no fix):

The OUTPUT geometry of a framing export is decided ENTIRELY by the crop-box
width/height stored in working_clips.crop_data — see
`calculate_multi_clip_resolution` (multi_clip.py:901-943), which scans the crop
keyframes and IGNORES the nominal aspect-ratio string whenever any crop keyframe
exists. The nominal ratio (projects.aspect_ratio) only drives (a) the centered
DEFAULT crop applied to clips that have NO crop at all, and (b) the FROZEN label
written to final_videos.aspect_ratio by `compute_project_metadata`.

So a reframe only changes the pixels if the per-clip crop BOXES are re-shaped to
the new ratio. That re-shaping lives in ONE place: `set_project_aspect_ratio`
(clips.py:562) calling `refit_crop_keyframes`. And that re-fit is SILENTLY
SKIPPED for any latest-version clip whose working_clips.width/height is NULL
(clips.py:611-617) — which is exactly the case for clips materialized from a
game_videos row that never recorded video_width/video_height (clips.py:763-766,
"may be None for legacy rows").

Consequences this file reproduces:
  1. width/height PRESENT  -> refit runs  -> 16:9 box -> landscape output  (PASS, control)
  2. width/height NULL     -> refit SKIPPED -> 9:16 box stays -> portrait output
                              even though projects.aspect_ratio == '16:9'   (FAIL = repro)
  3. The metadata/geometry SPLIT: final_videos.aspect_ratio is frozen from
     projects.aspect_ratio ('16:9') while the actual pixels remain 9:16 — a
     label that lies about the file. (documents current behavior)

NOTE on the PROD datum (fv 36 recorded aspect_ratio '9:16'): that label is frozen
from projects.aspect_ratio at overlay time, so a '9:16' label means
projects.aspect_ratio was STILL '9:16' at export — i.e. in the user's actual
session the reframe gesture never reached projects at all (a separate, frontend
drop). The single discriminating prod query is:
    SELECT aspect_ratio FROM projects WHERE id = 41;
    SELECT id, width, height, length(crop_data) FROM working_clips WHERE project_id = 41;
  - projects.aspect_ratio == '9:16'  -> the gesture never persisted (frontend)
  - projects.aspect_ratio == '16:9' AND crop box still 9:16 -> the refit-skip
    reproduced here (backend).
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services.default_crop import DEFAULT_CROP_SIZES

USER_ID = "t4050-reframe-user"
PROFILE_ID = "testdefault"

NINE_W, NINE_H = DEFAULT_CROP_SIZES["9:16"]      # (205, 365) portrait box
SIXTEEN_W, SIXTEEN_H = DEFAULT_CROP_SIZES["16:9"]  # (640, 360) landscape box

# A source frame big enough to hold a 16:9 box (640x360) so the refit isn't
# clamped into a different shape.
SRC_W, SRC_H = 1080, 1920


@pytest.fixture()
def db(tmp_path):
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_reel_9x16(db_path, *, with_dimensions: bool):
    """A single-clip reel framed 9:16: project + one working_clip carrying a
    static 9:16 crop box. `with_dimensions` toggles whether working_clips has the
    stored width/height the re-fit needs (the bug trigger when NULL).
    Returns (project_id, working_clip_id)."""
    from app.utils.encoding import encode_data

    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Brilliant Dribble', '9:16')")
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw56.mp4', 5, 3566.0, 3625.0, 7, 0)")
    raw_clip_id = cur.lastrowid

    # Static centered 9:16 crop box, two permanent keyframes (start + end) — the
    # exact shape both the editor default and default_crop_keyframes produce.
    box = {
        "x": round((SRC_W - NINE_W) / 2), "y": round((SRC_H - NINE_H) / 2),
        "width": NINE_W, "height": NINE_H,
    }
    crop = [{"frame": 0, **box}, {"frame": 60, **box}]

    cur.execute(
        "INSERT INTO working_clips "
        "(project_id, raw_clip_id, version, sort_order, crop_data, width, height, fps) "
        "VALUES (?, ?, 1, 0, ?, ?, ?, ?)",
        (project_id, raw_clip_id, encode_data(crop),
         SRC_W if with_dimensions else None,
         SRC_H if with_dimensions else None,
         30.0))
    working_clip_id = cur.lastrowid

    conn.commit()
    conn.close()
    return project_id, working_clip_id


def _latest_crop_box(db_path, working_clip_id):
    """Decode the stored crop box (first keyframe) for the clip."""
    from app.utils.encoding import decode_data
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT crop_data FROM working_clips WHERE id = ?", (working_clip_id,)).fetchone()
    conn.close()
    kfs = decode_data(row["crop_data"]) or []
    return kfs[0] if kfs else None


def _project_ratio(db_path, project_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT aspect_ratio FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return row["aspect_ratio"]


def _export_output_resolution(db_path, project_id):
    """Reproduce exactly what the framing export does to size the output:
    read the latest crop keyframes and run calculate_multi_clip_resolution
    (the real sizing function used by _export_clips)."""
    from app.utils.encoding import decode_data
    from app.routers.export.multi_clip import calculate_multi_clip_resolution

    conn = _connect(db_path)
    rows = conn.execute(
        "SELECT crop_data FROM working_clips WHERE project_id = ? ORDER BY version DESC",
        (project_id,)).fetchall()
    conn.close()

    clips_data = []
    for r in rows:
        kfs = decode_data(r["crop_data"]) or []
        clips_data.append({"cropKeyframes": kfs})

    # The reframe set projects.aspect_ratio to 16:9, so the export is invoked with
    # the 16:9 nominal ratio (framing.py:490 reads project['aspect_ratio']).
    return calculate_multi_clip_resolution(clips_data, "16:9")


async def _reframe(project_id, ratio):
    from app.routers.clips import set_project_aspect_ratio, AspectRatioChange
    return await set_project_aspect_ratio(project_id, AspectRatioChange(aspect_ratio=ratio))


# ===========================================================================
# Control: with stored dimensions the re-fit runs and the output is landscape
# ===========================================================================

@pytest.mark.asyncio
async def test_reframe_resizes_output_when_dimensions_present(db):
    """When working_clips has width/height, the reframe re-fits the crop box to a
    16:9 shape and the exported output is LANDSCAPE. This is the happy path and
    pins the fix locus: the bug below is the SAME path minus stored dimensions."""
    project_id, wc = _seed_reel_9x16(db, with_dimensions=True)

    result = await _reframe(project_id, "16:9")
    assert result["updated_clip_count"] == 1, "clip with dimensions must be re-fit"
    assert _project_ratio(db, project_id) == "16:9"

    box = _latest_crop_box(db, wc)
    assert (box["width"], box["height"]) == (SIXTEEN_W, SIXTEEN_H), \
        "crop box must be re-shaped to the 16:9 default size"

    w, h = _export_output_resolution(db, project_id)
    assert w > h, f"output must be landscape after 16:9 reframe, got {w}x{h}"


# ===========================================================================
# REPRO: missing stored dimensions -> re-fit silently skipped -> output stays 9:16
# ===========================================================================

@pytest.mark.asyncio
async def test_reframe_dropped_when_working_clip_missing_dimensions(db):
    """REPRODUCTION. A clip materialized from a game_videos row with no recorded
    video_width/video_height has working_clips.width/height = NULL. The reframe
    updates projects.aspect_ratio to '16:9' but `refit_crop_keyframes` is SILENTLY
    SKIPPED (clips.py:611-617), so the 9:16 crop box survives and the export sizes
    a PORTRAIT output — the reframe is dropped in pixels.

    This assertion FAILS on current code: that is the bug."""
    project_id, wc = _seed_reel_9x16(db, with_dimensions=False)

    result = await _reframe(project_id, "16:9")

    # The ratio flips in metadata...
    assert _project_ratio(db, project_id) == "16:9"
    # ...but the crop re-fit was skipped (the silent drop).
    assert result["updated_clip_count"] == 0, \
        "diagnosis: re-fit is skipped for clips with no stored dimensions"
    box = _latest_crop_box(db, wc)
    assert (box["width"], box["height"]) == (NINE_W, NINE_H), \
        "diagnosis: stale 9:16 crop box survives the reframe"

    # DESIRED behavior (FAILS today): exported output should be 16:9 (landscape).
    w, h = _export_output_resolution(db, project_id)
    assert w > h, (
        f"BUG: reframed 9:16 -> 16:9 but exported output is still portrait {w}x{h}. "
        f"The crop box was never re-shaped (working_clips.width/height was NULL), and "
        f"calculate_multi_clip_resolution sizes output from the crop box, not the "
        f"nominal ratio."
    )


# ===========================================================================
# Structural cause: output geometry ignores the nominal ratio when a crop exists
# ===========================================================================

@pytest.mark.asyncio
async def test_output_geometry_is_driven_by_crop_box_not_nominal_ratio(db):
    """Documents the structural reason the reframe can be dropped: with a crop box
    present, `calculate_multi_clip_resolution` derives the output size from the
    box dimensions and never consults the nominal aspect ratio. Passing a 16:9
    nominal ratio over a stale 9:16 box still yields a portrait result."""
    from app.utils.encoding import decode_data
    from app.routers.export.multi_clip import calculate_multi_clip_resolution

    project_id, wc = _seed_reel_9x16(db, with_dimensions=False)
    kfs = decode_data(_connect(db).execute(
        "SELECT crop_data FROM working_clips WHERE id = ?", (wc,)).fetchone()["crop_data"])

    portrait = calculate_multi_clip_resolution([{"cropKeyframes": kfs}], "16:9")
    assert portrait[0] < portrait[1], (
        "current behavior: a 9:16 crop box yields portrait output even when the "
        f"nominal ratio is 16:9 (got {portrait}) — the nominal ratio is ignored."
    )

    # Only a clip with NO crop keyframes falls back to the nominal ratio.
    fallback = calculate_multi_clip_resolution([{"cropKeyframes": []}], "16:9")
    assert fallback[0] > fallback[1], \
        "no-crop clips DO honor the nominal ratio (the centered-default path)"


# ===========================================================================
# Metadata/geometry split: the frozen label can disagree with the pixels
# ===========================================================================

@pytest.mark.asyncio
async def test_frozen_metadata_label_can_disagree_with_pixels(db):
    """compute_project_metadata freezes final_videos.aspect_ratio from
    projects.aspect_ratio. After a dropped reframe the label says '16:9' while the
    pixels are still 9:16 — the metadata lies about the file. (When the gesture
    never persists at all, the inverse happens: label stays '9:16', matching the
    prod fv36 datum.)"""
    from app.database import get_db_connection
    from app.services.collection_metadata import compute_project_metadata

    project_id, wc = _seed_reel_9x16(db, with_dimensions=False)
    await _reframe(project_id, "16:9")

    with get_db_connection() as conn:
        _dur, frozen_ratio, _tags = compute_project_metadata(conn.cursor(), project_id)

    w, h = _export_output_resolution(db, project_id)

    assert frozen_ratio == "16:9", "label is frozen from projects.aspect_ratio"
    assert w < h, "but the exported pixels are still portrait"
    # The two disagree — this is the diagnosable inconsistency.
    lw, lh = (int(x) for x in frozen_ratio.split(":"))
    label_is_landscape = lw > lh
    pixels_are_landscape = w > h
    assert label_is_landscape != pixels_are_landscape, \
        "diagnosis: frozen aspect-ratio label disagrees with actual output geometry"
