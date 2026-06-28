"""
T4050 — END-TO-END pipeline proof that a 9:16 -> 16:9 reframe materializes as a
REAL landscape video file.

Unlike test_t4050_reframe_dropped_at_export.py (which asserts on the geometry
*numbers* returned by calculate_multi_clip_resolution), this test runs the actual
export pipeline with REAL ffmpeg and ffprobes the produced .mp4 to prove the pixels
are landscape 16:9. No network, no R2, no Modal, no torch.

What is REAL here (exercised, not mocked):
  * `ffmpeg` generates a real source mp4 (testsrc 1920x1080, 2s @ 30fps).
  * `set_project_aspect_ratio('16:9')` -> `refit_crop_keyframes` runs on real dims,
    re-shaping the persisted 9:16 crop box to a landscape 16:9 box.
  * `_export_clips` (the real multi-clip export entry point in multi_clip.py) runs,
    which calls the real `calculate_multi_clip_resolution` to size the output.
  * Real ffmpeg crop+encode produces the output video, which is then ffprobed.

What is mocked (only the cloud/IO edges, never ffmpeg, never the geometry):
  * R2 upload + websocket progress (no network).
  * The AI super-resolution model (no torch/CUDA in this container). The stock test
    `MockVideoUpscaler` hardcodes its output scale to 810x1440 (portrait), which would
    mask orientation, so we substitute a *faithful* upscaler that scales the cropped
    region to `calculate_multi_clip_resolution(...)`'s output — exactly what the Modal
    GPU path does in production via `target_width`/`target_height`. The crop box it
    receives is the real refit box; the target it scales to is the real geometry
    function's result. Both halves of the T4050 fix therefore reach the pixels.

Control: the same reel exported WITHOUT the reframe (still 9:16) stays portrait.
"""

import os
import shutil
import subprocess
import sqlite3
from unittest.mock import patch, AsyncMock

import ffmpeg as ffmpeg_lib
import pytest

from app.services.default_crop import DEFAULT_CROP_SIZES

USER_ID = "t4050-e2e-user"
PROFILE_ID = "testdefault"

NINE_W, NINE_H = DEFAULT_CROP_SIZES["9:16"]        # (205, 365) portrait box
SIXTEEN_W, SIXTEEN_H = DEFAULT_CROP_SIZES["16:9"]  # (640, 360) landscape box

# Real source: a landscape frame big enough to hold either crop box. testsrc gives a
# genuine decodable H.264 stream so ffprobe on the output is meaningful.
SRC_W, SRC_H = 1920, 1080
SRC_FPS = 30


# ---------------------------------------------------------------------------
# DB fixture (mirrors test_t4050_reframe_dropped_at_export.py)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Real ffmpeg helpers
# ---------------------------------------------------------------------------

def _make_real_source(path):
    """Generate a real, decodable mp4 with ffmpeg (no fakes)."""
    (
        ffmpeg_lib
        .input(f"testsrc=size={SRC_W}x{SRC_H}:rate={SRC_FPS}:duration=2", f="lavfi")
        .output(str(path), pix_fmt="yuv420p", vcodec="libx264", preset="ultrafast")
        .overwrite_output()
        .run(quiet=True)
    )
    assert os.path.exists(path) and os.path.getsize(path) > 0


