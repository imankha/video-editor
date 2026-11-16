"""
Modal GPU functions for video processing.

This module handles video export processing on Modal's cloud GPUs.
No Docker required - Modal handles the environment automatically.

Architecture:
    FastAPI (Fly.io) -> <function>.remote() -> Modal GPU -> R2

Available functions:
    - render_overlay: Apply highlight overlays frame-by-frame (T4 GPU)
    - detect_players_modal: YOLO player detection (T4 GPU)
    - process_clips_ai: Unified multi-clip AI upscaling (T4 GPU)

Note: Parallel overlay processing was tested (E7) but costs 3-4x MORE than
sequential. All overlay processing uses sequential mode.
"""

import functools
import inspect
import logging
import os
import tempfile
import threading
import time

import modal


# Modal app name, resolved per-environment (T8270). Staging and production target
# DIFFERENT Modal apps so a `modal deploy` can be soaked on staging first.
#
# This is a byte-for-byte copy of `app.services.modal_client.resolve_modal_app_name`.
# It CANNOT import that module: this file is deployed into a Modal container whose
# image does not mount the `app` package (see the header comments below and the
# in-function imports at the bottom of this file). The parity between the two copies
# is enforced by `tests/test_modal_app_name.py`, which imports both and asserts they
# agree -- so they cannot silently drift.
#
# `modal deploy` names the app from whatever APP_ENV is set in the DEPLOYING shell,
# so the deploy command must set it explicitly (see backend/CLAUDE.md "Modal Functions").
# No silent fallback: an unrecognized APP_ENV RAISES at import (deploy) time rather
# than defaulting to the prod name.
def _resolve_modal_app_name(app_env: str) -> str:
    if app_env == "production":
        return "reel-ballers-video-v2"
    if app_env == "staging":
        return "reel-ballers-video-v2-staging"
    if app_env in ("dev", "development", "local", "test"):
        return "reel-ballers-video-v2-dev"
    raise RuntimeError(
        f"Cannot resolve Modal app name: unrecognized APP_ENV={app_env!r}. "
        "Expected one of production/staging/dev/development/local/test. "
        "Refusing to guess -- a wrong guess could point traffic at the prod Modal app."
    )


# T14130 -- explicit Modal capacity caps (no function may scale unbounded).
#
# MODAL_GPU_CONCURRENCY_LIMIT is the workspace plan's concurrent-GPU limit (Modal
# Starter: 10; documented in .claude/knowledge/modal-gpu.md -- update both together
# if the plan changes). Every GPU function is capped at it.
MODAL_GPU_CONCURRENCY_LIMIT = 10
GPU_MAX_CONTAINERS = MODAL_GPU_CONCURRENCY_LIMIT
# CPU-only ffmpeg functions (stitch, download compose): bounded well under the
# plan's container limit; each is short and memory-light on Modal.
CPU_MAX_CONTAINERS = 20


# T10160 -- "skip the GAN for small enlargements" gate.
#
# BYTE-FOR-BYTE copy of `app.ai_upscaler.upscale_gate` (GAN_MIN_ENLARGE +
# should_skip_gan). This file is deployed into a Modal image whose image does not
# mount the `app` package, so it cannot import the canonical module -- the exact
# same constraint that forces `_resolve_modal_app_name` above to be duplicated.
# Parity between the two copies is enforced by `tests/test_upscale_gate.py`.
#
# INERT by default: GAN_MIN_ENLARGE = 0.0 means the cheap path is never taken, so
# the render output is byte-identical to pre-T10160. Flipping the constant is a
# gated follow-up (see docs/plans/tasks/T10160-design.md).
GAN_MIN_ENLARGE = 0.0


def should_skip_gan(output_width: int, crop_width: int) -> bool:
    """True when the crop's horizontal enlargement is below GAN_MIN_ENLARGE."""
    if crop_width <= 0:
        return False
    return (output_width / crop_width) < GAN_MIN_ENLARGE


# Define the Modal app (name mirrors storage.APP_ENV's default of "dev" when unset)
app = modal.App(_resolve_modal_app_name(os.environ.get("APP_ENV", "dev")))

# Define the container image with all dependencies
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")  # Added libs for OpenCV/YOLO
    .pip_install(
        "boto3",
        "opencv-python-headless",  # Headless for server use
        "numpy",
    )
)

# Image for the CPU-only download-time composer (T7090 Phase 3,
# `compose_serve_time_modal`). Adds to the bare ffmpeg+boto3 `image` the PIL/numpy
# deps the intro-card plan builder's helpers touch, and BUNDLES the PURE app modules
# the burn needs -- the shared filtergraph builder (`card_compose_plan`), the concat
# ladder (`ffmpeg_concat`), and the branded-outro card build (`branded_outro`) -- plus
# the font + branding assets `branded_outro` loads by absolute path. It deliberately
# does NOT pull `player_intro`/`intro_cards`/`text_render`/`user_db`/FastAPI/DB: the
# PIL card RENDER runs app-side (its PNG layers arrive via R2 as the plan describes),
# so only the ffmpeg BURN + concat + outro live here.
_backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # src/backend
_app_dir = os.path.join(_backend_root, "app")
# Ship the WHOLE `app/` tree (python source AND the font/branding asset files) at
# /root/app, which is on sys.path in Modal -- so `import app.services.branded_outro`
# works and its `Path(__file__).parent.parent / "assets"` resolution finds the
# bundled fonts/branding. `add_local_dir` (not `add_local_python_source`) is used
# BECAUSE the branded outro loads NON-python assets (.ttf/.png) by absolute path;
# a python-source-only mount would drop them. Copied at BUILD (copy=True) so the
# subsequent (none here) build steps could see it; deterministic image contents.
compose_image = (
    image.pip_install("pillow", "numpy", "pydantic")
    .add_local_dir(_app_dir, remote_path="/root/app", copy=True)
)

# Separate image for YOLO detection (includes ultralytics)
# Model weights are downloaded during image build to avoid cold-start latency (~140MB)
yolo_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy",
        "ultralytics",  # YOLOv8
        "torch",
        "torchvision",
    )
    # Pre-download YOLOv8x model during image build
    .run_commands(
        "python -c \"from ultralytics import YOLO; YOLO('yolov8x.pt')\"",
    )
)

# Image for Real-ESRGAN AI upscaling
# Must use torch 2.1.0 + torchvision 0.16.0:
# - torchvision 0.17+ removed functional_tensor module that basicsr imports
# - numpy 1.26.4 for compatibility with torch 2.1.0
# Model weights are downloaded during image build to avoid cold-start latency
upscale_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0", "wget")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy==1.26.4",
        "torch==2.1.0",
        "torchvision==0.16.0",
        "basicsr==1.4.2",
        "realesrgan==0.3.0",
    )
    # Pre-download Real-ESRGAN model weights during image build
    # This avoids downloading on every cold start (~5MB, but adds latency)
    .run_commands(
        "mkdir -p /root/.cache/realesrgan/weights",
        "wget -q -O /root/.cache/realesrgan/weights/realesr-general-x4v3.pth "
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
    )
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_r2_client():
    """Create an R2 client using environment credentials."""
    import boto3
    from botocore.config import Config

    client = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    client.meta.events.register("after-call.s3", _count_r2_op)
    return client


# T13933: every @app.function counts the R2 calls its own boto3 clients make and returns
# them as result["r2_ops"] = {function_name: {op: n}}; the backend credits them under
# `modal:{function}` (modal_client._credit_modal_r2_ops). Only op NAMES cross the
# boundary -- the backend classifies them with app/r2_usage.OP_CLASS, so the pricing
# table is not mirrored here. One counter per container is enough: Modal runs one input
# per container at a time (no function here enables concurrent inputs; asserted by
# tests/test_t13933_modal_r2_ops.py). The lock covers s3transfer's worker threads.
_r2_ops_lock = threading.Lock()
_r2_ops: dict[str, int] = {}


def _count_r2_op(model=None, **kwargs):
    op = getattr(model, "name", "?")
    with _r2_ops_lock:
        _r2_ops[op] = _r2_ops.get(op, 0) + 1


def _reset_r2_ops():
    with _r2_ops_lock:
        _r2_ops.clear()


def _r2_ops_report(fn_name: str) -> dict:
    with _r2_ops_lock:
        return {fn_name: dict(_r2_ops)}


def _reports_r2_ops(fn):
    """Attach this invocation's R2 op counts to the function's result: the returned dict,
    or a generator's status-bearing (final) yield. Goes UNDER @app.function, and keeps a
    generator function a generator function (Modal's remote_gen depends on it)."""
    name = fn.__name__
    if inspect.isgeneratorfunction(fn):
        @functools.wraps(fn)
        def gen_wrapper(*args, **kwargs):
            _reset_r2_ops()
            for item in fn(*args, **kwargs):
                if isinstance(item, dict) and "status" in item:
                    item = {**item, "r2_ops": _r2_ops_report(name)}
                yield item
        return gen_wrapper

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        _reset_r2_ops()
        result = fn(*args, **kwargs)
        if isinstance(result, dict):
            result = {**result, "r2_ops": _r2_ops_report(name)}
        return result
    return wrapper


def _presigned_source_url(key: str, expires_in: int = 14400) -> str:
    """Generate a presigned GET URL for an R2 object from inside Modal.

    Use with FFmpeg pre-input ``-ss``/``-to`` + ``-c copy`` to extract only the
    needed range without downloading the full source video. See
    ``src/backend/.claude/skills/api-guidelines/rules/storage-modal-range-extract.md``.
    """
    r2 = get_r2_client()
    return r2.generate_presigned_url(
        "get_object",
        Params={"Bucket": os.environ["R2_BUCKET_NAME"], "Key": key},
        ExpiresIn=expires_in,
    )


def _has_audio_stream(video_path: str) -> bool:
    """
    Check if a video file has an audio stream using ffprobe.

    Args:
        video_path: Path to the video file

    Returns:
        True if video has at least one audio stream, False otherwise
    """
    import subprocess
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-select_streams', 'a',
                '-show_entries', 'stream=codec_type',
                '-of', 'csv=p=0',
                video_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode != 0:
            logger.warning(f"ffprobe failed for {video_path}: {result.stderr}")
            # Assume audio exists to avoid breaking existing behavior
            return True
        # If there's any output, there's an audio stream
        has_audio = bool(result.stdout.strip())
        logger.info(f"Audio stream check for {video_path}: {has_audio}")
        return has_audio
    except Exception as e:
        logger.warning(f"Failed to check audio stream for {video_path}: {e}")
        # Assume audio exists to avoid breaking existing behavior
        return True


