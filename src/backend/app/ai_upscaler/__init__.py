"""
AI Video Upscaler Package

Modular implementation of AI-powered video upscaling with Real-ESRGAN support.
"""

__all__ = ['utils', 'VideoEncoder', 'KeyframeInterpolator', 'ModelManager', 'FrameEnhancer', 'FrameProcessor', 'AIVideoUpscaler']

import cv2
import torch
import numpy as np
from pathlib import Path
import os
import subprocess
import logging
import contextlib
from typing import List, Dict, Any, Tuple, Optional
import tempfile
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
from datetime import datetime
import json

from ..constants import VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT, AI_UPSCALE_FACTOR

# Import utilities
from . import utils
from .utils import setup_torchvision_compatibility, detect_aspect_ratio, enhance_frame_opencv
from .video_encoder import VideoEncoder
from .keyframe_interpolator import KeyframeInterpolator
from .model_manager import ModelManager
from .frame_enhancer import FrameEnhancer
from .frame_processor import FrameProcessor

# Try to import diffusion SR model
try:
    from diffusers import StableDiffusionUpscalePipeline
    DIFFUSION_SR_AVAILABLE = True
except ImportError:
    DIFFUSION_SR_AVAILABLE = False

# Setup torchvision compatibility
setup_torchvision_compatibility()

# Configure logging
logging.getLogger('basicsr').setLevel(logging.CRITICAL)
logging.getLogger('realesrgan').setLevel(logging.CRITICAL)
os.environ['REALESRGAN_VERBOSE'] = '0'

logger = logging.getLogger(__name__)


def get_video_metadata_ffprobe(video_path: str) -> Optional[Dict[str, Any]]:
    """
    Get accurate video metadata using ffprobe.
    This reads container metadata which matches what browsers report.

    Args:
        video_path: Path to the video file

    Returns:
        Dict with 'duration', 'fps', 'frame_count', 'width', 'height' or None on failure
    """
    try:
        # Get stream info including duration and frame count
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-select_streams', 'v:0',
                '-show_entries', 'stream=duration,r_frame_rate,nb_frames,width,height',
                '-show_entries', 'format=duration',
                '-of', 'json',
                video_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            logger.warning(f"ffprobe failed for {video_path}: {result.stderr}")
            return None

        data = json.loads(result.stdout)

        # Get stream info
        stream = data.get('streams', [{}])[0]
        format_info = data.get('format', {})

        # Get FPS (r_frame_rate is like "30/1" or "30000/1001")
        fps_str = stream.get('r_frame_rate', '30/1')
        fps_parts = fps_str.split('/')
        fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else float(fps_parts[0])

        # Get duration - prefer stream duration, fall back to format duration
        duration = None
        if stream.get('duration'):
            duration = float(stream['duration'])
        elif format_info.get('duration'):
            duration = float(format_info['duration'])

        # Get frame count from stream if available
        frame_count = None
        if stream.get('nb_frames'):
            frame_count = int(stream['nb_frames'])
        elif duration and fps:
            # Calculate from duration and fps
            frame_count = round(duration * fps)

        return {
            'duration': duration,
            'fps': fps,
            'frame_count': frame_count,
            'width': int(stream.get('width', 0)),
            'height': int(stream.get('height', 0))
        }
    except Exception as e:
        logger.warning(f"Failed to get video metadata via ffprobe: {e}")
        return None