def _ffprobe_wh(path):
    """ffprobe the real output file -> (width, height). This WxH is the proof."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    w, h = (int(v) for v in out.split("x"))
    return w, h


# ---------------------------------------------------------------------------
# Reel seeding + real reframe
# ---------------------------------------------------------------------------

def _seed_reel(db_path, *, ratio):
    """A single-clip reel framed to `ratio` with a static centered crop box of that
    shape, with real source dims stored so the re-fit can clamp. Returns project_id."""
    from app.utils.encoding import encode_data

    box_w, box_h = DEFAULT_CROP_SIZES[ratio]
    box = {
        "x": round((SRC_W - box_w) / 2), "y": round((SRC_H - box_h) / 2),
        "width": box_w, "height": box_h,
    }
    crop = [{"frame": 0, **box}, {"frame": 60, **box}]

    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('E2E Reframe Reel', ?)", (ratio,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw_e2e.mp4', 5, 0.0, 2.0, 7, 0)")
    raw_clip_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_clips "
        "(project_id, raw_clip_id, version, sort_order, crop_data, width, height, fps) "
        "VALUES (?, ?, 1, 0, ?, ?, ?, ?)",
        (project_id, raw_clip_id, encode_data(crop), SRC_W, SRC_H, float(SRC_FPS)))
    conn.commit()
    conn.close()
    return project_id


async def _reframe(project_id, ratio):
    from app.routers.clips import set_project_aspect_ratio, AspectRatioChange
    return await set_project_aspect_ratio(project_id, AspectRatioChange(aspect_ratio=ratio))


def _latest_crop_time_keyframes(db_path, project_id):
    """Read the latest working clip's persisted crop box and convert frame-based
    keyframes to the time-based form `_export_clips` expects (mirrors framing.py)."""
    from app.utils.encoding import decode_data
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT crop_data, fps FROM working_clips WHERE project_id = ? ORDER BY version DESC LIMIT 1",
        (project_id,)).fetchone()
    conn.close()
    fps = row["fps"] or float(SRC_FPS)
    kfs = decode_data(row["crop_data"]) or []
    return [
        {"time": kf["frame"] / fps, "x": kf["x"], "y": kf["y"],
         "width": kf["width"], "height": kf["height"]}
        for kf in kfs
    ]


# ---------------------------------------------------------------------------
# Faithful upscaler: real ffmpeg crop + scale-to-target (== production Modal path)
# ---------------------------------------------------------------------------

def _make_faithful_upscaler(target_w, target_h, stash_path):
    """Return a MockVideoUpscaler-compatible class that does a REAL ffmpeg crop of the
    refit box and scales it to (target_w, target_h) -- the resolution the real
    `calculate_multi_clip_resolution` produced, exactly as Modal scales to
    target_width/target_height in production. It stashes a copy of its output so the
    file survives the pipeline's temp-dir cleanup for ffprobe."""

    class _FaithfulUpscaler:
        def __init__(self, **kwargs):
            # process_single_clip raises 503 unless this is truthy.
            self.upsampler = True

        def process_video_with_upscale(self, input_path, output_path, keyframes,
                                       target_fps=30, export_mode="quality",
                                       progress_callback=None, segment_data=None,
                                       include_audio=True, **kwargs):
            probe = ffmpeg_lib.probe(input_path)
            v = next(s for s in probe["streams"] if s["codec_type"] == "video")
            src_w, src_h = int(v["width"]), int(v["height"])

            kf = keyframes[0] if keyframes else {"x": 0, "y": 0, "width": src_w, "height": src_h}
            crop_w = max(2, int(kf["width"]))
            crop_h = max(2, int(kf["height"]))
            crop_x = max(0, int(kf["x"]))
            crop_y = max(0, int(kf["y"]))
            crop_w = min(crop_w, src_w - crop_x)
            crop_h = min(crop_h, src_h - crop_y)

            stream = ffmpeg_lib.input(input_path)
            stream = ffmpeg_lib.filter(stream, "crop", crop_w, crop_h, crop_x, crop_y)
            stream = ffmpeg_lib.filter(stream, "scale", target_w, target_h)
            stream = ffmpeg_lib.output(
                stream, output_path,
                vcodec="libx264", crf=23, preset="ultrafast", pix_fmt="yuv420p", an=None,
            )
            ffmpeg_lib.run(stream, overwrite_output=True, capture_stdout=True, capture_stderr=True)

            shutil.copy(output_path, stash_path)
            if progress_callback:
                try:
                    progress_callback(1, 1, "faithful upscale complete", "complete")
                except Exception:
                    pass
            return {"status": "success"}

    return _FaithfulUpscaler


def _no_cache():
    """A cache that always misses, so the faithful upscaler actually runs (and stashes
    its output) instead of a prior run's cached file being copied in."""
    from unittest.mock import MagicMock
    cache = MagicMock()
    cache.generate_key.return_value = "t4050-e2e-nocache"
    cache.get.return_value = None
    cache.put.return_value = True
    return cache