def _decode_text_layers(text_layers: list, frame_w: int, frame_h: int) -> list:
    """T5225: decode each pre-rasterised PNG text layer ONCE, before the frame
    loop. INLINE COPY of the identical helper in
    `app/routers/export/overlay.py` -- the Modal image mounts NEITHER `app`
    NOR Pillow (see the image def above: only boto3/opencv/numpy), so this
    module can't import the app-side helper or re-rasterise; it only ever
    receives already-rasterised PNG bytes and decodes them with cv2 (the same
    "inline mirror" pattern `_spotlight_reveal` below already uses for the
    identical constraint). Keep this in sync with overlay.py's copy.

    O3 hard constraint: rasterised dims MUST equal frame dims -- raise rather
    than silently `cv2.resize`.
    """
    import cv2
    import numpy as np

    decoded = []
    for layer in text_layers:
        arr = np.frombuffer(layer["png"], dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("[Overlay Text] failed to decode a text layer PNG")
        h, w = img.shape[:2]
        if (w, h) != (frame_w, frame_h):
            raise ValueError(
                f"[Overlay Text] rasterised layer dims {w}x{h} != frame dims "
                f"{frame_w}x{frame_h} -- refusing to silently rescale"
            )
        if img.ndim != 3 or img.shape[2] != 4:
            raise ValueError("[Overlay Text] decoded text layer has no alpha channel")
        decoded.append({
            "startTime": layer["startTime"],
            "endTime": layer["endTime"],
            "bgr": img[:, :, :3].astype(np.float32),
            "alpha": (img[:, :, 3:4].astype(np.float32)) / 255.0,
        })
    return decoded


# T6990: fade-OUT envelope constant. INLINE COPY of `TEXT_FADE_OUT_SEC` in
# `app/routers/export/overlay.py` (the Modal image mounts neither `app` nor the
# app-side helper, same constraint as `_blend_text_layers` below) -- keep this
# byte-equal to overlay.py's; `TestModalInlineParity` in test_t5225_text_burn_in
# asserts the two constants AND the two blend outputs agree.
TEXT_FADE_OUT_SEC = 0.25


def _blend_text_layers(frame, decoded_layers: list, current_time: float):
    """T5225: alpha-blend every ACTIVE text layer onto `frame` (BGR uint8).

    ACTIVE = half-open ``startTime <= t < endTime`` (design O6). INLINE COPY of
    the identical helper in `app/routers/export/overlay.py` -- see
    `_decode_text_layers` docstring above for why this can't be a shared
    import. Never re-rasterises -- purely a per-frame numpy blend of bytes
    rasterised exactly once, upstream, app-side.

    T6990: alpha is scaled by a fade-OUT envelope over the final
    ``TEXT_FADE_OUT_SEC`` of the window (``min(1, (endTime - t) / fade)``) so text
    ramps to transparent instead of popping off on its end frame. Fade-IN is out
    of scope. Sub-``TEXT_FADE_OUT_SEC`` regions never reach full alpha (accepted
    simplification). Kept byte-identical to overlay.py's copy."""
    import numpy as np

    for layer in decoded_layers:
        if layer["startTime"] <= current_time < layer["endTime"]:
            fade = min(1.0, (layer["endTime"] - current_time) / TEXT_FADE_OUT_SEC)
            alpha = layer["alpha"] * fade
            frame = (frame.astype(np.float32) * (1 - alpha) + layer["bgr"] * alpha).astype(np.uint8)
    return frame


@app.function(
    image=image,
    gpu="T4",  # NVIDIA T4 - good balance of cost/performance
    max_containers=GPU_MAX_CONTAINERS,  # T14130
    timeout=600,  # 10 minutes max
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def render_overlay(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
    effect_type: str = "dark_overlay",
    overlay_settings: dict | None = None,
    text_layers: list | None = None,
):
    """
    Apply highlight overlays to video on GPU.

    This is a GENERATOR function that yields progress updates.
    Use .remote_gen() to consume progress, final yield has status="success".

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2 (UUID from auth, e.g., "f47ac10b-...")
        input_key: R2 key for input video (relative to user folder)
        output_key: R2 key for output video (relative to user folder)
        highlight_regions: List of regions with keyframes
        effect_type: "dark_overlay" | "brightness_boost" | "original"

    Yields:
        Progress updates: {"progress": 0-100, "phase": "...", "message": "..."}
        Final result: {"status": "success", "output_key": "..."} or {"status": "error", "error": "..."}
    """
    try:
        logger.info(f"[{job_id}] Starting overlay render for user {user_id}")
        logger.info(f"[{job_id}] Input: {input_key}, Output: {output_key}")
        logger.info(f"[{job_id}] Regions: {len(highlight_regions)}, Effect: {effect_type}")

        yield {"progress": 5, "phase": "initializing", "message": "Initializing..."}

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download input from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[{job_id}] Downloading {full_input_key}")
            yield {"progress": 10, "phase": "downloading", "message": "Downloading video..."}
            r2.download_file(bucket, full_input_key, input_path)
            yield {"progress": 20, "phase": "downloading", "message": "Download complete"}

            # Process overlay with granular progress
            output_path = os.path.join(temp_dir, "output.mp4")
            yield {"progress": 25, "phase": "processing", "message": "Applying highlights..."}

            for frame_progress in _process_overlay_gen(job_id, input_path, output_path, {
                "highlight_regions": highlight_regions,
                "effect_type": effect_type,
                "overlay_settings": overlay_settings or {},
                "text_layers": text_layers or [],
            }):
                # Map frame processing 0-100% to overall 25-80%
                overall = 25 + int(frame_progress * 0.55)
                yield {"progress": overall, "phase": "processing", "message": "Applying highlights..."}

            yield {"progress": 80, "phase": "processing", "message": "Processing complete"}

            # Upload result to R2
            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            yield {"progress": 85, "phase": "uploading", "message": "Uploading result..."}
            r2.upload_file(
                output_path,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[{job_id}] Overlay render complete")
            yield {
                "status": "success",
                "output_key": output_key,
                "progress": 100,
                "phase": "complete",
                "message": "Overlay complete"
            }

    except Exception as e:
        logger.error(f"[{job_id}] Overlay render failed: {e}", exc_info=True)
        yield {"status": "error", "error": str(e), "progress": 0, "phase": "error"}


def _process_overlay_gen(job_id: str, input_path: str, output_path: str, params: dict):
    """
    Generator wrapper around _process_overlay that yields progress (0-100).
    Yields every ~5% so the caller can forward updates to the client.
    """
    progress_updates = []

    def on_progress(pct):
        progress_updates.append(pct)

    # _process_overlay is blocking, so we can't yield during it.
    # Instead, refactor: inline the processing loop here as a generator.
    import subprocess

    import cv2

    highlight_regions = params.get("highlight_regions", [])
    effect_type = params.get("effect_type", "dark_overlay")
    overlay_settings = params.get("overlay_settings", {})
    text_layers = params.get("text_layers", [])

    # T5225: a project with text but no highlight regions must still go through
    # the frame loop -- the plain-copy shortcut would silently drop the text.
    if not highlight_regions and not text_layers:
        logger.info(f"[{job_id}] No highlights or text - copying video")
        cmd = ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
        subprocess.run(cmd, check=True)
        return

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    logger.info(f"[{job_id}] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

    sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])
    # T5225: decode every text layer's PNG ONCE, before the frame loop.
    decoded_text_layers = _decode_text_layers(text_layers, width, height)

    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}", "-r", str(fps),
        "-i", "pipe:0", "-i", input_path,
        "-map", "0:v", "-map", "1:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-preset", "fast", "-crf", "23",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k",
        output_path,
    ]

    ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )

    frame_idx = 0
    write_error = None
    last_yielded_pct = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            active_region = None
            for region in sorted_regions:
                if region["start_time"] <= current_time <= region["end_time"]:
                    active_region = region
                    break

            if active_region:
                detection_width = active_region.get('videoWidth')
                detection_height = active_region.get('videoHeight')
                if detection_width and detection_height and (detection_width != width or detection_height != height):
                    scale_x = width / detection_width
                    scale_y = height / detection_height
                    scaled_keyframes = [{
                        **kf,
                        'x': kf['x'] * scale_x, 'y': kf['y'] * scale_y,
                        'radiusX': kf['radiusX'] * scale_x, 'radiusY': kf['radiusY'] * scale_y,
                    } for kf in active_region.get('keyframes', [])]
                    frame = _render_highlight(frame, {**active_region, 'keyframes': scaled_keyframes}, current_time, effect_type, overlay_settings)
                else:
                    frame = _render_highlight(frame, active_region, current_time, effect_type, overlay_settings)

            if decoded_text_layers:
                frame = _blend_text_layers(frame, decoded_text_layers, current_time)

            try:
                if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                    ffmpeg_proc.stdin.write(frame.tobytes())
                    ffmpeg_proc.stdin.flush()
                else:
                    write_error = "FFmpeg stdin closed unexpectedly"
                    break
            except (BrokenPipeError, OSError) as e:
                write_error = f"Pipe error at frame {frame_idx}: {e}"
                break

            frame_idx += 1

            if frame_count > 0 and frame_idx % 100 == 0:
                pct = int((frame_idx / frame_count) * 100)
                logger.info(f"[{job_id}] Progress: {pct}% ({frame_idx}/{frame_count})")
                if pct >= last_yielded_pct + 5:
                    last_yielded_pct = pct
                    yield pct

    finally:
        cap.release()
        try:
            if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                ffmpeg_proc.stdin.close()
        except Exception as e:
            logger.warning(f"[{job_id}] Error closing stdin: {e}")

    ffmpeg_proc.wait()

    stderr_text = ""
    try:
        if ffmpeg_proc.stderr:
            stderr_text = ffmpeg_proc.stderr.read().decode() if ffmpeg_proc.stderr else ""
    except Exception as e:
        logger.warning(f"[{job_id}] Error reading stderr: {e}")

    if ffmpeg_proc.returncode != 0:
        logger.error(f"[{job_id}] FFmpeg stderr (tail): {stderr_text[-2000:]}")
        raise RuntimeError(f"FFmpeg encoding failed (code {ffmpeg_proc.returncode}): {stderr_text[-500:]}")

    if write_error:
        logger.error(f"[{job_id}] FFmpeg stderr (tail): {stderr_text[-2000:]}")
        raise RuntimeError(f"Frame writing failed: {write_error}")

    logger.info(f"[{job_id}] Overlay export complete: {frame_idx} frames")


