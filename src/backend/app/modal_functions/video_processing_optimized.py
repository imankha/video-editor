"""
Optimized Modal GPU functions for Real-ESRGAN benchmarking.

Tests various optimization techniques:
1. cudnn.benchmark - Auto-tune convolutions for consistent input sizes
2. torch.compile() - PyTorch 2.x JIT compiler
3. Combined optimizations

Deploy with:
    modal deploy app/modal_functions/video_processing_optimized.py
"""

import modal
import os
import tempfile
import logging
import time

app = modal.App("reel-ballers-video-optimized")

# Image with PyTorch 2.x for torch.compile support
upscale_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy==1.26.4",
        "torch==2.1.0",
        "torchvision==0.16.0",
        "basicsr==1.4.2",
        "realesrgan==0.3.0",
    )
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_r2_client():
    """Create an R2 client using environment credentials."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


# ============================================================================
# Model Loading Functions with Different Optimizations
# ============================================================================

_model_cache = {}


def _get_model_baseline(device='cuda'):
    """Baseline model loading - matches current production."""
    cache_key = f"baseline_{device}"
    if cache_key not in _model_cache:
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact

        logger.info(f"Loading Real-ESRGAN model (baseline) on {device}...")
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        _model_cache[cache_key] = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
            dni_weight=None,
            model=model,
            tile=0,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device=device,
        )
        logger.info("Baseline model loaded")
    return _model_cache[cache_key]


def _get_model_cudnn_optimized(device='cuda'):
    """Model with cudnn.benchmark enabled."""
    import torch
    cache_key = f"cudnn_{device}"
    if cache_key not in _model_cache:
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact

        # Enable cudnn benchmark for consistent input sizes
        torch.backends.cudnn.benchmark = True
        torch.backends.cudnn.deterministic = False

        logger.info(f"Loading Real-ESRGAN model (cudnn.benchmark=True) on {device}...")
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        _model_cache[cache_key] = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
            dni_weight=None,
            model=model,
            tile=0,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device=device,
        )
        logger.info("cudnn-optimized model loaded")
    return _model_cache[cache_key]


def _get_model_compiled(device='cuda', compile_mode='reduce-overhead'):
    """Model with torch.compile() applied."""
    import torch
    cache_key = f"compiled_{compile_mode}_{device}"
    if cache_key not in _model_cache:
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact

        # Enable cudnn optimizations
        torch.backends.cudnn.benchmark = True

        logger.info(f"Loading Real-ESRGAN model (torch.compile mode={compile_mode}) on {device}...")
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        upsampler = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
            dni_weight=None,
            model=model,
            tile=0,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device=device,
        )

        # Compile the internal model
        try:
            logger.info(f"Compiling model with mode={compile_mode}...")
            upsampler.model = torch.compile(upsampler.model, mode=compile_mode)
            logger.info("Model compiled successfully")
        except Exception as e:
            logger.warning(f"torch.compile failed: {e}, using uncompiled model")

        _model_cache[cache_key] = upsampler
    return _model_cache[cache_key]


def _get_model_fully_optimized(device='cuda', gpu_type='T4'):
    """Fully optimized model with all techniques."""
    import torch
    cache_key = f"optimized_{gpu_type}_{device}"
    if cache_key not in _model_cache:
        from realesrgan import RealESRGANer
        from realesrgan.archs.srvgg_arch import SRVGGNetCompact

        # GPU-specific settings
        if gpu_type == 'L4':
            compile_mode = 'max-autotune'  # L4 has more resources
        else:
            compile_mode = 'reduce-overhead'  # T4 is more constrained

        # Enable all CUDA optimizations
        torch.backends.cudnn.benchmark = True
        torch.backends.cudnn.deterministic = False
        torch.backends.cuda.matmul.allow_tf32 = True  # Allow TF32 on Ampere+
        torch.backends.cudnn.allow_tf32 = True

        logger.info(f"Loading fully optimized Real-ESRGAN for {gpu_type} on {device}...")
        model = SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')

        upsampler = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
            dni_weight=None,
            model=model,
            tile=0,
            tile_pad=10,
            pre_pad=0,
            half=True,
            device=device,
        )

        # Compile with GPU-appropriate mode
        try:
            logger.info(f"Compiling model with mode={compile_mode} for {gpu_type}...")
            upsampler.model = torch.compile(upsampler.model, mode=compile_mode)
            logger.info("Model compiled successfully")
        except Exception as e:
            logger.warning(f"torch.compile failed: {e}, using uncompiled model")

        _model_cache[cache_key] = upsampler
    return _model_cache[cache_key]


# ============================================================================
# Interpolation Helper
# ============================================================================

def _interpolate_crop(keyframes: list, time: float) -> dict:
    """Interpolate crop position at a given time."""
    if not keyframes:
        return None

    sorted_kf = sorted(keyframes, key=lambda k: k['time'])

    if time <= sorted_kf[0]['time']:
        return sorted_kf[0].copy()
    if time >= sorted_kf[-1]['time']:
        return sorted_kf[-1].copy()

    for i in range(len(sorted_kf) - 1):
        kf1 = sorted_kf[i]
        kf2 = sorted_kf[i + 1]

        if kf1['time'] <= time <= kf2['time']:
            t = (time - kf1['time']) / (kf2['time'] - kf1['time'])
            return {
                'time': time,
                'x': kf1['x'] + t * (kf2['x'] - kf1['x']),
                'y': kf1['y'] + t * (kf2['y'] - kf1['y']),
                'width': kf1['width'] + t * (kf2['width'] - kf1['width']),
                'height': kf1['height'] + t * (kf2['height'] - kf1['height']),
            }

    return sorted_kf[-1].copy()


# ============================================================================
# Core Processing Function
# ============================================================================

def _process_frames(
    job_id: str,
    upsampler,
    cap,
    frames_dir: str,
    keyframes: list,
    start_frame: int,
    end_frame: int,
    original_fps: float,
    original_width: int,
    original_height: int,
    output_width: int,
    output_height: int,
) -> int:
    """Process frames with the given upsampler."""
    import cv2

    sorted_keyframes = sorted(keyframes, key=lambda k: k['time'])
    frames_to_process = end_frame - start_frame
    output_frame_idx = 0

    for frame_idx in range(start_frame, end_frame):
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret or frame is None:
            continue

        time_val = frame_idx / original_fps
        crop = _interpolate_crop(sorted_keyframes, time_val)

        if crop:
            x = int(max(0, crop['x']))
            y = int(max(0, crop['y']))
            w = int(crop['width'])
            h = int(crop['height'])

            x = min(x, original_width - 1)
            y = min(y, original_height - 1)
            w = min(w, original_width - x)
            h = min(h, original_height - y)

            cropped = frame[y:y+h, x:x+w]
        else:
            cropped = frame

        try:
            upscaled, _ = upsampler.enhance(cropped, outscale=4)
        except Exception as e:
            logger.warning(f"[{job_id}] Upscale failed for frame {frame_idx}: {e}")
            upscaled = cv2.resize(cropped, (output_width, output_height), interpolation=cv2.INTER_LANCZOS4)

        if upscaled.shape[1] != output_width or upscaled.shape[0] != output_height:
            upscaled = cv2.resize(upscaled, (output_width, output_height), interpolation=cv2.INTER_LANCZOS4)

        frame_path = os.path.join(frames_dir, f"frame_{output_frame_idx:06d}.png")
        cv2.imwrite(frame_path, upscaled)
        output_frame_idx += 1

        if output_frame_idx % 30 == 0:
            progress = int(output_frame_idx / frames_to_process * 100)
            logger.info(f"[{job_id}] Progress: {progress}% ({output_frame_idx}/{frames_to_process})")

    return output_frame_idx


def _encode_video(job_id: str, frames_dir: str, input_path: str, output_path: str, fps: int):
    """Encode frames to video with FFmpeg."""
    import subprocess

    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", os.path.join(frames_dir, "frame_%06d.png"),
        "-i", input_path,
        "-map", "0:v",
        "-map", "1:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg encoding failed: {result.stderr[:500]}")


# ============================================================================
# T4 GPU Functions
# ============================================================================

@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_t4_baseline(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """T4 baseline - matches current production."""
    import cv2

    try:
        logger.info(f"[{job_id}] T4 BASELINE - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            logger.info(f"[{job_id}] Processing {end_frame - start_frame} frames")

            upsampler = _get_model_baseline()
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "T4", "optimization": "baseline"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_t4_cudnn(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """T4 with cudnn.benchmark enabled."""
    import cv2

    try:
        logger.info(f"[{job_id}] T4 CUDNN - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_cudnn_optimized()
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "T4", "optimization": "cudnn"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_t4_compiled(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """T4 with torch.compile()."""
    import cv2

    try:
        logger.info(f"[{job_id}] T4 COMPILED - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_compiled(compile_mode='reduce-overhead')
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "T4", "optimization": "compiled"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_t4_optimized(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """T4 with all optimizations."""
    import cv2

    try:
        logger.info(f"[{job_id}] T4 FULLY OPTIMIZED - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_fully_optimized(gpu_type='T4')
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "T4", "optimization": "fully_optimized"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


# ============================================================================
# L4 GPU Functions
# ============================================================================

@app.function(
    image=upscale_image,
    gpu="L4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_l4_baseline(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """L4 baseline - same code as T4 baseline."""
    import cv2

    try:
        logger.info(f"[{job_id}] L4 BASELINE - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_baseline()
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "L4", "optimization": "baseline"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="L4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_l4_cudnn(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """L4 with cudnn.benchmark enabled."""
    import cv2

    try:
        logger.info(f"[{job_id}] L4 CUDNN - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_cudnn_optimized()
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "L4", "optimization": "cudnn"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="L4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_l4_compiled(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """L4 with torch.compile() using max-autotune mode."""
    import cv2

    try:
        logger.info(f"[{job_id}] L4 COMPILED - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            # L4 can handle max-autotune mode with more VRAM
            upsampler = _get_model_compiled(compile_mode='max-autotune')
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "L4", "optimization": "compiled"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.function(
    image=upscale_image,
    gpu="L4",
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_l4_optimized(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """L4 with all optimizations including TF32."""
    import cv2

    try:
        logger.info(f"[{job_id}] L4 FULLY OPTIMIZED - Starting")

        r2 = get_r2_client()
        bucket = os.environ["R2_BUCKET_NAME"]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = os.path.join(temp_dir, "input.mp4")
            full_input_key = f"{user_id}/{input_key}"
            r2.download_file(bucket, full_input_key, input_path)

            cap = cv2.VideoCapture(input_path)
            original_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            start_frame = 0
            end_frame = total_frames
            if segment_data:
                if 'trim_start' in segment_data:
                    start_frame = int(segment_data['trim_start'] * original_fps)
                if 'trim_end' in segment_data:
                    end_frame = min(int(segment_data['trim_end'] * original_fps), total_frames)

            upsampler = _get_model_fully_optimized(gpu_type='L4')
            frames_dir = os.path.join(temp_dir, "frames")
            os.makedirs(frames_dir, exist_ok=True)

            output_frame_idx = _process_frames(
                job_id, upsampler, cap, frames_dir, keyframes,
                start_frame, end_frame, original_fps,
                original_width, original_height, output_width, output_height
            )
            cap.release()

            output_path = os.path.join(temp_dir, "output.mp4")
            _encode_video(job_id, frames_dir, input_path, output_path, fps)

            full_output_key = f"{user_id}/{output_key}"
            r2.upload_file(output_path, bucket, full_output_key)

            return {"status": "success", "output_key": output_key, "frames_processed": output_frame_idx, "gpu": "L4", "optimization": "fully_optimized"}

    except Exception as e:
        logger.error(f"[{job_id}] Failed: {e}", exc_info=True)
        return {"status": "error", "error": str(e)}


@app.local_entrypoint()
def main():
    """Test entry point."""
    print("Optimized Modal functions ready.")
    print()
    print("T4 functions:")
    print("  - process_framing_ai_t4_baseline")
    print("  - process_framing_ai_t4_cudnn")
    print("  - process_framing_ai_t4_compiled")
    print("  - process_framing_ai_t4_optimized")
    print()
    print("L4 functions:")
    print("  - process_framing_ai_l4_baseline")
    print("  - process_framing_ai_l4_cudnn")
    print("  - process_framing_ai_l4_compiled")
    print("  - process_framing_ai_l4_optimized")
    print()
    print("Deploy with: modal deploy video_processing_optimized.py")