async def _run_real_export(db_path, project_id, aspect_ratio, source_path, stash_path):
    """Drive the REAL _export_clips pipeline end-to-end for a single clip and return the
    ffprobed (w, h) of the produced video. Only R2/websocket are mocked; ffmpeg and the
    geometry function are real."""
    from app.routers.export import multi_clip
    from app.routers.export.multi_clip import (
        ClipExportData, BytesFile, _export_clips, calculate_multi_clip_resolution,
    )

    crop_keyframes = _latest_crop_time_keyframes(db_path, project_id)

    # The real geometry decision (the subject of the T4050 fix). This is what the
    # faithful upscaler scales to, mirroring Modal's target_width/target_height.
    target_w, target_h = calculate_multi_clip_resolution(
        [{"cropKeyframes": crop_keyframes}], aspect_ratio)

    with open(source_path, "rb") as f:
        video_file = BytesFile(f.read())

    clip = ClipExportData(
        clip_index=0,
        crop_keyframes=crop_keyframes,
        segments=None,
        duration=2.0,
        video_file=video_file,
        source_fps=float(SRC_FPS),
        raw_clip_id=1,
        game_id=7,
        clip_name="e2e-clip",
    )

    Faithful = _make_faithful_upscaler(target_w, target_h, stash_path)

    with patch("app.services.local_processors.MockVideoUpscaler", new=Faithful), \
         patch.object(multi_clip, "get_clip_cache", return_value=_no_cache()), \
         patch.object(multi_clip, "manager", AsyncMock()):
        # project_id=None: exercise the real geometry + ffmpeg render path without the
        # R2-upload / working_videos DB-write / player-detection tail (those are not the
        # T4050 fix and would require torch/network). The rendered file is captured via
        # the faithful upscaler's stash before the pipeline cleans up its temp dir.
        await _export_clips(
            export_id="t4050-e2e",
            clips=[clip],
            aspect_ratio=aspect_ratio,
            transition={"type": "cut", "duration": 0},
            include_audio=False,
            target_fps=SRC_FPS,
            export_mode="fast",
            project_id=None,
            project_name="E2E Reframe Reel",
            user_id=USER_ID,
            profile_id=PROFILE_ID,
            credits_deducted=0,
            total_video_seconds=2.0,
            is_test_mode=True,
        )

    assert os.path.exists(stash_path), "pipeline did not produce an output video"
    return _ffprobe_wh(stash_path)


# ===========================================================================
# THE PROOF: a real 9:16 -> 16:9 reframe exports a real LANDSCAPE 16:9 video
# ===========================================================================

@pytest.mark.asyncio
async def test_reframed_9x16_to_16x9_exports_real_landscape_video(db, tmp_path):
    source = tmp_path / "src.mp4"
    _make_real_source(source)

    project_id = _seed_reel(db, ratio="9:16")
    result = await _reframe(project_id, "16:9")
    assert result["updated_clip_count"] == 1, "reframe must re-fit the clip"

    stash = tmp_path / "reframed_16x9.mp4"
    w, h = await _run_real_export(db, project_id, "16:9", source, stash)

    print(f"\n[T4050 E2E] REFRAMED 9:16 -> 16:9 exported video: {w}x{h}")

    assert w > h, f"reframed export must be LANDSCAPE, ffprobe got {w}x{h}"
    ratio = w / h
    assert abs(ratio - (16 / 9)) < 0.02, f"output must be ~16:9, got {w}x{h} (ratio {ratio:.4f})"


# ===========================================================================
# CONTROL: the same reel un-reframed (9:16) exports a real PORTRAIT video
# ===========================================================================

@pytest.mark.asyncio
async def test_control_unreframed_9x16_exports_real_portrait_video(db, tmp_path):
    source = tmp_path / "src.mp4"
    _make_real_source(source)

    project_id = _seed_reel(db, ratio="9:16")  # never reframed

    stash = tmp_path / "control_9x16.mp4"
    w, h = await _run_real_export(db, project_id, "9:16", source, stash)

    print(f"\n[T4050 E2E] CONTROL un-reframed 9:16 exported video: {w}x{h}")

    assert h > w, f"un-reframed 9:16 export must stay PORTRAIT, ffprobe got {w}x{h}"
    ratio = w / h
    assert abs(ratio - (9 / 16)) < 0.02, f"control must be ~9:16, got {w}x{h} (ratio {ratio:.4f})"