def _process_overlay(job_id: str, input_path: str, output_path: str, params: dict):
    """
    Process overlay export - apply highlight overlays to video.

    Uses frame-by-frame processing with OpenCV, piped directly to FFmpeg.
    """
    import subprocess

    import cv2

    highlight_regions = params.get("highlight_regions", [])
    effect_type = params.get("effect_type", "dark_overlay")
    overlay_settings = params.get("overlay_settings", {})
    text_layers = params.get("text_layers", [])

    # If no highlights AND no text, just copy the video (T5225: text-only
    # projects must still go through the frame loop, not this shortcut).
    if not highlight_regions and not text_layers:
        logger.info(f"[{job_id}] No highlights or text - copying video")
        cmd = ["ffmpeg", "-y", "-i", input_path, "-c", "copy", output_path]
        subprocess.run(cmd, check=True)
        return

    # Open video
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    logger.info(f"[{job_id}] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

    # Sort regions by start time
    sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])
    # T5225: decode every text layer's PNG ONCE, before the frame loop.
    decoded_text_layers = _decode_text_layers(text_layers, width, height)

    # Start FFmpeg process
    # Note: -pix_fmt yuv420p is REQUIRED for broad compatibility (Windows Media Player, etc.)
    # -movflags +faststart moves moov atom to start for better streaming
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-i", "pipe:0",
        "-i", input_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",  # Required for Windows Media Player compatibility
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",  # Faster streaming/loading
        "-c:a", "aac",
        "-b:a", "192k",
        # No -shortest: video duration must drive output length. With concat-copied
        # mixed-audio sources the audio stream may be shorter than the video, and
        # -shortest would truncate the encode and break the stdin pipe mid-write.
        output_path,
    ]

    logger.info(f"[{job_id}] Starting FFmpeg: {' '.join(ffmpeg_cmd[:10])}...")

    ffmpeg_proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    frame_idx = 0
    write_error = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Find active region for this frame
            active_region = None
            for region in sorted_regions:
                if region["start_time"] <= current_time <= region["end_time"]:
                    active_region = region
                    break

            # Render highlight if in a region
            if active_region:
                # Check if keyframe coordinates need to be scaled from detection space to working video space
                # Detection may have run on source video (e.g., 2560x1440) but rendering is on working video (e.g., 1080x1920)
                detection_width = active_region.get('videoWidth')
                detection_height = active_region.get('videoHeight')

                if detection_width and detection_height and (detection_width != width or detection_height != height):
                    # Create a copy of region with scaled coordinates
                    scale_x = width / detection_width
                    scale_y = height / detection_height
                    scaled_keyframes = []
                    for kf in active_region.get('keyframes', []):
                        scaled_keyframes.append({
                            **kf,
                            'x': kf['x'] * scale_x,
                            'y': kf['y'] * scale_y,
                            'radiusX': kf['radiusX'] * scale_x,
                            'radiusY': kf['radiusY'] * scale_y,
                        })
                    scaled_region = {**active_region, 'keyframes': scaled_keyframes}
                    frame = _render_highlight(
                        frame, scaled_region, current_time, effect_type, overlay_settings
                    )
                else:
                    frame = _render_highlight(
                        frame, active_region, current_time, effect_type, overlay_settings
                    )

            if decoded_text_layers:
                frame = _blend_text_layers(frame, decoded_text_layers, current_time)

            # Write frame to FFmpeg - check if pipe is still open
            try:
                if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                    ffmpeg_proc.stdin.write(frame.tobytes())
                    ffmpeg_proc.stdin.flush()  # Ensure data is sent
                else:
                    write_error = "FFmpeg stdin closed unexpectedly"
                    break
            except (BrokenPipeError, OSError) as e:
                write_error = f"Pipe error at frame {frame_idx}: {e}"
                break

            frame_idx += 1

            # Log progress every 100 frames
            if frame_idx % 100 == 0:
                progress = int((frame_idx / frame_count) * 100)
                logger.info(f"[{job_id}] Progress: {progress}% ({frame_idx}/{frame_count})")

    finally:
        cap.release()
        # Close stdin safely to signal EOF to FFmpeg
        try:
            if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                ffmpeg_proc.stdin.close()
        except Exception as e:
            logger.warning(f"[{job_id}] Error closing stdin: {e}")

    # Wait for FFmpeg to finish (don't use communicate() since stdin is already closed)
    ffmpeg_proc.wait()

    # Read stderr for error reporting
    stderr_text = ""
    try:
        if ffmpeg_proc.stderr:
            stderr_text = ffmpeg_proc.stderr.read().decode() if ffmpeg_proc.stderr else ""
    except Exception as e:
        logger.warning(f"[{job_id}] Error reading stderr: {e}")

    if ffmpeg_proc.returncode != 0:
        logger.error(f"[{job_id}] FFmpeg stderr (tail): {stderr_text[-2000:]}")
        raise RuntimeError(f"FFmpeg encoding failed (code {ffmpeg_proc.returncode}): {stderr_text[-500:]}")

    if write_error:
        logger.error(f"[{job_id}] FFmpeg stderr (tail): {stderr_text[-2000:]}")
        raise RuntimeError(f"Frame writing failed: {write_error}")

    logger.info(f"[{job_id}] Overlay export complete: {frame_idx} frames")


