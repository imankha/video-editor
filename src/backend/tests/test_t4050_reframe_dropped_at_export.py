"""
T4050 — Re-framing a reel must change the exported output geometry (the fix).

Ground truth (supervisor, verified against PROD): a user re-framed a single-clip
reel 9:16 -> 16:9, exported, and got a valid 9:16 (808x1440) video — the reframe
was silently dropped. Two structural causes, both fixed here:

  1. Export geometry was derived from the crop-BOX pixel dims, so a stale 9:16 box
     left over from before the reframe silently won and the nominal 16:9 ratio was
     ignored. `calculate_multi_clip_resolution` now treats the project's aspect
     ratio as AUTHORITATIVE for orientation; the crop box only sets the scale.

  2. `set_project_aspect_ratio` -> `refit_crop_keyframes` silently SKIPPED the
     crop-box re-fit whenever working_clips.width/height was NULL (legacy clips
     materialized from a game_videos row with no recorded dims). It now probes the
     parent game_video for the real dims (and persists them), and when none exist
     still re-shapes the box to the new ratio's fixed size — the reframe is never
     a no-op.

This file is the regression suite for both: a reframe always reaches the pixels,
and the frozen metadata label can no longer disagree with the actual geometry.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services.default_crop import DEFAULT_CROP_SIZES

USER_ID = "t4050-reframe-user"
PROFILE_ID = "testdefault"

NINE_W, NINE_H = DEFAULT_CROP_SIZES["9:16"]      # (205, 365) portrait box
SIXTEEN_W, SIXTEEN_H = DEFAULT_CROP_SIZES["16:9"]  # (640, 360) landscape box

# A source frame big enough to hold either box so the refit isn't clamped into a
# different shape.
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


def _seed_reel(db_path, *, ratio: str, with_dimensions: bool):
    """A single-clip reel framed to `ratio` (a static centered crop box of that
    shape) + matching projects.aspect_ratio. `with_dimensions` toggles whether
    working_clips carries the stored width/height the re-fit needs (the bug
    trigger when NULL). Returns (project_id, working_clip_id)."""
    from app.utils.encoding import encode_data

    box_w, box_h = DEFAULT_CROP_SIZES[ratio]

    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Brilliant Dribble', ?)", (ratio,))
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw56.mp4', 5, 3566.0, 3625.0, 7, 0)")
    raw_clip_id = cur.lastrowid

    box = {
        "x": round((SRC_W - box_w) / 2), "y": round((SRC_H - box_h) / 2),
        "width": box_w, "height": box_h,
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


def _export_output_resolution(db_path, project_id, ratio):
    """Reproduce exactly what the framing export does to size the output: read the
    latest crop keyframes and run calculate_multi_clip_resolution (the real sizing
    function used by _export_clips) with the project's nominal ratio."""
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

    return calculate_multi_clip_resolution(clips_data, ratio)


async def _reframe(project_id, ratio):
    from app.routers.clips import set_project_aspect_ratio, AspectRatioChange
    return await set_project_aspect_ratio(project_id, AspectRatioChange(aspect_ratio=ratio))


# ===========================================================================
# Control: with stored dimensions the re-fit runs and the output is landscape
# ===========================================================================

@pytest.mark.asyncio
async def test_reframe_resizes_output_when_dimensions_present(db):
    """9:16 -> 16:9 with stored dims: box re-fits to a 16:9 shape and the exported
    output is LANDSCAPE."""
    project_id, wc = _seed_reel(db, ratio="9:16", with_dimensions=True)

    result = await _reframe(project_id, "16:9")
    assert result["updated_clip_count"] == 1, "clip with dimensions must be re-fit"
    assert _project_ratio(db, project_id) == "16:9"

    box = _latest_crop_box(db, wc)
    assert (box["width"], box["height"]) == (SIXTEEN_W, SIXTEEN_H), \
        "crop box must be re-shaped to the 16:9 default size"

    w, h = _export_output_resolution(db, project_id, "16:9")
    assert w > h, f"output must be landscape after 16:9 reframe, got {w}x{h}"


# ===========================================================================
# THE FIX: missing stored dimensions no longer drops the reframe
# ===========================================================================

@pytest.mark.asyncio
async def test_reframe_dropped_when_working_clip_missing_dimensions(db):
    """REGRESSION (was the repro). A clip with working_clips.width/height = NULL and
    no recoverable game_videos dims used to have its re-fit SILENTLY SKIPPED, so the
    9:16 box survived and the export sized a PORTRAIT output. The fix re-shapes the
    box to the new ratio's fixed size even without source dims, so the export is now
    LANDSCAPE — the reframe reaches the pixels."""
    project_id, wc = _seed_reel(db, ratio="9:16", with_dimensions=False)

    result = await _reframe(project_id, "16:9")

    assert _project_ratio(db, project_id) == "16:9"
    # The re-fit now RUNS (no silent skip) even with no stored / probeable dims.
    assert result["updated_clip_count"] == 1, \
        "re-fit must run even when the clip has no stored dimensions"
    box = _latest_crop_box(db, wc)
    assert (box["width"], box["height"]) == (SIXTEEN_W, SIXTEEN_H), \
        "box must be re-shaped to 16:9 even without source dims"

    w, h = _export_output_resolution(db, project_id, "16:9")
    assert w > h, (
        f"reframed 9:16 -> 16:9 must export landscape, got {w}x{h}."
    )


