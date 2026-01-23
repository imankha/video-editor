"""
Frame Processing Module

Handles single frame processing operations:
- Frame extraction from video with cropping
- Pre-upscaling source frames before cropping
- Highlight overlay rendering
- Multi-GPU parallel frame processing
"""

import cv2
import torch
import numpy as np
import logging
import os
import contextlib
from typing import Dict, Tuple, Optional

from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator

logger = logging.getLogger(__name__)


class FrameProcessor:
    """
    Handles single frame processing operations

    Responsibilities:
    - Extract frames from video with optional cropping
    - Process single frames with AI upscaling
    - Apply highlight overlays
    - Coordinate pre-upscaling if needed
    """

    def __init__(
        self,
        model_manager,
        frame_enhancer,
        device: torch.device,
        export_mode: str = 'quality',
        enable_source_preupscale: bool = False
    ):
        """
        Initialize frame processor

        Args:
            model_manager: ModelManager instance for accessing SR backends
            frame_enhancer: FrameEnhancer instance for enhancement operations
            device: torch.device for GPU/CPU
            export_mode: 'fast' or 'quality' (default 'quality')
            enable_source_preupscale: Pre-upscale source frame before cropping (default False)
        """
        self.model_manager = model_manager
        self.frame_enhancer = frame_enhancer
        self.device = device
        self.export_mode = export_mode
        self.enable_source_preupscale = enable_source_preupscale

    def release_video_captures(self):
        """Placeholder for cleanup - kept for API compatibility."""
        pass

    def extract_frame_with_crop(
        self,
        video_path: str,
        frame_number: int,
        crop: Optional[Dict[str, float]] = None
    ) -> np.ndarray:
        """
        Extract a single frame from video and apply crop (de-zoom)

        Args:
            video_path: Path to video file
            frame_number: Frame index to extract
            crop: Crop parameters {x, y, width, height} in pixels

        Returns:
            Cropped frame (or full frame if no crop)
        """
        cap = cv2.VideoCapture(video_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()

        # If frame read fails, try falling back to earlier frames
        # This handles cases where CAP_PROP_FRAME_COUNT is inaccurate
        if not ret and frame_number > 0:
            # Try up to 5 frames back
            for fallback in range(1, min(6, frame_number + 1)):
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number - fallback)
                ret, frame = cap.read()
                if ret:
                    logger.warning(f"Frame {frame_number} unreadable, using frame {frame_number - fallback} as fallback")
                    break

        cap.release()

        if not ret:
            raise ValueError(f"Failed to read frame {frame_number} from {video_path}")

        # Apply crop (de-zoom) if provided
        if crop:
            x = int(crop['x'])
            y = int(crop['y'])
            w = int(crop['width'])
            h = int(crop['height'])

            # Ensure crop is within bounds
            frame_h, frame_w = frame.shape[:2]
            x = max(0, min(x, frame_w - 1))
            y = max(0, min(y, frame_h - 1))
            w = max(1, min(w, frame_w - x))
            h = max(1, min(h, frame_h - y))

            frame = frame[y:y+h, x:x+w]

        return frame

    def process_single_frame(
        self,
        frame_data: Tuple[int, str, Dict, Tuple[int, int], int, float, Optional[Dict], Tuple[int, int]] | Tuple[int, int, str, Dict, Tuple[int, int], int, float, Optional[Dict], Tuple[int, int]] | Tuple[int, int, str, Dict, Tuple[int, int], int, float, Optional[Dict], Tuple[int, int], str]
    ) -> Tuple[int, np.ndarray, bool]:
        """
        Process a single frame with AI upscaling on a specific GPU

        Args:
            frame_data: Tuple of (frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size)
                        OR (output_frame_idx, source_frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size)
                        OR (output_frame_idx, source_frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size, highlight_effect_type)
                        The second and third forms are used when processing a trim range - output_frame_idx is used for saving,
                        source_frame_idx is used for extraction.

        Returns:
            Tuple of (output_frame_idx, enhanced_frame, success)
        """
        # Support multiple tuple formats for backward compatibility
        highlight_effect_type = "original"  # Default

        if len(frame_data) == 10:
            # New format with highlight_effect_type
            output_frame_idx, source_frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size, highlight_effect_type = frame_data
            frame_idx = source_frame_idx  # Use source index for extraction
            result_idx = output_frame_idx  # Use output index for saving
        elif len(frame_data) == 9:
            # Format with separate output and source indices (for trim optimization)
            output_frame_idx, source_frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size = frame_data
            frame_idx = source_frame_idx  # Use source index for extraction
            result_idx = output_frame_idx  # Use output index for saving
        else:
            # Old format (backward compatible)
            frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size = frame_data
            result_idx = frame_idx  # Same index for both

        try:
            # Calculate scale factor to determine if pre-upscaling helps
            scale_x = target_resolution[0] / crop['width']
            scale_y = target_resolution[1] / crop['height']
            overall_scale = max(scale_x, scale_y)

            # Pre-upscale source if enabled and scale is extreme
            if self.enable_source_preupscale and overall_scale > 3.5:
                # Extract full frame first (no crop)
                full_frame = self.extract_frame_with_crop(input_path, frame_idx, crop=None)

                # Pre-upscale the entire source frame
                full_frame, adjusted_crop = self.frame_enhancer.pre_upscale_source_frame(full_frame, crop, scale=2.0)

                # Now extract the adjusted crop from upscaled frame
                frame = full_frame[
                    int(adjusted_crop['y']):int(adjusted_crop['y'] + adjusted_crop['height']),
                    int(adjusted_crop['x']):int(adjusted_crop['x'] + adjusted_crop['width'])
                ]

                # Update crop reference for highlight rendering
                crop = adjusted_crop
                # Update original video size to reflect upscaled frame
                original_video_size = (original_video_size[0] * 2, original_video_size[1] * 2)

                if frame_idx % 30 == 0:
                    logger.info(f"Frame {frame_idx}: Pre-upscaled source, new crop size: {frame.shape[1]}x{frame.shape[0]}")
            else:
                # Standard crop extraction
                frame = self.extract_frame_with_crop(input_path, frame_idx, crop)

            # Apply highlight overlay if provided
            if highlight is not None:
                frame = KeyframeInterpolator.render_highlight_on_frame(frame, highlight, original_video_size, crop, highlight_effect_type)

            # Get the appropriate upsampler for this GPU
            upsampler = self.model_manager.get_backend_for_gpu(gpu_id)

            # AI upscale using the specific GPU's upsampler
            if upsampler is None:
                raise RuntimeError("Real-ESRGAN model not initialized")

            # Calculate required scale factor
            current_h, current_w = frame.shape[:2]
            target_w, target_h = target_resolution

            # Denoise before upscaling to prevent noise amplification (QUALITY mode only)
            # Using milder settings to preserve more detail
            gpu_device = torch.device(f'cuda:{gpu_id}') if gpu_id >= 0 else self.device
            if gpu_device.type == 'cuda' and self.export_mode == 'quality':
                # Light denoising - reduced from d=5, sigma=10 to d=3, sigma=5
                frame = cv2.bilateralFilter(frame, d=3, sigmaColor=5, sigmaSpace=5)

            # Calculate desired scale for Real-ESRGAN
            scale_x = target_w / current_w
            scale_y = target_h / current_h
            desired_scale = min(scale_x, scale_y, 4.0)

            # Real-ESRGAN can use outscale < 4 for more efficient processing
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                enhanced, _ = upsampler.enhance(frame, outscale=desired_scale)

            upscaled_h, upscaled_w = enhanced.shape[:2]

            # Resize to exact target size if needed
            if enhanced.shape[:2] != (target_h, target_w):
                enhanced = cv2.resize(enhanced, target_resolution, interpolation=cv2.INTER_LANCZOS4)

            # Sharpen upscaled output for better perceived quality (QUALITY mode only)
            # Using milder unsharp mask to avoid over-sharpening
            if gpu_device.type == 'cuda' and self.export_mode == 'quality':
                # Gaussian blur for unsharp mask - reduced sigma from 2.0 to 1.0
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
                # Unsharp mask: reduced from 1.5/-0.5 to 1.2/-0.2
                enhanced = cv2.addWeighted(enhanced, 1.2, gaussian, -0.2, 0)
                # Clip values to valid range
                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

            # Log occasional progress
            if frame_idx % 30 == 0:
                logger.info(f"GPU {gpu_id}: Processed frame {frame_idx} @ {time:.2f}s")

            return (result_idx, enhanced, True)

        except Exception as e:
            logger.error(f"GPU {gpu_id}: Failed to process frame {frame_idx}: {e}")
            return (result_idx, None, False)