def _catmull_rom(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _find_spline_indices(sorted_kf, time):
    if len(sorted_kf) < 2:
        return None
    p1_idx = -1
    p2_idx = -1
    for i, kf in enumerate(sorted_kf):
        if kf['time'] <= time:
            p1_idx = i
        if kf['time'] > time and p2_idx == -1:
            p2_idx = i
            break
    if p1_idx == -1 or p2_idx == -1:
        return None
    duration = sorted_kf[p2_idx]['time'] - sorted_kf[p1_idx]['time']
    if duration == 0:
        return None
    progress = (time - sorted_kf[p1_idx]['time']) / duration
    p0_idx = max(0, p1_idx - 1)
    p3_idx = min(len(sorted_kf) - 1, p2_idx + 1)
    return p0_idx, p1_idx, p2_idx, p3_idx, progress


def _spline_prop(sorted_kf, indices, prop):
    p0_idx, p1_idx, p2_idx, p3_idx, progress = indices
    return _catmull_rom(
        sorted_kf[p0_idx][prop], sorted_kf[p1_idx][prop],
        sorted_kf[p2_idx][prop], sorted_kf[p3_idx][prop], progress,
    )


def _spline_interpolate_highlight(sorted_kf, current_time):
    """Catmull-Rom spline interpolation matching frontend interpolateHighlightSpline."""
    if not sorted_kf:
        return None
    if len(sorted_kf) == 1:
        return sorted_kf[0]
    if current_time <= sorted_kf[0]['time']:
        return sorted_kf[0]
    if current_time >= sorted_kf[-1]['time']:
        return sorted_kf[-1]

    p1_idx = -1
    p2_idx = -1
    for i, kf in enumerate(sorted_kf):
        if kf['time'] <= current_time:
            p1_idx = i
        if kf['time'] > current_time and p2_idx == -1:
            p2_idx = i
            break
    if p1_idx == -1 or p2_idx == -1:
        return min(sorted_kf, key=lambda k: abs(k['time'] - current_time))

    duration = sorted_kf[p2_idx]['time'] - sorted_kf[p1_idx]['time']
    if duration == 0:
        return sorted_kf[p1_idx]
    progress = (current_time - sorted_kf[p1_idx]['time']) / duration

    p0_idx = max(0, p1_idx - 1)
    p3_idx = min(len(sorted_kf) - 1, p2_idx + 1)

    def sp(prop):
        return _catmull_rom(
            sorted_kf[p0_idx][prop], sorted_kf[p1_idx][prop],
            sorted_kf[p2_idx][prop], sorted_kf[p3_idx][prop], progress,
        )

    return {
        'x': sp('x'), 'y': sp('y'),
        'radiusX': sp('radiusX'), 'radiusY': sp('radiusY'),
        'strokeOpacity': max(0.0, min(1.0, sp('strokeOpacity'))),
        'fillOpacity': max(0.0, min(1.0, sp('fillOpacity'))),
        'color': sorted_kf[p1_idx].get('color'),
        'time': current_time,
    }


# T5250 spotlight exit-fade envelope — INLINE MIRROR of the shared spec. Kept self-contained
# because the Modal image does not mount `app`, so `from app.services.spotlight_reveal ...`
# is unavailable here. MUST stay in sync with:
#   - src/backend/app/services/spotlight_reveal.py (backend canonical)
#   - src/frontend/src/utils/spotlightReveal.js     (frontend canonical)
_REVEAL_EXIT_SEC = 0.25  # exit fade length


def _spotlight_reveal(current_time, start_time, end_time):
    """Return (opacity_factor, radius_scale) for the exit fade-out. See the shared spec in
    app/services/spotlight_reveal.py — keep the math identical. Full (1, 1) everywhere
    except the exit window; the only animation is the exit fade-out (no entrance)."""
    if start_time is None or end_time is None:
        return 1.0, 1.0
    dur = end_time - start_time
    if not dur > 0:
        return 1.0, 1.0
    exit_ = min(_REVEAL_EXIT_SEC, dur / 2)
    if exit_ > 0 and current_time > end_time - exit_:
        q = max(0.0, min(1.0, (end_time - current_time) / exit_))
        return q * q, 1.0  # ease-in quad
    return 1.0, 1.0


def _render_highlight(frame, region: dict, current_time: float, effect_type: str, overlay_settings: dict | None = None):
    """
    Render highlight overlay on a single frame.

    Uses Catmull-Rom cubic spline interpolation matching frontend.
    Supports bold stroke with dark outline, optional fill, configurable dim.
    Applies the T5250 exit fade-out envelope on top (no entrance animation).
    """
    import cv2
    import numpy as np

    keyframes = region.get("keyframes", [])
    if not keyframes:
        return frame

    start_time = region.get("start_time")
    end_time = region.get("end_time")
    if start_time is not None and end_time is not None:
        eps = 0.04
        keyframes = [kf for kf in keyframes if start_time - eps <= kf["time"] <= end_time + eps]
        if not keyframes:
            return frame

    sorted_kf = sorted(keyframes, key=lambda k: k['time'])
    result = _spline_interpolate_highlight(sorted_kf, current_time)

    if result is None:
        return frame

    settings = overlay_settings or {}

    # T5250: exit fade-out envelope, derived from the region bounds. Standard behavior —
    # always applied. No entrance animation; only the exit fades.
    reveal_opacity, reveal_scale = _spotlight_reveal(current_time, start_time, end_time)

    x = result['x']
    y = result['y']
    # Scale the radii about the center BEFORE the ground transform (mirrors the other paths).
    radius_x = result['radiusX'] * reveal_scale
    radius_y = result['radiusY'] * reveal_scale

    if settings.get('highlight_shape') == 'ground':
        y = y + radius_y / 1.3
        radius_x = radius_x * (2.0 / 1.3)
        radius_y = radius_y * 0.3

    radius_x = int(radius_x)
    radius_y = int(radius_y)

    frame_h, frame_w = frame.shape[:2]
    center = (int(x), int(y))

    if (center[0] + radius_x < 0 or center[0] - radius_x > frame_w or
        center[1] + radius_y < 0 or center[1] - radius_y > frame_h):
        return frame

    color_hex = (result.get('color') or '#FFFFFF').lstrip('#')
    if len(color_hex) == 6:
        r = int(color_hex[0:2], 16)
        g = int(color_hex[2:4], 16)
        b = int(color_hex[4:6], 16)
        color_bgr = (b, g, r)
    else:
        color_bgr = (255, 255, 255)

    is_ground = settings.get('highlight_shape') == 'ground'

    stroke_width_setting = settings.get('stroke_width', 2)
    fill_enabled = is_ground or settings.get('fill_enabled', False)
    # T5250: fold the reveal opacity factor into every opacity so the whole spotlight
    # (dim vignette, fill, outline, stroke) fades in/out together. 1.0 = no-op mid-region.
    fill_opacity = result.get('fillOpacity', settings.get('fill_opacity', 0.15 if is_ground else 0.05)) * reveal_opacity
    stroke_opacity = result.get('strokeOpacity', 0.85) * reveal_opacity
    dim_strength = settings.get('dim_strength', 0.15) * reveal_opacity
    outline_blend = 0.5 * reveal_opacity

    stroke_w = max(2, round(stroke_width_setting * frame_h / 1080))
    outline_w = stroke_w + 2

    arc_start = -30 if is_ground else 0
    arc_end = 210 if is_ground else 360

    out = frame

    if effect_type == "dark_overlay":
        mask = np.zeros((frame_h, frame_w), dtype=np.uint8)
        cv2.ellipse(mask, center, (radius_x, radius_y), 0, 0, 360, 255, -1)
        mask_inv = cv2.bitwise_not(mask)
        mask_inv_3ch = cv2.cvtColor(mask_inv, cv2.COLOR_GRAY2BGR).astype(np.float32) / 255.0
        out = out.astype(np.float32)
        out = out * (1.0 - mask_inv_3ch * dim_strength)
        out = np.clip(out, 0, 255).astype(np.uint8)

    if fill_enabled and fill_opacity > 0:
        overlay = out.copy()
        cv2.ellipse(overlay, center, (radius_x, radius_y), 0, 0, 360, color_bgr, -1)
        out = cv2.addWeighted(overlay, fill_opacity, out, 1 - fill_opacity, 0)

    outline_bgr = tuple(int(c * 0.3) for c in color_bgr)
    outline_overlay = out.copy()
    cv2.ellipse(outline_overlay, center, (radius_x, radius_y), 0, arc_start, arc_end, outline_bgr, outline_w)
    out = cv2.addWeighted(outline_overlay, outline_blend, out, 1 - outline_blend, 0)

    stroke_overlay = out.copy()
    cv2.ellipse(stroke_overlay, center, (radius_x, radius_y), 0, arc_start, arc_end, color_bgr, stroke_w)
    out = cv2.addWeighted(stroke_overlay, stroke_opacity, out, 1 - stroke_opacity, 0)

    return out


# ============================================================================
# YOLO Detection Functions
# ============================================================================

# YOLO class IDs
PERSON_CLASS_ID = 0

# Cached YOLO model (per-container)
_yolo_model = None


def _get_yolo_model():
    """Load YOLO model (cached per container)."""
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        logger.info("Loading YOLOv8x model...")
        _yolo_model = YOLO("yolov8x.pt")  # Auto-downloads if needed
        logger.info("YOLO model loaded successfully")
    return _yolo_model


@app.function(
    image=yolo_image,
    gpu="T4",
    max_containers=GPU_MAX_CONTAINERS,  # T14130
    timeout=120,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def detect_players_modal(
    user_id: str,
    input_key: str,
    frame_number: int,
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Detect players (persons) in a single video frame on GPU.

    Args:
        user_id: User folder in R2
        input_key: R2 key for input video
        frame_number: Frame number to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {
            "status": "success",
            "detections": [{"bbox": {...}, "confidence": float, "class_name": "person"}],
            "video_width": int,
            "video_height": int
        }
    """
    import cv2

    try:
        logger.info(f"[Detection] Player detection for frame {frame_number}")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download video from R2
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[Detection] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Extract frame
            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise ValueError(f"Could not open video: {input_path}")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if frame_number < 0 or frame_number >= total_frames:
                raise ValueError(f"Frame {frame_number} out of range (0-{total_frames-1})")

            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            ret, frame = cap.read()
            cap.release()

            if not ret or frame is None:
                raise ValueError(f"Failed to read frame {frame_number}")

            # Run YOLO detection
            model = _get_yolo_model()
            results = model(frame, verbose=False, conf=confidence_threshold)

            # Process results - filter for person class only
            detections = []
            for result in results:
                boxes = result.boxes
                if boxes is None:
                    continue

                for box in boxes:
                    class_id = int(box.cls[0])
                    if class_id != PERSON_CLASS_ID:
                        continue

                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2
                    box_width = x2 - x1
                    box_height = y2 - y1

                    detections.append({
                        "bbox": {
                            "x": center_x,
                            "y": center_y,
                            "width": box_width,
                            "height": box_height
                        },
                        "confidence": conf,
                        "class_name": "person",
                        "class_id": class_id
                    })

            # Sort by confidence (highest first)
            detections.sort(key=lambda d: d["confidence"], reverse=True)

            logger.info(f"[Detection] Found {len(detections)} players")

            return {
                "status": "success",
                "frame_number": frame_number,
                "detections": detections,
                "video_width": width,
                "video_height": height
            }

    except Exception as e:
        logger.error(f"[Detection] Player detection failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=yolo_image,
    gpu="T4",
    max_containers=GPU_MAX_CONTAINERS,  # T14130
    timeout=300,  # Longer timeout for batch detection
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def detect_players_batch_modal(
    user_id: str,
    input_key: str,
    timestamps: list[float],
    confidence_threshold: float = 0.5,
) -> dict:
    """
    Detect players (persons) in multiple video frames on GPU.

    Batch detection is more efficient than calling single-frame detection
    multiple times because the video is only downloaded once.

    Args:
        user_id: User folder in R2
        input_key: R2 key for input video
        timestamps: List of timestamps (in seconds) to analyze
        confidence_threshold: Minimum confidence for detections

    Returns:
        {
            "status": "success",
            "detections": [
                {
                    "timestamp": float,
                    "frame_number": int,
                    "boxes": [{"bbox": {...}, "confidence": float, "class_name": "person"}]
                },
                ...
            ],
            "video_width": int,
            "video_height": int
        }
    """
    import cv2

    try:
        logger.info(f"[Detection] Batch detection for {len(timestamps)} timestamps")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            # Download video from R2 once
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            logger.info(f"[Detection] Downloading {full_input_key}")
            r2.download_file(bucket, full_input_key, input_path)

            # Open video
            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                raise ValueError(f"Could not open video: {input_path}")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / fps if fps > 0 else 0

            logger.info(f"[Detection] Video: {width}x{height}, {total_frames} frames, {fps:.2f} fps, {duration:.2f}s")

            # Load YOLO model
            model = _get_yolo_model()

            all_detections = []

            for timestamp in timestamps:
                # Convert timestamp to frame number
                frame_number = int(timestamp * fps)

                # Clamp to valid range
                frame_number = max(0, min(frame_number, total_frames - 1))

                # Seek to frame
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
                ret, frame = cap.read()

                if not ret or frame is None:
                    logger.warning(f"[Detection] Failed to read frame at {timestamp}s (frame {frame_number})")
                    all_detections.append({
                        "timestamp": timestamp,
                        "frame_number": frame_number,
                        "boxes": []
                    })
                    continue

                # Run YOLO detection
                results = model(frame, verbose=False, conf=confidence_threshold)

                # Process results - filter for person class only
                boxes = []
                for result in results:
                    result_boxes = result.boxes
                    if result_boxes is None:
                        continue

                    for box in result_boxes:
                        class_id = int(box.cls[0])
                        if class_id != PERSON_CLASS_ID:
                            continue

                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        center_x = (x1 + x2) / 2
                        center_y = (y1 + y2) / 2
                        box_width = x2 - x1
                        box_height = y2 - y1

                        boxes.append({
                            "bbox": {
                                "x": center_x,
                                "y": center_y,
                                "width": box_width,
                                "height": box_height
                            },
                            "confidence": conf,
                            "class_name": "person",
                            "class_id": class_id
                        })

                # Sort by confidence (highest first)
                boxes.sort(key=lambda d: d["confidence"], reverse=True)

                all_detections.append({
                    "timestamp": timestamp,
                    "frame_number": frame_number,
                    "boxes": boxes
                })

                logger.info(f"[Detection] Frame at {timestamp:.2f}s: {len(boxes)} players")

            cap.release()

            logger.info(f"[Detection] Batch complete: {len(all_detections)} frames processed")

            return {
                "status": "success",
                "detections": all_detections,
                "video_width": width,
                "video_height": height,
                "fps": fps,
                "duration": duration
            }

    except Exception as e:
        logger.error(f"[Detection] Batch detection failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# ============================================================================
# Real-ESRGAN AI Upscaling Functions
# ============================================================================

# Cached Real-ESRGAN upsampler (per-container)
_realesrgan_model = None


def _get_realesrgan_model():
    """Load Real-ESRGAN model (cached per container)."""
    global _realesrgan_model
    if _realesrgan_model is None:
        import torch
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact

        logger.info("Loading Real-ESRGAN model (realesr-general-x4v3)...")

        # Model architecture for realesr-general-x4v3
        # Note: This model uses SRVGGNetCompact, NOT RRDBNet
        # RRDBNet is used by RealESRGAN_x4plus.pth
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        # Use pre-downloaded model from image build (avoids cold-start download)
        # Falls back to URL if local file doesn't exist (e.g., during local testing)
        local_model_path = "/root/.cache/realesrgan/weights/realesr-general-x4v3.pth"
        model_url = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
        model_path = local_model_path if os.path.exists(local_model_path) else model_url

        if os.path.exists(local_model_path):
            logger.info("Using pre-cached model weights (no download needed)")
        else:
            logger.info("Model not cached, will download from GitHub")

        _realesrgan_model = RealESRGANer(
            scale=4,
            model_path=model_path,
            dni_weight=None,
            model=model,
            tile=0,  # No tiling for GPU with enough VRAM
            tile_pad=10,
            pre_pad=0,
            half=True,  # Use FP16 for faster processing
            device='cuda' if torch.cuda.is_available() else 'cpu',
        )
        logger.info("Real-ESRGAN model loaded successfully")
    return _realesrgan_model


def _sharpen_frame(frame):
    """Unsharp-mask sharpen for the cheap (Lanczos) path.

    Mirrors the quality-mode sharpen in `ai_upscaler/frame_processor.py` so the
    Modal cheap path and the local mirror produce comparable output when the gate
    is eventually flipped on. Only reached when should_skip_gan() is True.
    """
    import cv2
    import numpy as np

    gaussian = cv2.GaussianBlur(frame, (0, 0), 1.0)
    sharpened = cv2.addWeighted(frame, 1.2, gaussian, -0.2, 0)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


def _upscale_crop(upsampler, cropped, out_w, out_h, log_label=""):
    """Upscale a crop to (out_w, out_h) -- the single gate decision for all Modal sites.

    T10160: when should_skip_gan(out_w, crop_w) is True (enlargement below
    GAN_MIN_ENLARGE), skip the Real-ESRGAN pass -- whose cost scales with the crop's
    INPUT pixel count, not the enlargement -- and use a Lanczos resize + unsharp
    sharpen instead. With GAN_MIN_ENLARGE = 0.0 (the shipped default) the branch is
    never taken, so this reproduces the prior inline enhance block byte-for-byte:
    enhance(outscale=4), resize-on-exception fallback, and the conditional
    trim-to-target resize. See docs/plans/tasks/T10160-design.md.
    """
    import cv2

    if should_skip_gan(out_w, cropped.shape[1]):
        resized = cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
        return _sharpen_frame(resized)

    try:
        upscaled, _ = upsampler.enhance(cropped, outscale=4)
    except Exception as e:
        logger.warning(f"[{log_label}] Upscale failed: {e}, using resize")
        upscaled = cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)

    # Resize to target resolution (Real-ESRGAN outputs 4x, may need adjustment)
    if upscaled.shape[1] != out_w or upscaled.shape[0] != out_h:
        upscaled = cv2.resize(upscaled, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
    return upscaled


def _interpolate_crop(sorted_keyframes: list, time: float) -> dict:
    """Interpolate crop position using Catmull-Rom spline.

    Args:
        sorted_keyframes: Keyframes pre-sorted by time (caller must sort).
        time: Time in seconds (relative to clip start, 0-based).
    """
    if not sorted_keyframes:
        return None

    if len(sorted_keyframes) == 1:
        return sorted_keyframes[0].copy()

    if time <= sorted_keyframes[0]['time']:
        return sorted_keyframes[0].copy()

    if time >= sorted_keyframes[-1]['time']:
        return sorted_keyframes[-1].copy()

    indices = _find_spline_indices(sorted_keyframes, time)
    if indices is None:
        nearest = min(sorted_keyframes, key=lambda k: abs(k['time'] - time))
        return nearest.copy()

    return {
        'time': time,
        'x': _spline_prop(sorted_keyframes, indices, 'x'),
        'y': _spline_prop(sorted_keyframes, indices, 'y'),
        'width': _spline_prop(sorted_keyframes, indices, 'width'),
        'height': _spline_prop(sorted_keyframes, indices, 'height'),
    }


def _clamp_crop_to_safe_area(x, y, w, h, frame_w, frame_h, rotation_deg):
    """INLINE COPY of `app/services/rotation_safe_area.py`'s
    `clamp_crop_to_safe_area` (that module can't be imported here -- the Modal
    image mounts neither `app` nor its deps, only boto3/opencv/numpy; same
    constraint `_decode_text_layers`/`_spotlight_reveal` document above). Pure
    stdlib `math`, no cv2/numpy needed. Keep in sync with rotation_safe_area.py
    and rotationSafeArea.js (three copies of one contract: JS gesture-time
    display, this Python render-time clamp, and the characterization-test
    Python mirror).

    2026-09-18 data-loss fix (T5640 superseded): crop keyframes used to be
    clamped and PERSISTED the moment the user changed the straighten angle --
    irreversible and destructive (collapses to ~2 distinct x positions at just
    1 degree, ALL keyframes identical past ~13 degrees for a portrait crop in
    a landscape source; see useCrop.setRotation's docstring on the frontend
    for the full mechanism). Keyframes now store the user's true framing
    verbatim; the safe-area clamp lives ONLY here (render time) and at
    display time (FocusScreen.currentCropState on the frontend), so rotation
    is fully reversible by construction and this function is what actually
    guarantees no black wedge enters the export.

    r (target aspect) is derived from the crop's OWN w/h, matching the
    frontend's `r = width / height` convention -- the crop box IS the target
    aspect, never a separate parameter.
    """
    if not rotation_deg or abs(rotation_deg) < 1e-6:
        return x, y, w, h

    import math
    r = w / h
    theta = abs(rotation_deg) * math.pi / 180
    sin_a, cos_a = abs(math.sin(theta)), abs(math.cos(theta))
    longer, shorter = max(frame_w, frame_h), min(frame_w, frame_h)
    width_is_longer = frame_w >= frame_h

    if shorter <= 2 * sin_a * cos_a * longer or abs(sin_a - cos_a) < 1e-10:
        half_short = 0.5 * shorter
        if width_is_longer:
            wr, hr = half_short / sin_a, half_short / cos_a
        else:
            wr, hr = half_short / cos_a, half_short / sin_a
    else:
        cos_2a = cos_a * cos_a - sin_a * sin_a
        wr = (frame_w * cos_a - frame_h * sin_a) / cos_2a
        hr = (frame_h * cos_a - frame_w * sin_a) / cos_2a

    if wr / hr >= r:
        w_safe, h_safe = hr * r, hr
    else:
        w_safe, h_safe = wr, wr / r
    x0, y0 = (frame_w - w_safe) / 2, (frame_h - h_safe) / 2

    cw = min(w, w_safe)
    ch = min(h, h_safe)
    if cw / ch > r:
        cw = ch * r
    else:
        ch = cw / r

    max_x, max_y = x0 + w_safe - cw, y0 + h_safe - ch
    cx = min(max(x, x0), max_x)
    cy = min(max(y, y0), max_y)
    return round(cx), round(cy), round(cw), round(ch)


def rotate_then_crop(frame, rotation_deg, x, y, w, h):
    """Rotate the full frame about its center (output kept at source W*H) THEN
    slice the axis-aligned crop (T5640).

    This is the single render primitive for the "crop lives in the rotated frame
    space" model (design §2.1). rotation_deg is the content-correction angle in
    DEGREES, positive = counter-clockwise (cv2's positive convention). Keeping the
    output canvas at the source W*H preserves the crop coordinate box, so
    rotation_deg == 0 is the byte-identical fast path (plain slice, no warp).

    2026-09-18: the crop is clamped to the rotated frame's safe area HERE (not
    trusted from the caller) -- see `_clamp_crop_to_safe_area`'s docstring for
    why this moved from "the client guarantees it" to a render-time guarantee.
    """
    if rotation_deg:
        import cv2
        h0, w0 = frame.shape[:2]
        m = cv2.getRotationMatrix2D((w0 / 2, h0 / 2), rotation_deg, 1.0)
        frame = cv2.warpAffine(
            frame, m, (w0, h0),
            flags=cv2.INTER_LANCZOS4,
            borderValue=(0, 0, 0),
        )
        x, y, w, h = _clamp_crop_to_safe_area(x, y, w, h, w0, h0, rotation_deg)
    return frame[y:y + h, x:x + w]


def _get_trim_range(segment_data: dict, duration: float) -> tuple:
    """
    Extract trim range from segment_data, supporting both formats.

    Formats supported:
    - Simple: {trim_start: float, trim_end: float}
    - Nested: {trimRange: {start: float, end: float}}

    Returns:
        (start_time, end_time) in seconds
    """
    if not segment_data:
        return 0, duration

    # Try simple format first (preferred)
    if 'trim_start' in segment_data:
        start = segment_data.get('trim_start', 0)
        end = segment_data.get('trim_end', duration)
        return start, end

    # Try nested format (backwards compatibility)
    trim_range = segment_data.get('trimRange', {})
    if trim_range:
        start = trim_range.get('start', 0)
        end = trim_range.get('end', duration)
        return start, end

    return 0, duration


def _should_emit_downsampled_frame(frame_num_rel: int, original_fps: float,
                                    target_fps: float, last_emitted_grid_idx: int) -> tuple[bool, int]:
    """Integer-cadence resampler (T8280): decides whether a just-decoded SOURCE
    frame lands on the TARGET fps grid, so the caller can skip enhance()+imwrite()
    for frames that would be discarded by ffmpeg's -r anyway -- paying the GPU
    cost only for frames that survive the down-sample.

    frame_num_rel is 0-based within the clip's own trim window (start_frame
    already subtracted). Gated single path: when target_fps >= original_fps
    (native / no-op / sub-30-source case), the grid index advances by >= 1
    every source frame, so every frame is emitted -- this is a no-op gate, not
    a parallel code path.
    """
    grid_idx = int(frame_num_rel * target_fps / original_fps)
    if grid_idx > last_emitted_grid_idx:
        return True, grid_idx
    return False, last_emitted_grid_idx


def _build_simple_ffmpeg_cmd(frame_pattern, source_path, output_path, fps, has_audio, audio_start_time, frame_count, input_fps=None):
    """Build FFmpeg command for simple encoding (no speed changes).

    Args:
        fps: TARGET output frame rate (forced via -r so duration matches the
            source, never left to drift with however many PNG frames exist).
        audio_start_time: Absolute time in source video for audio extraction (seconds).
        input_fps: The rate the PNG sequence was actually captured at (defaults
            to `fps` when the frames were already sampled 1:1 at the target
            rate). Bug 49p: a non-30fps source produced one PNG per SOURCE
            frame, but this was always declared to ffmpeg at the TARGET rate
            with no output -r, so a 50fps source played back at 30/50 = 0.6x
            speed (slow motion). Mirrors the already-correct local encoder
            (app/ai_upscaler/video_encoder.py).
    """
    if input_fps is None:
        input_fps = fps
    if has_audio:
        return [
            "ffmpeg", "-y",
            "-framerate", str(input_fps),
            "-i", frame_pattern,
            "-ss", str(audio_start_time),
            "-t", str(frame_count / input_fps),
            "-i", source_path,
            "-map", "0:v",
            "-map", "1:a?",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-r", str(fps),
            "-movflags", "+faststart",
            "-shortest",
            output_path
        ]
    else:
        return [
            "ffmpeg", "-y",
            "-framerate", str(input_fps),
            "-i", frame_pattern,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "23",
            "-r", str(fps),
            "-movflags", "+faststart",
            output_path
        ]


def _build_speed_change_ffmpeg_cmd(frame_pattern, scratch_path, clip_output_path, filter_complex, has_audio_output, original_fps, fps):
    """Build FFmpeg command for the speed-change filtergraph path (segments with
    per-segment speed != 1.0). Sibling of `_build_simple_ffmpeg_cmd`, extracted
    so this branch is unit-testable (bug 49p: this had zero test coverage while
    receiving the same input/output fps split fix as the simple-encode path).

    Args:
        filter_complex: pre-built `-filter_complex` graph string (trim/setpts/
            atrim/concat), referencing `[outv]` and, if has_audio_output, `[outa]`.
        has_audio_output: whether `filter_complex` produces an `[outa]` stream
            (i.e. has_audio AND at least one segment produced an audio filter).
        original_fps: the rate the PNG sequence was actually captured at (source
            fps) -- see `_build_simple_ffmpeg_cmd` for why this must differ from
            the forced output rate `fps`.
    """
    if has_audio_output:
        return [
            "ffmpeg", "-y",
            "-framerate", str(original_fps),
            "-i", frame_pattern,
            "-i", scratch_path,
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-map", "[outa]",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-r", str(fps),
            "-movflags", "+faststart",
            clip_output_path
        ]
    else:
        return [
            "ffmpeg", "-y",
            "-framerate", str(original_fps),
            "-i", frame_pattern,
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "23",
            "-r", str(fps),
            "-movflags", "+faststart",
            clip_output_path
        ]


@app.function(
    image=upscale_image,
    gpu="T4",
    max_containers=GPU_MAX_CONTAINERS,  # T14130
    timeout=3600,  # 1 hour for large multi-clip compilations
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def process_clips_ai(
    job_id: str,
    user_id: str,
    source_keys: list,
    output_key: str,
    clips_data: list,
    target_width: int = 810,
    target_height: int = 1440,
    fps: int = 30,
    include_audio: bool = True,
    transition: dict | None = None,
):
    """
    Unified AI video processing - handles single-clip and multi-clip exports.

    This is a GENERATOR function that yields real-time progress updates.

    Args:
        job_id: Unique export job identifier
        user_id: User folder in R2
        source_keys: List of R2 keys for source videos
        output_key: R2 key for output video
        clips_data: List of clip configs, each with:
            - keyframes: [{time, x, y, width, height}, ...]
            - segment_data: {trim_start, trim_end, segments: [{start, end, speed}]}
        target_width: Output width (default 810 for 9:16)
        target_height: Output height (default 1440)
        fps: Target frame rate (default 30)
        include_audio: Include audio track (default True)
        transition: Optional {type: "cut"|"fade", duration: float} for multi-clip

    Yields:
        Progress: {"progress": 0-100, "phase": "...", "message": "...", "clip": N, "total_clips": N}
        Final: {"status": "success", "output_key": "...", "clips_processed": N}
    """
    import subprocess

    import cv2

    total_clips = len(clips_data)

    # remote_gen() gives the caller no handle to the function-call id (it's a
    # plain generator, not a FunctionCall), so emit it as the first stream item
    # -- see modal_client.call_modal_clips_ai's modal_call_id capture.
    _own_call_id = modal.current_function_call_id()
    if not _own_call_id:
        # Documented Optional[str] -- a None here means the recovery path stays
        # broken for this job (same failure mode this fix closes) but silently,
        # so make it loud instead of a quiet no-op on the client side.
        logger.warning(f"[{job_id}] current_function_call_id() returned None -- modal_call_id will not be recoverable")
    yield {
        "progress": 0,
        "phase": "dispatched",
        "message": "Starting...",
        "clip": 0,
        "total_clips": total_clips,
        "modal_call_id": _own_call_id,
    }

    try:
        logger.info(f"[{job_id}] Starting AI upscaling for {total_clips} clip(s)")
        logger.info(f"[{job_id}] Target: {target_width}x{target_height} @ {fps}fps")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        yield {
            "progress": 2,
            "phase": "initializing",
            "message": "Initializing...",
            "clip": 0,
            "total_clips": total_clips
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            # === PHASE 1: Resolve full R2 keys per source ===
            # No full downloads. Each per-clip iteration below scratch-extracts
            # only its required sub-range via presigned URL + FFmpeg pre-input
            # -ss/-to + -c copy. See storage-modal-range-extract.md.
            source_full_keys = []
            for source_key in source_keys:
                if source_key.startswith("games/"):
                    full_key = source_key  # Global, no user prefix
                else:
                    full_key = f"{user_id}/{source_key}"
                source_full_keys.append(full_key)

            yield {
                "progress": 10,
                "phase": "initializing",
                "message": "Sources resolved",
                "clip": 0,
                "total_clips": total_clips
            }

            # === PHASE 2: Load Real-ESRGAN model ONCE ===
            yield {
                "progress": 12,
                "phase": "loading_model",
                "message": "Loading AI model...",
                "clip": 0,
                "total_clips": total_clips
            }

            upsampler = _get_realesrgan_model()

            yield {
                "progress": 15,
                "phase": "loading_model",
                "message": "AI model loaded",
                "clip": 0,
                "total_clips": total_clips
            }

            # === PHASE 3: Process each clip ===
            # Progress range: 15% to 75% for upscaling
            upscale_progress_start = 15
            upscale_progress_end = 75
            upscale_progress_per_clip = (upscale_progress_end - upscale_progress_start) / total_clips

            processed_paths = []

            for clip_idx, clip_data in enumerate(clips_data):
                clip_progress_start = upscale_progress_start + (clip_idx * upscale_progress_per_clip)
                clip_progress_end = clip_progress_start + upscale_progress_per_clip

                # Get source key (handle index mapping if needed)
                source_idx = clip_data.get('clipIndex', clip_idx)
                if source_idx >= len(source_full_keys):
                    source_idx = clip_idx
                full_source_key = source_full_keys[source_idx]

                keyframes = clip_data.get('keyframes', [])
                segment_data = clip_data.get('segment_data', {})
                clip_rotation = clip_data.get('rotation', 0) or 0

                logger.info(f"[{job_id}] Processing clip {clip_idx+1}/{total_clips}")

                yield {
                    "progress": int(clip_progress_start),
                    "phase": "upscaling",
                    "message": f"Processing clip {clip_idx+1}/{total_clips}...",
                    "clip": clip_idx + 1,
                    "total_clips": total_clips
                }

                # Determine clip range in source video (needed before extraction)
                clip_source_start = clip_data.get('source_start_time', 0.0)
                clip_source_end = clip_data.get('source_end_time', None)

                # === Scratch-extract the clip's sub-range from R2 ===
                # Fresh presigned URL per iteration (signing is local, free).
                # Never pass a presigned URL to cv2.VideoCapture — HTTPS seeks
                # hang 30+s (T1220 tracer). Always use a local scratch file.
                source_url = _presigned_source_url(full_source_key)
                scratch_path = os.path.join(temp_dir, f"clip_source_{clip_idx}.mp4")

                # Need a known end for extraction; if not provided, probe duration.
                # We can ask ffmpeg to copy to EOF by omitting -to when end is None.
                extract_cmd = ["ffmpeg", "-y", "-ss", str(clip_source_start)]
                if clip_source_end is not None:
                    extract_cmd += ["-to", str(clip_source_end)]
                extract_cmd += ["-i", source_url, "-c", "copy", scratch_path]

                logger.info(f"[{job_id}] Clip {clip_idx+1}: scratch-extracting {full_source_key} "
                            f"[{clip_source_start:.2f}s - {clip_source_end}]")
                extract_result = subprocess.run(extract_cmd, capture_output=True, text=True)
                if extract_result.returncode != 0:
                    logger.error(f"[{job_id}] Scratch extract failed: {extract_result.stderr[:500]}")
                    raise RuntimeError(f"Scratch extraction failed for clip {clip_idx+1}")

                # Open scratch (local file, fast seeks)
                cap = cv2.VideoCapture(scratch_path)
                if not cap.isOpened():
                    raise ValueError(f"Could not open scratch video: {scratch_path}")

                _probed_fps = cap.get(cv2.CAP_PROP_FPS)
                if not _probed_fps:
                    logger.warning(
                        f"[{job_id}] Clip {clip_idx+1}: cv2.CAP_PROP_FPS returned "
                        f"falsy ({_probed_fps!r}) for scratch video; falling back "
                        f"to target fps ({fps}) as original_fps"
                    )
                original_fps = _probed_fps or fps
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                duration = total_frames / original_fps if original_fps > 0 else 0  # scratch duration

                logger.info(f"[{job_id}] Clip {clip_idx+1}: {original_width}x{original_height} @ {original_fps:.1f}fps, {total_frames} frames (scratch)")

                # All times below are SCRATCH-RELATIVE (scratch frame 0 == original clip_source_start).
                # clip_start is always 0 in scratch-space; clip_duration matches the scratch length.
                clip_duration = duration

                # Combine extraction range with user trim (trim is already relative to clip start)
                trim_start_rel, trim_end_rel = _get_trim_range(segment_data, clip_duration)
                # "absolute" here now means scratch-absolute (== scratch-relative)
                absolute_start = trim_start_rel
                absolute_end = trim_end_rel
                start_frame = int(absolute_start * original_fps)
                end_frame = min(int(absolute_end * original_fps), total_frames)
                frames_to_process = max(1, end_frame - start_frame)

                logger.info(f"[{job_id}] Clip {clip_idx+1}: scratch-relative trim {absolute_start:.2f}s-{absolute_end:.2f}s")
                logger.info(f"[{job_id}] Clip {clip_idx+1}: Processing frames {start_frame}-{end_frame} ({frames_to_process} frames)")

                # Sort keyframes by time (pre-sorted for _interpolate_crop)
                sorted_keyframes = sorted(keyframes, key=lambda k: k.get('time', 0)) if keyframes else []

                # Create frames directory for this clip
                frames_dir = os.path.join(temp_dir, f"frames_{clip_idx}")
                os.makedirs(frames_dir, exist_ok=True)

                # Seek once (scratch file, fast), read sequentially
                cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
                output_frame_idx = 0
                last_yield_frame = 0
                clip_loop_start = time.time()
                # T8280: integer-cadence resampler state -- when fps (target) <
                # original_fps (source), only frames landing on the target grid
                # get enhanced+written (GPU-cost win). Native/no-op case (target
                # >= source) emits every frame -- see _should_emit_downsampled_frame.
                last_grid_idx = -1

                for frame_num in range(start_frame, end_frame):
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        logger.warning(f"[{job_id}] Could not read frame {frame_num}")
                        continue

                    frame_num_rel = frame_num - start_frame
                    should_emit, last_grid_idx = _should_emit_downsampled_frame(
                        frame_num_rel, original_fps, fps, last_grid_idx
                    )
                    if not should_emit:
                        continue

                    # Keyframe time is relative to clip start; scratch frame 0 IS clip start.
                    frame_time = frame_num / original_fps

                    # Get interpolated crop or use smart center crop
                    if sorted_keyframes:
                        crop = _interpolate_crop(sorted_keyframes, frame_time)
                    else:
                        # Smart center crop: maintain target aspect ratio
                        target_ratio = target_width / target_height
                        source_ratio = original_width / original_height

                        if source_ratio > target_ratio:
                            # Source is wider - crop sides
                            crop_height = original_height
                            crop_width = int(original_height * target_ratio)
                            crop_x = (original_width - crop_width) / 2
                            crop_y = 0
                        else:
                            # Source is taller - crop top/bottom
                            crop_width = original_width
                            crop_height = int(original_width / target_ratio)
                            crop_x = 0
                            crop_y = (original_height - crop_height) / 2

                        crop = {
                            'x': crop_x,
                            'y': crop_y,
                            'width': crop_width,
                            'height': crop_height
                        }

                    # Apply crop with bounds checking
                    x = max(0, min(int(crop['x']), original_width - int(crop['width'])))
                    y = max(0, min(int(crop['y']), original_height - int(crop['height'])))
                    w = int(crop['width'])
                    h = int(crop['height'])

                    # Ensure valid dimensions
                    w = max(1, min(w, original_width - x))
                    h = max(1, min(h, original_height - y))

                    cropped = rotate_then_crop(frame, clip_rotation, x, y, w, h)

                    # AI upscale with Real-ESRGAN (4x) (T10160: gated, cheap path inert at GAN_MIN_ENLARGE=0.0)
                    upscaled = _upscale_crop(upsampler, cropped, target_width, target_height, log_label=f"{job_id} frame {frame_num}")

                    # Save frame
                    frame_path = os.path.join(frames_dir, f"frame_{output_frame_idx:06d}.png")
                    cv2.imwrite(frame_path, upscaled)
                    output_frame_idx += 1

                    # Yield progress every 15 frames
                    if output_frame_idx - last_yield_frame >= 15:
                        frame_progress = output_frame_idx / frames_to_process
                        progress = int(clip_progress_start + frame_progress * (clip_progress_end - clip_progress_start))
                        yield {
                            "progress": progress,
                            "phase": "upscaling",
                            "message": f"Clip {clip_idx+1}: frame {output_frame_idx}/{frames_to_process}",
                            "clip": clip_idx + 1,
                            "total_clips": total_clips,
                            "current_frame": output_frame_idx,
                            "total_frames": frames_to_process
                        }
                        last_yield_frame = output_frame_idx
                        elapsed = time.time() - clip_loop_start
                        rate = output_frame_idx / elapsed if elapsed > 0 else 0
                        logger.info(
                            f"[{job_id}] Clip {clip_idx+1}: frame {output_frame_idx}/{frames_to_process} "
                            f"({progress}%) elapsed={elapsed:.1f}s rate={rate:.2f}fps"
                        )

                cap.release()
                clip_elapsed = time.time() - clip_loop_start
                clip_rate = output_frame_idx / clip_elapsed if clip_elapsed > 0 else 0
                logger.info(
                    f"[{job_id}] Clip {clip_idx+1}: {output_frame_idx} frames upscaled "
                    f"in {clip_elapsed:.1f}s ({clip_rate:.2f}fps avg)"
                )

                # T8280: once frames are down-sampled (fps < original_fps),
                # output_frame_idx counts EMITTED frames at TARGET cadence, not
                # source frames -- everything downstream that turns frame counts
                # into real elapsed seconds must divide by the PNGs' actual
                # cadence, not always original_fps. Native/no-op case (fps >=
                # original_fps) keeps today's behavior byte-identical.
                png_cadence_fps = fps if fps < original_fps else original_fps

                # === Encode this clip ===
                yield {
                    "progress": int(clip_progress_end - 2),
                    "phase": "encoding",
                    "message": f"Encoding clip {clip_idx+1}/{total_clips}...",
                    "clip": clip_idx + 1,
                    "total_clips": total_clips
                }

                clip_output_path = os.path.join(temp_dir, f"clip_{clip_idx}.mp4")
                frame_pattern = os.path.join(frames_dir, "frame_%06d.png")

                # Check if scratch has audio
                has_audio = _has_audio_stream(scratch_path) and include_audio

                # Check for speed changes
                segments = segment_data.get('segments', []) if segment_data else []
                has_speed_changes = any(seg.get('speed', 1.0) != 1.0 for seg in segments)

                # Build FFmpeg command
                if has_speed_changes and segments:
                    # Complex filtergraph for speed changes
                    logger.info(f"[{job_id}] Clip {clip_idx+1}: Applying speed changes")

                    filter_parts = []
                    audio_filter_parts = []
                    output_labels = []
                    audio_labels = []

                    trim_offset = trim_start_rel
                    # Bug 49p: output_frame_idx counts SOURCE frames (one PNG
                    # per source frame read in the loop above), so this must
                    # divide by original_fps to get real elapsed seconds, not
                    # the target fps. T8280: in the down-sample case
                    # output_frame_idx instead counts TARGET-cadence frames, so
                    # png_cadence_fps (== fps when down-sampling, == original_fps
                    # otherwise) is the correct divisor in both cases.
                    output_duration = output_frame_idx / png_cadence_fps

                    for seg_idx, seg in enumerate(segments):
                        seg_start = max(0, seg['start'] - trim_offset)
                        seg_end = min(output_duration, seg['end'] - trim_offset)
                        speed = seg.get('speed', 1.0)

                        if seg_end <= seg_start:
                            continue

                        # Video speed
                        if speed != 1.0:
                            filter_parts.append(
                                f"[0:v]trim=start={seg_start}:end={seg_end},setpts=(PTS-STARTPTS)/{speed}[v{seg_idx}]"
                            )
                        else:
                            filter_parts.append(
                                f"[0:v]trim=start={seg_start}:end={seg_end},setpts=PTS-STARTPTS[v{seg_idx}]"
                            )
                        output_labels.append(f"[v{seg_idx}]")

                        # Audio speed — times are clip-relative; scratch file is
                        # already trimmed to the clip, so no clip_start offset.
                        if has_audio:
                            audio_start = seg['start']
                            audio_end = seg['end']
                            if speed != 1.0:
                                atempo_val = max(0.5, min(2.0, speed))
                                audio_filter_parts.append(
                                    f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS,atempo={atempo_val}[a{seg_idx}]"
                                )
                            else:
                                audio_filter_parts.append(
                                    f"[1:a]atrim=start={audio_start}:end={audio_end},asetpts=PTS-STARTPTS[a{seg_idx}]"
                                )
                            audio_labels.append(f"[a{seg_idx}]")

                    if output_labels:
                        v_concat = ''.join(output_labels)
                        has_audio_output = bool(has_audio and audio_filter_parts)

                        if has_audio_output:
                            a_concat = ''.join(audio_labels)
                            all_filters = ';'.join(filter_parts + audio_filter_parts)
                            filter_complex = f"{all_filters};{v_concat}concat=n={len(output_labels)}:v=1:a=0[outv];{a_concat}concat=n={len(audio_labels)}:v=0:a=1[outa]"
                        else:
                            all_filters = ';'.join(filter_parts)
                            filter_complex = f"{all_filters};{v_concat}concat=n={len(output_labels)}:v=1:a=0[outv]"

                        ffmpeg_cmd = _build_speed_change_ffmpeg_cmd(
                            frame_pattern, scratch_path, clip_output_path,
                            filter_complex, has_audio_output, png_cadence_fps, fps
                        )
                    else:
                        # Fallback to simple encoding. absolute_start is
                        # scratch-relative (== trim_start_rel).
                        ffmpeg_cmd = _build_simple_ffmpeg_cmd(
                            frame_pattern, scratch_path, clip_output_path,
                            fps, has_audio, absolute_start, output_frame_idx,
                            input_fps=png_cadence_fps
                        )
                else:
                    # Simple encoding (no speed changes). absolute_start is
                    # scratch-relative (== trim_start_rel).
                    ffmpeg_cmd = _build_simple_ffmpeg_cmd(
                        frame_pattern, scratch_path, clip_output_path,
                        fps, has_audio, absolute_start, output_frame_idx,
                        input_fps=png_cadence_fps
                    )

                logger.info(f"[{job_id}] FFmpeg command: {' '.join(ffmpeg_cmd[:8])}...")
                result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)

                if result.returncode != 0:
                    logger.error(f"[{job_id}] FFmpeg error: {result.stderr[:500]}")
                    raise RuntimeError(f"FFmpeg encoding failed for clip {clip_idx+1}")

                processed_paths.append(clip_output_path)
                logger.info(f"[{job_id}] Clip {clip_idx+1} encoded successfully")

                # Clean up per-iteration scratch + frames to keep disk bounded
                try:
                    if os.path.exists(scratch_path):
                        os.remove(scratch_path)
                    if os.path.isdir(frames_dir):
                        import shutil as _shutil
                        _shutil.rmtree(frames_dir, ignore_errors=True)
                except Exception as cleanup_err:
                    logger.warning(f"[{job_id}] Clip {clip_idx+1} cleanup failed: {cleanup_err}")

            # === PHASE 4: Concatenate clips (if multiple) ===
            yield {
                "progress": 78,
                "phase": "concatenating",
                "message": "Finalizing video...",
                "clip": 0,
                "total_clips": total_clips
            }

            if len(processed_paths) == 1:
                # Single clip - just use it directly
                final_output = processed_paths[0]
            else:
                # Multiple clips - concatenate
                logger.info(f"[{job_id}] Concatenating {len(processed_paths)} clips...")
                final_output = os.path.join(temp_dir, "final_output.mp4")

                concat_list = os.path.join(temp_dir, "concat.txt")
                with open(concat_list, 'w') as f:
                    for path in processed_paths:
                        f.write(f"file '{path}'\n")

                # Use stream copy for cut transitions (fastest)
                transition_type = transition.get('type', 'cut') if transition else 'cut'

                if transition_type == 'cut':
                    concat_cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_list,
                        "-c", "copy",
                        "-movflags", "+faststart",
                        final_output
                    ]
                else:
                    # Re-encode for transitions (future: add xfade support)
                    concat_cmd = [
                        "ffmpeg", "-y",
                        "-f", "concat",
                        "-safe", "0",
                        "-i", concat_list,
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", "23",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-movflags", "+faststart",
                        final_output
                    ]

                result = subprocess.run(concat_cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    raise RuntimeError(f"Concat failed: {result.stderr[:500]}")

                logger.info(f"[{job_id}] Concatenation complete")

            # === PHASE 5: Upload to R2 ===
            yield {
                "progress": 90,
                "phase": "uploading",
                "message": "Uploading result...",
                "clip": 0,
                "total_clips": total_clips
            }

            full_output_key = f"{user_id}/{output_key}"
            logger.info(f"[{job_id}] Uploading to {full_output_key}")
            r2.upload_file(
                final_output,
                bucket,
                full_output_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            logger.info(f"[{job_id}] Processing complete: {len(processed_paths)} clip(s)")

            # Final result
            yield {
                "status": "success",
                "output_key": output_key,
                "clips_processed": len(processed_paths),
                "progress": 100,
                "phase": "complete",
                "message": "Processing complete"
            }

    except Exception as e:
        logger.error(f"[{job_id}] Processing failed: {e}", exc_info=True)
        yield {
            "status": "error",
            "error": str(e),
            "progress": 0,
            "phase": "error"
        }


# ============================================================================
# Collection stitch (T4945) -- CPU-only ffmpeg muxer, no GPU
# ============================================================================
# Muxes a collection's member reels into ONE ordered MP4 so the app server can
# then compose the intro/outro over it. Runs on a plain CPU container (gpu=None,
# base `image` = ffmpeg + boto3) so the single shared app server never absorbs
# the arbitrary-N concat/re-encode (EPIC decision 1). The concat logic is
# INLINED here (behaviour-equivalent to services/ffmpeg_concat.concat_segments:
# stream-copy join first, re-encode fallback on any resolution/pix_fmt mismatch,
# duration-floor validation) because Modal functions do not import app.services.

def _stitch_probe(path: str) -> dict:
    """Minimal probe for the concat compatibility check + duration floor."""
    import subprocess
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,width,height,pix_fmt",
         "-show_entries", "format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    import json as _json
    data = _json.loads(out)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        raise RuntimeError(f"no video stream in {path}")
    return {
        "width": int(v["width"]),
        "height": int(v["height"]),
        "pix_fmt": v.get("pix_fmt") or "yuv420p",
        "has_audio": a is not None,
        "duration": float(data.get("format", {}).get("duration") or 0.0),
    }


def _stitch_concat(segments: list, out_path: str) -> None:
    """Join `segments` IN ORDER into `out_path`: stream-copy demuxer concat when
    all segments share width/height/pix_fmt, else a filter_complex re-encode to
    the FIRST segment's frame size. Raises on total failure / validation miss.
    Mirrors services/ffmpeg_concat.concat_segments (kept behaviour-equivalent)."""
    import subprocess
    import tempfile as _tempfile

    probes = [_stitch_probe(s) for s in segments]
    expected_min = sum(p["duration"] for p in probes) * 0.6
    ref = probes[0]
    has_audio = ref["has_audio"]
    compatible = all(
        p["width"] == ref["width"] and p["height"] == ref["height"]
        and p["pix_fmt"] == ref["pix_fmt"]
        for p in probes
    )

    def _validate() -> bool:
        try:
            return _stitch_probe(out_path)["duration"] >= expected_min
        except Exception:
            return False

    if compatible:
        with _tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as lf:
            list_path = lf.name
            for s in segments:
                lf.write(f"file '{os.path.abspath(s)}'\n")
        try:
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-fflags", "+genpts",
                     "-f", "concat", "-safe", "0", "-i", list_path,
                     "-c", "copy", "-avoid_negative_ts", "make_zero",
                     "-movflags", "+faststart", out_path],
                    capture_output=True, text=True, check=True,
                )
                if _validate():
                    logger.info(f"[stitch_members] joined {len(segments)} members (copy)")
                    return
                logger.warning("[stitch_members] copy-join failed validation; re-encoding")
            except subprocess.CalledProcessError as e:
                logger.warning(f"[stitch_members] copy concat failed; re-encoding. "
                               f"{e.stderr[-300:] if e.stderr else e}")
        finally:
            try:
                os.remove(list_path)
            except OSError:
                pass
    else:
        logger.info("[stitch_members] member params differ; re-encoding directly")

    # Re-encode fallback: scale every input to the reference frame size.
    n = len(segments)
    inputs = []
    for s in segments:
        inputs += ["-i", s]
    scale_parts = [
        f"[{i}:v]scale={ref['width']}:{ref['height']}:force_original_aspect_ratio=disable,"
        f"setsar=1,format=yuv420p[v{i}]"
        for i in range(n)
    ]
    if has_audio:
        refs = "".join(f"[v{i}][{i}:a]" for i in range(n))
        fc = ";".join(scale_parts) + f";{refs}concat=n={n}:v=1:a=1[v][a]"
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"]
    else:
        refs = "".join(f"[v{i}]" for i in range(n))
        fc = ";".join(scale_parts) + f";{refs}concat=n={n}:v=1:a=0[v]"
        maps = ["-map", "[v]", "-an"]
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", fc, *maps,
         "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_path],
        capture_output=True, text=True, check=True,
    )
    if not _validate():
        raise RuntimeError("stitch re-encode concat failed validation")
    logger.info(f"[stitch_members] joined {len(segments)} members (re-encode)")


@app.function(
    image=image,       # base ffmpeg + boto3 image -- no torch, no weights
    gpu=None,          # CPU only -- pure ffmpeg muxing, no GPU work (T4945)
    max_containers=CPU_MAX_CONTAINERS,  # T14130
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def stitch_members(user_id: str, input_keys: list, output_key: str) -> dict:
    """Download each member reel from R2, concat them IN ORDER (stream-copy with
    a re-encode fallback on mixed resolution), upload the stitched file to
    `output_key`. `user_id` is the R2 prefix; keys are `{user_id}/{key}`.

    Read-only over the member sources (they are only ever downloaded); the sole
    write is `output_key` (the caller's disposable scratch object). Returns
    `{"output_key", "duration"}`. Raises on total failure -- the app-server
    caller degrades non-fatally.
    """
    import subprocess  # noqa: F401  (kept explicit; helpers import their own)

    bucket = os.environ["R2_BUCKET_NAME"]
    r2 = get_r2_client()

    if not input_keys:
        raise RuntimeError("stitch_members called with no members")

    with tempfile.TemporaryDirectory() as temp_dir:
        seg_paths = []
        for i, key in enumerate(input_keys):
            full_key = f"{user_id}/{key}"
            local = os.path.join(temp_dir, f"member_{i}.mp4")
            logger.info(f"[stitch_members] downloading {full_key}")
            r2.download_file(bucket, full_key, local)
            seg_paths.append(local)

        stitched = os.path.join(temp_dir, "stitched.mp4")
        if len(seg_paths) == 1:
            import shutil as _shutil
            _shutil.copyfile(seg_paths[0], stitched)
        else:
            _stitch_concat(seg_paths, stitched)

        full_out = f"{user_id}/{output_key}"
        logger.info(f"[stitch_members] uploading stitched -> {full_out}")
        r2.upload_file(stitched, bucket, full_out)
        duration = _stitch_probe(stitched)["duration"]

    return {"output_key": output_key, "duration": duration}


@app.function(
    image=compose_image,   # bare ffmpeg+boto3 + pillow/numpy/pydantic + bundled app modules
    gpu=None,              # CPU only -- ffmpeg card burn + concat, no GPU (T7090 Phase 3)
    max_containers=CPU_MAX_CONTAINERS,  # T14130
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
@_reports_r2_ops
def compose_serve_time_modal(
    user_prefix: str,
    reel_key: str,
    card_plan: dict,
    intro_layer_keys: list,
    outro_enabled: bool,
    out_key: str,
) -> dict:
    """T7090 Phase 3: burn the intro card + concat `[intro?][reel][outro?]` on
    Modal's CPU headroom instead of the 1GB Fly web box (the OOM site).

    Inputs (all R2 keys are RELATIVE; the full object is `{user_prefix}/{key}`):
      - `reel_key`: the reel to compose around.
      - `card_plan`: the JSON burn plan from `player_intro._plan_card_render`, or
        None/{} for no intro. Its `layers[].file` names the RELATIVE PNG basenames.
      - `intro_layer_keys`: the R2 keys of the app-rendered card PNG layers (same
        basenames the plan references), downloaded into a local layer dir.
      - `outro_enabled`: whether to build + append the branded outro card.
      - `out_key`: the disposable scratch key to upload the composed MP4 to.

    Returns `{"out_key", "duration", "full_fidelity", "degraded_reason"}` where
    `full_fidelity` mirrors `compose_serve_time`'s rule (concat_ok AND
    intro-landed-or-none AND outro-landed-or-none) and `degraded_reason` carries an
    intro-build failure. Raises only on a totally unreadable reel (the app caller
    then falls back to a local compose).

    The intro-card PIL RENDER is NOT here -- it ran app-side and its PNG layers
    arrive via R2. This function only executes the shared `build_intro_card_cmd`
    ffmpeg graph over them, so the filtergraph never drifts from the local burn.
    """
    import shutil as _shutil
    import subprocess

    from app.services.branded_outro import _get_or_build_card
    from app.services.branded_outro import outro_enabled as _outro_flag
    from app.services.card_compose_plan import build_intro_card_cmd
    from app.services.ffmpeg_concat import concat_segments, probe_media

    bucket = os.environ["R2_BUCKET_NAME"]
    r2 = get_r2_client()

    degraded_reason = None
    with tempfile.TemporaryDirectory() as temp_dir:
        # --- download the reel ------------------------------------------------
        reel_path = os.path.join(temp_dir, "reel.mp4")
        r2.download_file(bucket, f"{user_prefix}/{reel_key}", reel_path)
        try:
            reel_probe = probe_media(reel_path)
        except Exception as e:
            raise RuntimeError(f"reel unreadable on Modal: {e}") from e

        segments = []

        # --- intro: download the app-rendered layers + run the shared burn ----
        expected_intro = bool(card_plan) and bool(intro_layer_keys)
        intro_landed = False
        if expected_intro:
            layer_dir = os.path.join(temp_dir, "layers")
            os.makedirs(layer_dir, exist_ok=True)
            try:
                for key in intro_layer_keys:
                    basename = os.path.basename(key)
                    r2.download_file(bucket, f"{user_prefix}/{key}", os.path.join(layer_dir, basename))
                intro_path = os.path.join(temp_dir, "intro.mp4")
                cmd = build_intro_card_cmd(card_plan, layer_dir, intro_path)
                subprocess.run(cmd, capture_output=True, text=True, check=True)
                segments.append(intro_path)
                intro_landed = True
            except subprocess.CalledProcessError as e:
                rc = e.returncode
                logger.error(
                    f"[compose_serve_time_modal] intro burn failed (returncode={rc}); "
                    f"composing without intro. {e.stderr[-400:] if e.stderr else ''}"
                )
                # Preserve the T7090 fix-#3 signal shape for a signal-kill. Import
                # from the PURE card_compose_plan module (already in this image),
                # NOT player_intro -- that would pull the render/user_db tree onto
                # Modal, which this function deliberately never packages.
                if isinstance(rc, int) and rc < 0:
                    from app.services.card_compose_plan import INTRO_DEGRADED_KILLED
                    degraded_reason = INTRO_DEGRADED_KILLED
            except Exception as e:
                logger.error(f"[compose_serve_time_modal] intro burn error; no intro: {e}")

        segments.append(reel_path)

        # --- outro: build the cached branded card (bundled fonts/branding) ----
        expected_outro = bool(outro_enabled) and _outro_flag()
        outro_landed = False
        if expected_outro:
            try:
                outro_path = _get_or_build_card(reel_probe)
                if outro_path:
                    segments.append(outro_path)
                    outro_landed = True
                else:
                    logger.warning("[compose_serve_time_modal] outro build returned None; no outro")
            except Exception as e:
                logger.error(f"[compose_serve_time_modal] outro build error; no outro: {e}")

        # --- concat [intro?][reel][outro?] ------------------------------------
        composed = os.path.join(temp_dir, "composed.mp4")
        concat_ok = True
        if len(segments) == 1:
            _shutil.copyfile(reel_path, composed)
        else:
            concat_ok = concat_segments(segments, composed, reel_probe)
            if not concat_ok:
                logger.error("[compose_serve_time_modal] concat failed; degrading to reel-only")
                _shutil.copyfile(reel_path, composed)

        duration = probe_media(composed)["duration"]

        # --- upload the composed result to the scratch key --------------------
        r2.upload_file(composed, bucket, f"{user_prefix}/{out_key}")

    full_fidelity = (
        concat_ok
        and (intro_landed or not expected_intro)
        and (outro_landed or not expected_outro)
    )
    return {
        "out_key": out_key,
        "duration": duration,
        "full_fidelity": full_fidelity,
        "degraded_reason": degraded_reason,
    }


# Local testing entrypoint
@app.local_entrypoint()
def main():
    """Test the function locally."""
    print("Modal video processing functions ready.")
    print()
    print("Available functions:")
    print("  - render_overlay: Apply highlight overlays to video")
    print("  - render_overlay_parallel: Parallel chunk processing")
    print("  - process_framing: Crop, trim, and speed adjustments (FFmpeg)")
    print("  - detect_players_modal: YOLO player detection")
    print("  - process_clips_ai: Unified multi-clip AI upscaling")
    print()
    print("Deploy with: modal deploy video_processing.py")
    print()
    print("Call from Python:")
    print("  import modal")
    print("  fn = modal.Function.from_name('reel-ballers-video', 'render_overlay')")
    print("  result = fn.remote(job_id=..., user_id=..., ...)")