class AIVideoUpscaler:
    """
    AI-powered video upscaler with support for:
    - De-zooming (removing digital zoom/crop)
    - Frame-by-frame upscaling with Real-ESRGAN
    - Variable resolution input frames
    - Target resolution based on aspect ratio
    """

    def __init__(self, model_name: str = 'RealESRGAN_x4plus', device: str = 'cuda', enable_multi_gpu: bool = True, export_mode: str = 'quality', sr_backend: str = 'realesrgan', enable_source_preupscale: bool = False, enable_diffusion_sr: bool = False, enable_multipass: bool = True, custom_enhance_params: Optional[Dict] = None, pre_enhance_source: bool = False, pre_enhance_params: Optional[Dict] = None, tile_size: int = 0, ffmpeg_codec: Optional[str] = None, ffmpeg_preset: Optional[str] = None, ffmpeg_crf: Optional[str] = None, sr_model_name: Optional[str] = None):
        """
        Initialize the AI upscaler

        Args:
            model_name: Model to use for upscaling (deprecated, use sr_model_name)
            device: 'cuda' for GPU or 'cpu' for CPU processing
            enable_multi_gpu: Enable multi-GPU parallel processing (default: True)
            export_mode: Export mode - "fast" or "quality" (default "quality")
            sr_backend: Super-resolution backend - "realesrgan" or "realbasicvsr" (default "realesrgan")
            enable_source_preupscale: Pre-upscale source frame before cropping (default: False)
            enable_diffusion_sr: Enable Stable Diffusion upscaler for extreme cases (default: False)
            enable_multipass: Enable multi-pass upscaling for >4x scales (default: True)
            custom_enhance_params: Custom enhancement parameters to override adaptive selection (default: None)
            pre_enhance_source: Apply enhancement to source BEFORE Real-ESRGAN (default: False)
            pre_enhance_params: Parameters for pre-enhancement (default: None)
            tile_size: Tile size for Real-ESRGAN processing, 0=no tiling (default: 0)
            ffmpeg_codec: FFmpeg codec override (e.g., 'libx264', 'libx265') (default: None = auto)
            ffmpeg_preset: FFmpeg preset override (e.g., 'fast', 'medium', 'slow') (default: None = auto)
            ffmpeg_crf: FFmpeg CRF override (e.g., '10', '15', '18') (default: None = auto)
            sr_model_name: Super-resolution model name (default: None = use model_name or 'RealESRGAN_x4plus')
                Supported models:
                - 'RealESRGAN_x4plus' (default, best balance of speed/quality)
                - 'RealESRGAN_x4plus_anime_6B' (anime-optimized)
                - 'realesr_general_x4v3' (newer general model)
                - 'SwinIR_4x' (transformer-based, better global context)
                - 'SwinIR_4x_GAN' (SwinIR with GAN training for perceptual quality)
                - 'HAT_4x' (Hybrid Attention Transformer, state-of-the-art)
        """
        # Instance variables
        self.export_mode = export_mode
        self.sr_backend = sr_backend
        self.enable_source_preupscale = enable_source_preupscale
        self.enable_diffusion_sr = enable_diffusion_sr
        self.enable_multipass = enable_multipass
        self.custom_enhance_params = custom_enhance_params
        self.pre_enhance_source = pre_enhance_source
        self.pre_enhance_params = pre_enhance_params or {}
        self.diffusion_model = None
        self.progress_lock = threading.Lock()

        # Initialize video encoder
        self.video_encoder = VideoEncoder(
            codec=ffmpeg_codec,
            preset=ffmpeg_preset,
            crf=ffmpeg_crf
        )

        # Initialize model manager (handles GPU detection, model setup, multi-GPU)
        self.model_manager = ModelManager(
            model_name=sr_model_name or model_name,
            device=device,
            enable_multi_gpu=enable_multi_gpu,
            tile_size=tile_size,
            export_mode=export_mode
        )

        # Backward compatibility: expose model_manager properties
        self.device = self.model_manager.device
        self.num_gpus = self.model_manager.num_gpus
        self.enable_multi_gpu = enable_multi_gpu
        self.model_name = model_name
        self.sr_model_name = sr_model_name or model_name

        # Legacy attributes for compatibility
        self.upsampler = self.model_manager.backend  # Primary backend
        self.upsamplers = self.model_manager.backends  # Multi-GPU backends
        self.tile_size = tile_size
        self.vsr_model = None  # For RealBasicVSR compatibility
        self.swinir_model = None  # Legacy compatibility
        self.hat_model = None  # Legacy compatibility
        self.current_sr_model = 'realesrgan'  # Default

        # Setup diffusion SR if enabled (placeholder for now)
        diffusion_model = None
        if self.enable_diffusion_sr and DIFFUSION_SR_AVAILABLE:
            # TODO: Setup diffusion SR model
            logger.warning("Diffusion SR requested but not yet fully implemented")
        elif self.enable_diffusion_sr and not DIFFUSION_SR_AVAILABLE:
            logger.warning("Diffusion SR requested but diffusers package not installed")
            logger.warning("To install: pip install diffusers transformers accelerate")

        # Initialize frame enhancer
        self.frame_enhancer = FrameEnhancer(
            model_manager=self.model_manager,
            device=self.device,
            export_mode=export_mode,
            enable_multipass=enable_multipass,
            custom_enhance_params=custom_enhance_params,
            pre_enhance_source=pre_enhance_source,
            pre_enhance_params=pre_enhance_params,
            enable_diffusion_sr=enable_diffusion_sr,
            diffusion_model=diffusion_model
        )

        # Initialize frame processor
        self.frame_processor = FrameProcessor(
            model_manager=self.model_manager,
            frame_enhancer=self.frame_enhancer,
            device=self.device,
            export_mode=export_mode,
            enable_source_preupscale=enable_source_preupscale
        )

    def detect_aspect_ratio(self, width: int, height: int) -> Tuple[str, Tuple[int, int]]:
        """Wrapper for utils.detect_aspect_ratio - kept for backward compatibility"""
        return detect_aspect_ratio(width, height)

    def enhance_frame_opencv(self, frame: np.ndarray, target_size: Tuple[int, int]) -> np.ndarray:
        """Wrapper for utils.enhance_frame_opencv - kept for backward compatibility"""
        return enhance_frame_opencv(frame, target_size)

    def update_peak_vram(self):
        """Update peak VRAM usage tracking - delegates to ModelManager"""
        self.model_manager.update_peak_vram()

    def get_peak_vram_mb(self) -> float:
        """Get peak VRAM usage in MB - delegates to ModelManager"""
        return self.model_manager.get_peak_vram_mb()

    def reset_peak_vram(self):
        """Reset peak VRAM tracking - delegates to ModelManager"""
        self.model_manager.reset_peak_vram()

    def get_adaptive_enhancement_params(self, scale_factor: float) -> Dict:
        """Wrapper for frame_enhancer.get_adaptive_enhancement_params - kept for backward compatibility"""
        return self.frame_enhancer.get_adaptive_enhancement_params(scale_factor)

    def apply_detail_enhancement(self, image: np.ndarray) -> np.ndarray:
        """Wrapper for frame_enhancer.apply_detail_enhancement - kept for backward compatibility"""
        return self.frame_enhancer.apply_detail_enhancement(image)

    def apply_edge_enhancement(self, image: np.ndarray) -> np.ndarray:
        """Wrapper for frame_enhancer.apply_edge_enhancement - kept for backward compatibility"""
        return self.frame_enhancer.apply_edge_enhancement(image)

    def multi_pass_upscale(self, frame: np.ndarray, target_scale: float) -> np.ndarray:
        """Wrapper for frame_enhancer.multi_pass_upscale - kept for backward compatibility"""
        return self.frame_enhancer.multi_pass_upscale(frame, target_scale)

    def enhance_frame_ai(self, frame: np.ndarray, target_size: Tuple[int, int]) -> np.ndarray:
        """Wrapper for frame_enhancer.enhance_frame_ai - kept for backward compatibility"""
        return self.frame_enhancer.enhance_frame_ai(frame, target_size)

    def get_upsampler_for_gpu(self, gpu_id: int):
        """
        Get the upsampler instance for a specific GPU - delegates to ModelManager

        Args:
            gpu_id: GPU device ID

        Returns:
            Model backend for the specified GPU
        """
        return self.model_manager.get_backend_for_gpu(gpu_id)

    def pre_upscale_source_frame(self, frame: np.ndarray, crop: Dict, scale: float = 2.0) -> Tuple[np.ndarray, Dict]:
        """Wrapper for frame_enhancer.pre_upscale_source_frame - kept for backward compatibility"""
        return self.frame_enhancer.pre_upscale_source_frame(frame, crop, scale)

    def process_single_frame(
        self,
        frame_data: Tuple[int, str, Dict, Tuple[int, int], int, float, Optional[Dict], Tuple[int, int]]
    ) -> Tuple[int, np.ndarray, bool]:
        """Wrapper for frame_processor.process_single_frame - kept for backward compatibility"""
        return self.frame_processor.process_single_frame(frame_data)

    def extract_frame_with_crop(
        self,
        video_path: str,
        frame_number: int,
        crop: Optional[Dict[str, float]] = None
    ) -> np.ndarray:
        """Wrapper for frame_processor.extract_frame_with_crop - kept for backward compatibility"""
        return self.frame_processor.extract_frame_with_crop(video_path, frame_number, crop)

    def process_with_realbasicvsr(
        self,
        input_path: str,
        keyframes_sorted: List[Dict[str, Any]],
        target_resolution: Tuple[int, int],
        total_frames: int,
        original_fps: float,
        frames_dir: Path,
        progress_callback=None,
        start_frame: int = 0
    ) -> int:
        """
        Process video using RealBasicVSR temporal super-resolution

        Args:
            input_path: Path to input video
            keyframes_sorted: Sorted list of keyframes
            target_resolution: Target (width, height)
            total_frames: Total number of frames to process
            original_fps: Original video FPS
            frames_dir: Directory to save enhanced frames
            progress_callback: Optional progress callback
            start_frame: Starting frame index in source video (for trim optimization)

        Returns:
            Number of successfully processed frames
        """
        if self.vsr_model is None:
            raise RuntimeError("RealBasicVSR model not initialized")

        # Create temporary directory for cropped frames
        cropped_dir = frames_dir.parent / "cropped"
        cropped_dir.mkdir(exist_ok=True)

        logger.info("=" * 60)
        logger.info("REALBASICVSR SEQUENCE PROCESSING")
        logger.info("=" * 60)
        logger.info(f"Step 1: Extracting and cropping {total_frames} frames...")
        if start_frame > 0:
            logger.info(f"Trim optimization: Starting from frame {start_frame}")

        # Step 1: Extract and crop all frames (no SR yet)
        # Process only frames in trim range
        for output_frame_idx in range(total_frames):
            source_frame_idx = start_frame + output_frame_idx
            time = source_frame_idx / original_fps
            crop = self.interpolate_crop(keyframes_sorted, time)

            frame = self.extract_frame_with_crop(input_path, source_frame_idx, crop)

            # Save cropped frame with sequential numbering
            frame_path = cropped_dir / f"frame_{output_frame_idx:06d}.png"
            cv2.imwrite(str(frame_path), frame)

            if progress_callback and output_frame_idx % 10 == 0:
                progress_callback(
                    output_frame_idx + 1,
                    total_frames * 2,  # Account for both cropping and upscaling phases
                    f"Cropping frame {output_frame_idx + 1}/{total_frames}",
                    phase='crop'
                )

            if output_frame_idx == 0:
                cropped_h, cropped_w = frame.shape[:2]
                logger.info(f"✓ Cropped frame size: {cropped_w}x{cropped_h}")

        logger.info(f"✓ All {total_frames} frames cropped")

        # Step 2: Run RealBasicVSR on the sequence
        logger.info("=" * 60)
        logger.info("Step 2: Running RealBasicVSR on frame sequence...")
        logger.info("This may take a while for temporal consistency processing...")

        try:
            if hasattr(self, '_mmagic_version') and self._mmagic_version == 'mmagic':
                # MMagic API - process entire directory
                # Get list of cropped frame paths
                frame_paths = sorted(cropped_dir.glob("frame_*.png"))
                frame_list = [str(p) for p in frame_paths]

                # Process with MMagic inferencer
                results = self.vsr_model.infer(
                    video=frame_list,
                    result_out_dir=str(frames_dir)
                )
                logger.info(f"RealBasicVSR processing complete")

            else:
                # MMEdit API (older) - use inference_video
                from mmedit.apis import inference_video
                inference_video(
                    self.vsr_model,
                    str(cropped_dir),
                    str(frames_dir)
                )

            # Verify output frames exist and resize if needed
            output_frames = sorted(frames_dir.glob("frame_*.png"))
            if len(output_frames) == 0:
                # Try alternative output naming from mmagic
                output_frames = sorted(frames_dir.glob("*.png"))

            logger.info(f"✓ RealBasicVSR produced {len(output_frames)} frames")

            # Resize frames to exact target if needed (RealBasicVSR outputs 4x)
            target_w, target_h = target_resolution
            for i, frame_path in enumerate(output_frames):
                frame = cv2.imread(str(frame_path))
                if frame.shape[:2] != (target_h, target_w):
                    frame = cv2.resize(frame, target_resolution, interpolation=cv2.INTER_LANCZOS4)
                    cv2.imwrite(str(frame_path), frame)

                if progress_callback and i % 10 == 0:
                    progress_callback(
                        total_frames + i + 1,
                        total_frames * 2,
                        f"Finalizing frame {i + 1}/{len(output_frames)}",
                        phase='ai_upscale'
                    )

            # Rename frames to expected naming if needed
            if len(output_frames) > 0 and not output_frames[0].name.startswith("frame_"):
                for i, old_path in enumerate(output_frames):
                    new_path = frames_dir / f"frame_{i:06d}.png"
                    if old_path != new_path:
                        shutil.move(str(old_path), str(new_path))

            return len(output_frames)

        except Exception as e:
            logger.error(f"RealBasicVSR processing failed: {e}")
            raise RuntimeError(f"RealBasicVSR processing failed: {e}")
        finally:
            # Cleanup cropped frames
            if cropped_dir.exists():
                shutil.rmtree(cropped_dir)

    def interpolate_crop(
        self,
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Dict[str, float]:
        """Wrapper for KeyframeInterpolator.interpolate_crop - kept for backward compatibility"""
        return KeyframeInterpolator.interpolate_crop(keyframes, time)

    def interpolate_highlight(
        self,
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Optional[Dict[str, Any]]:
        """Wrapper for KeyframeInterpolator.interpolate_highlight - kept for backward compatibility"""
        return KeyframeInterpolator.interpolate_highlight(keyframes, time)

    def render_highlight_on_frame(
        self,
        frame: np.ndarray,
        highlight: Dict[str, Any],
        original_video_size: Tuple[int, int],
        crop: Optional[Dict[str, float]] = None,
        effect_type: str = "original"
    ) -> np.ndarray:
        """Wrapper for KeyframeInterpolator.render_highlight_on_frame - kept for backward compatibility"""
        return KeyframeInterpolator.render_highlight_on_frame(frame, highlight, original_video_size, crop, effect_type)

    def process_video_with_upscale(
        self,
        input_path: str,
        output_path: str,
        keyframes: List[Dict[str, Any]],
        target_fps: int = 30,
        export_mode: str = "quality",
        progress_callback=None,
        segment_data: Optional[Dict[str, Any]] = None,
        include_audio: bool = True,
        highlight_keyframes: Optional[List[Dict[str, Any]]] = None,
        highlight_effect_type: str = "original"
    ) -> Dict[str, Any]:
        """
        Process video with de-zoom and AI upscaling

        Args:
            input_path: Path to input video
            output_path: Path to output video
            keyframes: List of crop keyframes
            target_fps: Output framerate
            export_mode: Export mode - "fast" or "quality" (default "quality")
            progress_callback: Optional callback(current, total, message)
            segment_data: Optional segment speed/trim data containing:
                - segments: List of {start, end, speed} for speed adjustments
                  (speed = 0.5 requires AI frame interpolation)
                - trim_start, trim_end: Trim points
            include_audio: Include audio in export (default True)
            highlight_keyframes: Optional list of highlight keyframes for overlay rendering

        Returns:
            Dict with processing results
        """
        # Get accurate video metadata using ffprobe (matches browser's duration reporting)
        ffprobe_metadata = get_video_metadata_ffprobe(input_path)

        # Get video info from OpenCV as fallback/verification
        cap = cv2.VideoCapture(input_path)
        opencv_total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        opencv_fps = cap.get(cv2.CAP_PROP_FPS)
        original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Use ffprobe values if available, fall back to OpenCV
        if ffprobe_metadata:
            original_fps = ffprobe_metadata['fps']
            ffprobe_frame_count = ffprobe_metadata['frame_count'] or opencv_total_frames
            container_duration = ffprobe_metadata['duration']
            logger.info(f"Using ffprobe metadata: fps={original_fps}, frames={ffprobe_frame_count}, duration={container_duration:.6f}s")
        else:
            original_fps = opencv_fps
            ffprobe_frame_count = opencv_total_frames
            container_duration = None
            logger.warning("ffprobe metadata unavailable, using OpenCV values")

        # Use the MINIMUM of ffprobe and OpenCV frame counts as starting point
        # ffprobe can report more frames than OpenCV can actually read
        video_total_frames = min(ffprobe_frame_count, opencv_total_frames)

        # Verify the last frame is actually readable
        # If not, binary search to find the actual last readable frame
        if video_total_frames > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, video_total_frames - 1)
            ret, _ = cap.read()
            if not ret:
                logger.warning(f"Last frame (index {video_total_frames - 1}) not readable, probing for actual count...")
                low, high = 0, video_total_frames - 1
                actual_last = 0
                while low <= high:
                    mid = (low + high) // 2
                    cap.set(cv2.CAP_PROP_POS_FRAMES, mid)
                    ret, _ = cap.read()
                    if ret:
                        actual_last = mid
                        low = mid + 1
                    else:
                        high = mid - 1
                video_total_frames = actual_last + 1
                logger.info(f"Actual readable frame count: {video_total_frames}")

        # Calculate duration: use actual readable frames for accuracy
        duration = video_total_frames / original_fps

        cap.release()

        # DIAGNOSTIC: Log all metadata sources for debugging duration mismatch
        logger.info("=" * 60)
        logger.info("SOURCE VIDEO ANALYSIS")
        logger.info("=" * 60)
        if ffprobe_metadata:
            logger.info(f"  [ffprobe] container_duration: {container_duration:.6f}s")
            logger.info(f"  [ffprobe] fps: {ffprobe_metadata['fps']}")
            logger.info(f"  [ffprobe] frame_count: {ffprobe_frame_count}")
        logger.info(f"  [OpenCV] CAP_PROP_FRAME_COUNT: {opencv_total_frames}")
        logger.info(f"  [OpenCV] CAP_PROP_FPS: {opencv_fps}")
        logger.info(f"  [FINAL] video_total_frames (verified readable): {video_total_frames}")
        logger.info(f"  [FINAL] original_fps: {original_fps}")
        logger.info(f"  [FINAL] duration: {duration:.6f}s")
        logger.info("=" * 60)

        # Store original video size for highlight rendering
        original_video_size = (original_width, original_height)

        # Calculate which frames to process based on trim range
        # This optimization avoids upscaling frames that get thrown away during encoding!
        if segment_data and 'trim_start' in segment_data:
            start_frame = round(segment_data['trim_start'] * original_fps)
            # Cap end_frame to actual video frame count to prevent reading non-existent frames
            # Use round() instead of int() to avoid floating-point precision loss
            # (e.g., int(299/26.66*26.66) = int(298.999) = 298, losing a frame)
            end_frame = min(
                round(segment_data.get('trim_end', duration) * original_fps),
                video_total_frames
            )
            # Also cap start_frame just in case
            start_frame = min(start_frame, video_total_frames - 1)
            total_frames = end_frame - start_frame
            logger.info(f"Trim optimization: Processing only frames {start_frame}-{end_frame} ({total_frames} frames)")
            logger.info(f"Video has {video_total_frames} total frames")
            logger.info(f"Skipping {start_frame + (video_total_frames - end_frame)} frames that would be discarded!")
        else:
            start_frame = 0
            total_frames = video_total_frames

        logger.info(f"Processing {total_frames} frames @ {original_fps} fps")
        logger.info(f"Original video dimensions: {original_width}x{original_height}")
        logger.info(f"Export mode: {export_mode.upper()}")

        # Sort keyframes by time
        keyframes_sorted = sorted(keyframes, key=lambda k: k['time'])

        logger.info("=" * 60)
        logger.info("KEYFRAME ANALYSIS")
        logger.info("=" * 60)
        logger.info(f"Total keyframes: {len(keyframes_sorted)}")
        for i, kf in enumerate(keyframes_sorted):
            logger.info(f"  Keyframe {i+1}: t={kf['time']:.2f}s, crop={int(kf['width'])}x{int(kf['height'])} at ({int(kf['x'])}, {int(kf['y'])})")

        # Log highlight keyframes if provided
        if highlight_keyframes and len(highlight_keyframes) > 0:
            highlight_sorted = sorted(highlight_keyframes, key=lambda k: k['time'])
            logger.info("=" * 60)
            logger.info("HIGHLIGHT OVERLAY ANALYSIS")
            logger.info("=" * 60)
            logger.info(f"Total highlight keyframes: {len(highlight_sorted)}")
            for i, hkf in enumerate(highlight_sorted):
                logger.info(f"  Highlight {i+1}: t={hkf['time']:.2f}s, pos=({hkf['x']:.1f}px, {hkf['y']:.1f}px), "
                           f"radii=({hkf['radiusX']:.1f}, {hkf['radiusY']:.1f})px, "
                           f"opacity={hkf['opacity']:.2f}, color={hkf['color']}")
            highlight_end_time = highlight_sorted[-1]['time']
            logger.info(f"Highlight will be rendered for first {highlight_end_time:.2f}s of video")
        else:
            logger.info("No highlight keyframes provided - exporting without highlight overlay")
            highlight_keyframes = []  # Ensure it's an empty list

        # Log segment data if provided
        if segment_data:
            logger.info("=" * 60)
            logger.info("SEGMENT SPEED/TRIM ANALYSIS")
            logger.info("=" * 60)
            if 'segments' in segment_data:
                logger.info(f"Speed-adjusted segments: {len(segment_data['segments'])}")
                for seg in segment_data['segments']:
                    speed = seg['speed']
                    logger.info(f"  {seg['start']:.2f}s - {seg['end']:.2f}s: {speed}x speed")
                    if speed == 0.5:
                        logger.info(f"    → Will generate AI interpolated frames (2x frame count)")
            if 'trim_start' in segment_data or 'trim_end' in segment_data:
                trim_start = segment_data.get('trim_start', 0)
                trim_end = segment_data.get('trim_end', duration)
                logger.info(f"Trim range: {trim_start:.2f}s to {trim_end:.2f}s")
        else:
            logger.info("No segment speed/trim data provided - using normal playback speed")

        # Determine target resolution from first frame
        # Get crop at time 0 to determine aspect ratio
        logger.info("=" * 60)
        logger.info("RESOLUTION DETECTION")
        logger.info("=" * 60)
        initial_crop = self.interpolate_crop(keyframes_sorted, 0)

        # Use smart resolution capping instead of forcing 4K
        crop_w = int(initial_crop['width'])
        crop_h = int(initial_crop['height'])

        # Ideal upscaled size (4x for Real-ESRGAN)
        sr_w = crop_w * AI_UPSCALE_FACTOR
        sr_h = crop_h * AI_UPSCALE_FACTOR

        # Clamp to max resolution (1440p for quality, avoids over-upscaling small crops)
        max_w, max_h = VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT
        scale_limit = min(max_w / sr_w, max_h / sr_h, 1.0)

        target_w = int(sr_w * scale_limit)
        target_h = int(sr_h * scale_limit)

        # Ensure even dimensions for video encoding
        target_w = target_w - (target_w % 2)
        target_h = target_h - (target_h % 2)

        target_resolution = (target_w, target_h)
        aspect_type = 'custom_sr'

        logger.info(f"Crop dimensions: {crop_w}x{crop_h}")
        logger.info(f"Ideal 4x SR: {sr_w}x{sr_h}")
        logger.info(f"Scale limit (capped to 1440p): {scale_limit:.3f}")
        logger.info(f"✓ Target resolution: {target_w}x{target_h}")

        # Create temp directory for frames
        temp_dir = tempfile.mkdtemp(prefix='upscale_')
        frames_dir = Path(temp_dir) / 'enhanced'
        frames_dir.mkdir(exist_ok=True)

        try:
            # Verify AI model is ready (should have been checked earlier, but double-check)
            if self.upsampler is None:
                raise RuntimeError("Real-ESRGAN model not initialized - cannot proceed with AI upscaling")

            logger.info("=" * 60)
            logger.info("PROCESSING PIPELINE - MAXIMUM QUALITY MODE")
            logger.info("=" * 60)
            logger.info(f"✓ Real-ESRGAN AI model active")
            logger.info(f"✓ Device: {self.device}")
            logger.info(f"✓ Target resolution: {target_resolution[0]}x{target_resolution[1]}")

            # Test interpolation smoothness (log a few sample points)
            logger.info("=" * 60)
            logger.info("INTERPOLATION TEST (sample frames)")
            logger.info("=" * 60)
            test_frames = [start_frame, start_frame + int(total_frames * 0.25), start_frame + int(total_frames * 0.5), start_frame + int(total_frames * 0.75), start_frame + total_frames - 1]
            for test_idx in test_frames:
                test_time = test_idx / original_fps
                test_crop = self.interpolate_crop(keyframes_sorted, test_time)
                logger.info(f"  Frame {test_idx} @ {test_time:.2f}s: crop={int(test_crop['width'])}x{int(test_crop['height'])} at ({int(test_crop['x'])}, {int(test_crop['y'])})")

            # Process frames - use multi-GPU if available, otherwise sequential
            ai_upscale_start = datetime.now()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] AI_UPSCALE START - {ai_upscale_start.isoformat()}")
            logger.info("STARTING FRAME PROCESSING")
            logger.info("=" * 60)

            # Determine processing mode and worker count
            use_multi_gpu = self.num_gpus > 1 and self.enable_multi_gpu and torch.cuda.is_available()
            num_workers = self.num_gpus if use_multi_gpu else 1

            if use_multi_gpu:
                logger.info(f"✓ Multi-GPU parallel processing with {num_workers} workers")
                logger.info(f"  Frames will be distributed across {self.num_gpus} GPUs")
            else:
                logger.info(f"Sequential processing on single device")

            logger.info("=" * 60)

            # Check if using RealBasicVSR backend
            if self.sr_backend == 'realbasicvsr' and self.vsr_model is not None:
                logger.info("Using RealBasicVSR temporal super-resolution backend")
                completed_frames = self.process_with_realbasicvsr(
                    input_path,
                    keyframes_sorted,
                    target_resolution,
                    total_frames,
                    original_fps,
                    frames_dir,
                    progress_callback,
                    start_frame=start_frame
                )
                failed_frames = []
            else:
                # Use Real-ESRGAN frame-by-frame processing
                logger.info("Using Real-ESRGAN frame-by-frame super-resolution backend")

                # Prepare frame processing tasks
                # Process only frames in trim range: start_frame to (start_frame + total_frames)
                frame_tasks = []
                for output_frame_idx in range(total_frames):
                    # Actual frame index in the source video
                    frame_idx = start_frame + output_frame_idx
                    time = frame_idx / original_fps
                    crop = self.interpolate_crop(keyframes_sorted, time)

                    # Get highlight for this frame (if any)
                    highlight = None
                    if highlight_keyframes and len(highlight_keyframes) > 0:
                        highlight = self.interpolate_highlight(highlight_keyframes, time)

                    # Assign GPU in round-robin fashion
                    gpu_id = output_frame_idx % num_workers if use_multi_gpu else 0

                    # Store task with both indices: (output_idx, source_frame_idx, ...)
                    frame_tasks.append((output_frame_idx, frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size, highlight_effect_type))

                # Track progress
                completed_frames = 0
                failed_frames = []

                if use_multi_gpu:
                    # Multi-GPU parallel processing with ThreadPoolExecutor
                    logger.info(f"Submitting {total_frames} frames to {num_workers} GPU workers...")

                    with ThreadPoolExecutor(max_workers=num_workers) as executor:
                        # Submit all tasks
                        future_to_frame = {
                            executor.submit(self.process_single_frame, task): task[0]
                            for task in frame_tasks
                        }

                        # Process completed frames as they finish
                        for future in as_completed(future_to_frame):
                            frame_idx = future_to_frame[future]

                            try:
                                result_idx, enhanced, success = future.result()

                                if success and enhanced is not None:
                                    # Save enhanced frame
                                    frame_path = frames_dir / f"frame_{result_idx:06d}.png"
                                    cv2.imwrite(str(frame_path), enhanced)

                                    # Verify first frame
                                    if result_idx == 0:
                                        final_h, final_w = enhanced.shape[:2]
                                        logger.info(f"✓ First frame upscaled: {final_w}x{final_h}")

                                    # Thread-safe progress update
                                    with self.progress_lock:
                                        completed_frames += 1

                                        if progress_callback:
                                            progress_callback(
                                                completed_frames,
                                                total_frames,
                                                f"Upscaling frame {completed_frames}/{total_frames} (Multi-GPU)",
                                                phase='ai_upscale'
                                            )

                                        # Periodic GPU cleanup every 10 frames
                                        if completed_frames % 10 == 0 and torch.cuda.is_available():
                                            torch.cuda.empty_cache()

                                        # Force garbage collection every 50 frames
                                        if completed_frames % 50 == 0:
                                            import gc
                                            gc.collect()

                                    # Clear frame reference
                                    del enhanced
                                else:
                                    failed_frames.append(result_idx)
                                    logger.error(f"Frame {result_idx} processing failed")

                            except Exception as e:
                                logger.error(f"Error processing frame {frame_idx}: {e}")
                                import traceback
                                logger.error(f"Traceback: {traceback.format_exc()}")
                                failed_frames.append(frame_idx)

                        # Cleanup GPU memory after batch
                        if torch.cuda.is_available():
                            for gpu_id in range(self.num_gpus):
                                with torch.cuda.device(gpu_id):
                                    torch.cuda.empty_cache()
                        import gc
                        gc.collect()

                else:
                    # Sequential processing (single GPU or CPU)
                    logger.info(f"Processing {total_frames} frames sequentially...")

                    for output_frame_idx in range(total_frames):
                        # Actual frame index in the source video
                        source_frame_idx = start_frame + output_frame_idx
                        time = source_frame_idx / original_fps
                        crop = self.interpolate_crop(keyframes_sorted, time)

                        # Log crop info for first and key frames
                        if output_frame_idx == 0 or output_frame_idx % 30 == 0:
                            logger.info(f"Frame {source_frame_idx} (output {output_frame_idx}) @ {time:.2f}s: crop={int(crop['width'])}x{int(crop['height'])} at ({int(crop['x'])}, {int(crop['y'])})")

                        try:
                            # Extract and crop frame from source video
                            frame = self.extract_frame_with_crop(input_path, source_frame_idx, crop)

                            # Verify frame was cropped
                            cropped_h, cropped_w = frame.shape[:2]
                            if output_frame_idx == 0:
                                logger.info(f"✓ De-zoomed frame size: {cropped_w}x{cropped_h}")

                            # Apply highlight overlay if keyframes are provided
                            if highlight_keyframes and len(highlight_keyframes) > 0:
                                highlight = self.interpolate_highlight(highlight_keyframes, time)
                                if highlight is not None:
                                    frame = KeyframeInterpolator.render_highlight_on_frame(frame, highlight, original_video_size, crop, highlight_effect_type)
                                    if output_frame_idx == 0:
                                        logger.info(f"✓ Highlight overlay applied at ({highlight['x']:.1f}%, {highlight['y']:.1f}%)")
                                elif output_frame_idx == 0:
                                    logger.info("No highlight for first frame (time is after last keyframe)")

                            # AI upscale to target resolution
                            # Send "starting" progress BEFORE AI upscale (which can take 30+ seconds per frame)
                            # This prevents stall detection in tests when local GPU is slow
                            if progress_callback:
                                progress_callback(completed_frames, total_frames, f"AI upscaling frame {completed_frames + 1}/{total_frames}...", phase='ai_upscale')

                            enhanced = self.enhance_frame_ai(frame, target_resolution)

                            # Verify upscaling worked
                            final_h, final_w = enhanced.shape[:2]
                            if output_frame_idx == 0:
                                logger.info(f"✓ Final upscaled size: {final_w}x{final_h}")
                                if (final_w, final_h) != target_resolution:
                                    logger.error(f"⚠ Size mismatch! Expected {target_resolution}, got ({final_w}, {final_h})")

                            # Save enhanced frame with sequential numbering (0, 1, 2, ...)
                            frame_path = frames_dir / f"frame_{output_frame_idx:06d}.png"
                            cv2.imwrite(str(frame_path), enhanced)

                            completed_frames += 1

                            # Progress callback
                            if progress_callback:
                                progress_callback(completed_frames, total_frames, f"Upscaling frame {completed_frames}/{total_frames}", phase='ai_upscale')

                            # Aggressive memory cleanup to prevent VRAM/RAM exhaustion
                            # Clear frame references to allow garbage collection
                            del frame
                            del enhanced

                            # Periodic GPU cleanup every 5 frames (more frequent for stability)
                            if output_frame_idx % 5 == 0 and torch.cuda.is_available():
                                torch.cuda.empty_cache()

                            # Force garbage collection every 30 frames to free numpy arrays
                            if output_frame_idx % 30 == 0:
                                import gc
                                gc.collect()

                        except Exception as e:
                            logger.error(f"Failed to process frame {source_frame_idx} (output {output_frame_idx}): {e}")
                            import traceback
                            logger.error(f"Traceback: {traceback.format_exc()}")
                            failed_frames.append(output_frame_idx)

            # Report any failures
            if failed_frames:
                logger.error(f"⚠ {len(failed_frames)} frames failed to process: {failed_frames}")
                raise RuntimeError(f"{len(failed_frames)} frames failed processing")

            ai_upscale_end = datetime.now()
            ai_upscale_duration = (ai_upscale_end - ai_upscale_start).total_seconds()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] AI_UPSCALE END - {ai_upscale_end.isoformat()}")
            logger.info(f"[EXPORT_PHASE] AI_UPSCALE DURATION - {ai_upscale_duration:.2f} seconds")
            logger.info(f"✓ Successfully processed {completed_frames}/{total_frames} frames")
            logger.info("=" * 60)

            # Prepare segment_data for encoding
            # IMPORTANT: If we've already trimmed frames during processing, we need to tell
            # the encoder that frames are pre-trimmed to avoid double-trimming
            encoding_segment_data = segment_data.copy() if segment_data else None
            frames_already_trimmed = start_frame > 0
            if encoding_segment_data and frames_already_trimmed:
                # Mark that video frames are already trimmed
                encoding_segment_data['frames_pretrimmed'] = True
                logger.info(f"Frames already trimmed during processing (start_frame={start_frame})")

            # Reassemble video with FFmpeg
            self.create_video_from_frames(frames_dir, output_path, target_fps, input_path, export_mode, progress_callback, encoding_segment_data, include_audio)

            return {
                'success': True,
                'total_frames': total_frames,
                'aspect_ratio': aspect_type,
                'target_resolution': target_resolution,
                'output_path': output_path
            }

        finally:
            # Cleanup temp directory
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)

            # Final GPU cleanup
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

    def parse_ffmpeg_progress(self, line: str) -> Optional[int]:
        """Wrapper for VideoEncoder.parse_ffmpeg_progress - kept for backward compatibility"""
        return VideoEncoder.parse_ffmpeg_progress(line)

    def build_atempo_filter(self, speed: float) -> str:
        """Wrapper for VideoEncoder.build_atempo_filter - kept for backward compatibility"""
        return VideoEncoder.build_atempo_filter(speed)


    def create_video_from_frames(
        self,
        frames_dir: Path,
        output_path: str,
        fps: int,
        input_video_path: str,
        export_mode: str = "quality",
        progress_callback=None,
        segment_data: Optional[Dict[str, Any]] = None,
        include_audio: bool = True
    ):
        """
        Create video from enhanced frames using FFmpeg encoding
        Delegates to VideoEncoder for the actual encoding work.
        """
        return self.video_encoder.create_video_from_frames(
            frames_dir=frames_dir,
            output_path=output_path,
            fps=fps,
            input_video_path=input_video_path,
            export_mode=export_mode,
            progress_callback=progress_callback,
            segment_data=segment_data,
            include_audio=include_audio
        )