@pytest.mark.asyncio
async def test_reframe_recovers_dims_from_game_videos_when_missing(db):
    """When working_clips has no dims but the parent game_video does, the re-fit
    recovers them, persists them onto the working clip (Correct Data), and re-fits."""
    project_id, wc = _seed_reel(db, ratio="9:16", with_dimensions=False)

    # Backfill the parent game_video with real source dims (game_id=7, sequence=0).
    conn = _connect(db)
    conn.execute(
        "INSERT INTO game_videos (game_id, sequence, blake3_hash, video_width, video_height, fps) "
        "VALUES (7, 0, 'deadbeef', ?, ?, 30.0)", (SRC_W, SRC_H))
    conn.commit()
    conn.close()

    result = await _reframe(project_id, "16:9")
    assert result["updated_clip_count"] == 1

    # Dims were recovered and persisted onto the working clip.
    conn = _connect(db)
    row = conn.execute(
        "SELECT width, height FROM working_clips WHERE id = ?", (wc,)).fetchone()
    conn.close()
    assert (row["width"], row["height"]) == (SRC_W, SRC_H), \
        "recovered source dims must be persisted onto the working clip"

    w, h = _export_output_resolution(db, project_id, "16:9")
    assert w > h, f"output must be landscape, got {w}x{h}"


# ===========================================================================
# Both directions
# ===========================================================================

@pytest.mark.asyncio
async def test_reframe_16x9_to_9x16_produces_portrait(db):
    """16:9 -> 9:16 produces a PORTRAIT output."""
    project_id, wc = _seed_reel(db, ratio="16:9", with_dimensions=True)

    result = await _reframe(project_id, "9:16")
    assert result["updated_clip_count"] == 1
    assert _project_ratio(db, project_id) == "9:16"

    box = _latest_crop_box(db, wc)
    assert (box["width"], box["height"]) == (NINE_W, NINE_H)

    w, h = _export_output_resolution(db, project_id, "9:16")
    assert w < h, f"output must be portrait after 9:16 reframe, got {w}x{h}"


# ===========================================================================
# No-regression: unchanged reels keep their orientation
# ===========================================================================

@pytest.mark.asyncio
async def test_unchanged_9x16_reel_still_exports_portrait(db):
    """A reel that is never reframed still exports 9:16 (portrait)."""
    project_id, _wc = _seed_reel(db, ratio="9:16", with_dimensions=True)
    w, h = _export_output_resolution(db, project_id, "9:16")
    assert w < h, f"unchanged 9:16 reel must export portrait, got {w}x{h}"


@pytest.mark.asyncio
async def test_native_16x9_reel_still_exports_landscape(db):
    """A natively-16:9 reel still exports 16:9 (landscape)."""
    project_id, _wc = _seed_reel(db, ratio="16:9", with_dimensions=True)
    w, h = _export_output_resolution(db, project_id, "16:9")
    assert w > h, f"native 16:9 reel must export landscape, got {w}x{h}"


# ===========================================================================
# Structural fix: output geometry follows the NOMINAL ratio, not the crop box
# ===========================================================================

@pytest.mark.asyncio
async def test_output_geometry_follows_nominal_ratio_over_stale_box(db):
    """A stale crop box can no longer flip the orientation away from the nominal
    ratio: a 9:16 box exported under a 16:9 nominal ratio yields LANDSCAPE, and a
    16:9 box under 9:16 yields PORTRAIT. The crop box only scales; the ratio shapes."""
    from app.utils.encoding import decode_data
    from app.routers.export.multi_clip import calculate_multi_clip_resolution

    project_id, wc = _seed_reel(db, ratio="9:16", with_dimensions=False)
    portrait_box = decode_data(_connect(db).execute(
        "SELECT crop_data FROM working_clips WHERE id = ?", (wc,)).fetchone()["crop_data"])

    # Stale 9:16 box, but nominal ratio is 16:9 -> landscape (the ratio wins).
    out = calculate_multi_clip_resolution([{"cropKeyframes": portrait_box}], "16:9")
    assert out[0] > out[1], f"nominal 16:9 must win over a 9:16 box, got {out}"

    # And a landscape box under a 9:16 nominal ratio -> portrait.
    landscape_box = [{"frame": 0, "x": 0, "y": 0, "width": SIXTEEN_W, "height": SIXTEEN_H}]
    out2 = calculate_multi_clip_resolution([{"cropKeyframes": landscape_box}], "9:16")
    assert out2[0] < out2[1], f"nominal 9:16 must win over a 16:9 box, got {out2}"

    # No-crop clips still honor the nominal ratio (the centered-default path).
    fallback = calculate_multi_clip_resolution([{"cropKeyframes": []}], "16:9")
    assert fallback[0] > fallback[1], "no-crop clips honor the nominal ratio"


# ===========================================================================
# Metadata/geometry agreement: the frozen label and the pixels now AGREE
# ===========================================================================

@pytest.mark.asyncio
async def test_frozen_metadata_label_matches_pixels_after_reframe(db):
    """compute_project_metadata freezes final_videos.aspect_ratio from
    projects.aspect_ratio. After a reframe the pixels follow the same ratio, so the
    label and the geometry AGREE (previously they could silently disagree)."""
    from app.database import get_db_connection
    from app.services.collection_metadata import compute_project_metadata

    project_id, _wc = _seed_reel(db, ratio="9:16", with_dimensions=False)
    await _reframe(project_id, "16:9")

    with get_db_connection() as conn:
        _dur, frozen_ratio, _tags = compute_project_metadata(conn.cursor(), project_id)

    w, h = _export_output_resolution(db, project_id, "16:9")

    assert frozen_ratio == "16:9", "label is frozen from projects.aspect_ratio"
    lw, lh = (int(x) for x in frozen_ratio.split(":"))
    label_is_landscape = lw > lh
    pixels_are_landscape = w > h
    assert label_is_landscape == pixels_are_landscape, (
        f"frozen label ({frozen_ratio}) must agree with output geometry ({w}x{h})"
    )
