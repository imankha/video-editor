"""
AI Video Upscaler Service
Uses Real-ESRGAN for AI-powered video upscaling with de-zoom support
"""

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

# Configure logging
logging.getLogger('basicsr').setLevel(logging.CRITICAL)
logging.getLogger('realesrgan').setLevel(logging.CRITICAL)
os.environ['REALESRGAN_VERBOSE'] = '0'

logger = logging.getLogger(__name__)


class AIVideoUpscaler:
    """
    AI-powered video upscaler with support for:
    - De-zooming (removing digital zoom/crop)
    - Frame-by-frame upscaling with Real-ESRGAN
    - Variable resolution input frames
    - Target resolution based on aspect ratio
    """

    def __init__(self, model_name: str = 'RealESRGAN_x4plus', device: str = 'cuda', enable_multi_gpu: bool = True, export_mode: str = 'quality'):
        """
        Initialize the AI upscaler

        Args:
            model_name: Model to use for upscaling
            device: 'cuda' for GPU or 'cpu' for CPU processing
            enable_multi_gpu: Enable multi-GPU parallel processing (default: True)
            export_mode: Export mode - "fast" or "quality" (default "quality")
        """
        # Detect available GPUs
        self.num_gpus = 0
        self.enable_multi_gpu = enable_multi_gpu
        self.export_mode = export_mode

        if device == 'cuda' and torch.cuda.is_available():
            self.num_gpus = torch.cuda.device_count()
            self.device = torch.device('cuda')

            logger.info("=" * 60)
            logger.info("GPU DETECTION")
            logger.info("=" * 60)
            logger.info(f"CUDA available: Yes")
            logger.info(f"CUDA version: {torch.version.cuda}")
            logger.info(f"Number of GPUs detected: {self.num_gpus}")

            for i in range(self.num_gpus):
                gpu_name = torch.cuda.get_device_name(i)
                logger.info(f"  GPU {i}: {gpu_name}")

            if self.num_gpus > 1 and enable_multi_gpu:
                logger.info(f"✓ Multi-GPU mode ENABLED - will use all {self.num_gpus} GPUs in parallel")
            elif self.num_gpus > 1 and not enable_multi_gpu:
                logger.info(f"Multi-GPU mode DISABLED - will use only GPU 0")
            else:
                logger.info(f"Single GPU mode - using GPU 0")
            logger.info("=" * 60)
        else:
            self.device = torch.device('cpu')
            if device == 'cuda':
                logger.warning("CUDA requested but not available. Falling back to CPU.")
                logger.warning("For GPU acceleration, install PyTorch with CUDA support:")
                logger.warning("  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118")
            logger.info(f"Using device: cpu")

        self.model_name = model_name
        self.upsampler = None
        self.upsamplers = {}  # Dictionary to store upsampler for each GPU
        self.progress_lock = threading.Lock()  # Thread-safe progress tracking

        self.setup_model()

    def setup_model(self):
        """Download and setup Real-ESRGAN model"""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer

            logger.info(f"Initializing Real-ESRGAN model: {self.model_name}")

            # Model configuration
            if self.model_name == 'RealESRGAN_x4plus':
                model = RRDBNet(
                    num_in_ch=3,
                    num_out_ch=3,
                    num_feat=64,
                    num_block=23,
                    num_grow_ch=32,
                    scale=4
                )
                model_path = 'weights/RealESRGAN_x4plus.pth'
            else:
                raise ValueError(f"Unsupported model: {self.model_name}")

            # Download weights if not present
            if not os.path.exists(model_path):
                os.makedirs('weights', exist_ok=True)
                logger.info("Downloading Real-ESRGAN weights (this may take a few minutes)...")
                import wget
                wget.download(
                    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
                    out='weights/'
                )
                logger.info("\nWeights downloaded successfully!")

            # Initialize upsampler optimized for maximum quality
            logger.info(f"Loading model weights from {model_path}...")

            # Determine optimal tile size based on device and export mode
            # Larger tiles = better quality (fewer seams) but more VRAM
            if self.device.type == 'cuda':
                if self.export_mode == 'fast':
                    tile_size = 512  # Tiling for faster processing
                    tile_pad = 10
                    logger.info("GPU detected: Using tiled processing (512x512) for FAST mode")
                else:
                    tile_size = 0  # 0 = no tiling (highest quality, requires more VRAM)
                    tile_pad = 0
                    logger.info("GPU detected: Using full-frame processing for maximum quality")
            else:
                tile_size = 512  # Tiling for CPU to manage memory
                tile_pad = 10
                logger.info("CPU mode: Using tiled processing")

            # Create upsampler for primary device (backward compatibility)
            self.upsampler = RealESRGANer(
                scale=4,
                model_path=model_path,
                dni_weight=None,
                model=model,
                tile=tile_size,
                tile_pad=tile_pad,
                pre_pad=0,
                half=True if self.device.type == 'cuda' else False,  # FP16 for speed on GPU
                device=self.device
            )

            # Store tile configuration
            self.tile_size = tile_size
            self.tile_pad = tile_pad

            # Create separate upsampler instances for each GPU if multi-GPU enabled
            if self.num_gpus > 1 and self.enable_multi_gpu:
                logger.info(f"Initializing Real-ESRGAN models for {self.num_gpus} GPUs...")
                for gpu_id in range(self.num_gpus):
                    # Create a new model instance for each GPU
                    gpu_model = RRDBNet(
                        num_in_ch=3,
                        num_out_ch=3,
                        num_feat=64,
                        num_block=23,
                        num_grow_ch=32,
                        scale=4
                    )

                    gpu_device = torch.device(f'cuda:{gpu_id}')
                    self.upsamplers[gpu_id] = RealESRGANer(
                        scale=4,
                        model_path=model_path,
                        dni_weight=None,
                        model=gpu_model,
                        tile=tile_size,
                        tile_pad=tile_pad,
                        pre_pad=0,
                        half=True,
                        device=gpu_device
                    )
                    logger.info(f"  ✓ GPU {gpu_id} model loaded")

            logger.info("✓ Real-ESRGAN model loaded successfully!")
            logger.info(f"Quality settings: tile_size={tile_size} (0=no tiling, best quality)")

        except ImportError as e:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: Real-ESRGAN dependencies not installed!")
            logger.error("=" * 80)
            logger.error(f"Import error: {e}")
            logger.error("")
            logger.error("The AI upscaling will NOT work - only OpenCV fallback will be used!")
            logger.error("")
            logger.error("To fix, install the dependencies:")
            logger.error("  cd src/backend")
            logger.error("  pip install -r requirements.txt")
            logger.error("  # Then restart the backend")
            logger.error("")
            logger.error("For GPU support, also install:")
            logger.error("  pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118")
            logger.error("=" * 80)
            self.upsampler = None
        except Exception as e:
            error_msg = str(e).lower()
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: Real-ESRGAN setup failed!")
            logger.error("=" * 80)
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error message: {e}")
            logger.error("")

            # Check for specific known issues
            if "numpy" in error_msg or "array" in error_msg:
                logger.error("⚠ This looks like a NumPy version compatibility issue!")
                logger.error("NumPy 2.x is not compatible with many AI packages.")
                logger.error("")
                logger.error("Solution:")
                logger.error("  pip install 'numpy<2.0.0' --force-reinstall")
                logger.error("  # Then restart the backend")
            else:
                logger.error("Possible causes:")
                logger.error("  1. Incompatible package versions (try: pip install -r requirements.txt --upgrade)")
                logger.error("  2. Missing model weights (check 'weights/' directory)")
                logger.error("  3. Insufficient memory (try reducing tile size)")

            logger.error("=" * 80)
            import traceback
            logger.error(traceback.format_exc())
            self.upsampler = None

    def detect_aspect_ratio(self, width: int, height: int) -> Tuple[str, Tuple[int, int]]:
        """
        Detect aspect ratio and determine target resolution

        Args:
            width: Frame width
            height: Frame height

        Returns:
            Tuple of (aspect_ratio_type, target_resolution)
            - aspect_ratio_type: '16:9', '9:16', or 'other'
            - target_resolution: (width, height) tuple
        """
        ratio = width / height

        logger.info(f"Input dimensions: {width}x{height}, ratio: {ratio:.3f}")

        # 16:9 (horizontal) - target 4K (3840x2160)
        if 1.7 <= ratio <= 1.8:  # 16/9 ≈ 1.778
            logger.info(f"✓ Detected 16:9 aspect ratio → Target: 4K (3840x2160)")
            return ('16:9', (3840, 2160))

        # 9:16 (vertical) - target 1080x1920
        elif 0.55 <= ratio <= 0.6:  # 9/16 ≈ 0.5625
            logger.info(f"✓ Detected 9:16 aspect ratio → Target: 1080x1920 (vertical)")
            return ('9:16', (1080, 1920))

        # Other ratios - upscale proportionally to closest standard
        else:
            if ratio > 1:  # Wider than tall - use 4K width
                target = (3840, int(3840 / ratio))
                logger.info(f"✓ Custom wide ratio → Target: {target[0]}x{target[1]}")
                return ('other', target)
            else:  # Taller than wide - use 1080 width
                target = (1080, int(1080 / ratio))
                logger.info(f"✓ Custom tall ratio → Target: {target[0]}x{target[1]}")
                return ('other', target)

    def enhance_frame_opencv(self, frame: np.ndarray, target_size: Tuple[int, int]) -> np.ndarray:
        """
        Fallback enhancement using OpenCV (if Real-ESRGAN not available)

        Args:
            frame: Input frame
            target_size: Target (width, height)

        Returns:
            Enhanced frame
        """
        # Upscale using Lanczos4 interpolation (highest quality)
        upscaled = cv2.resize(frame, target_size, interpolation=cv2.INTER_LANCZOS4)

        # Apply enhancement filters
        # Denoise
        denoised = cv2.fastNlMeansDenoisingColored(upscaled, None, 10, 10, 7, 21)

        # Sharpen
        kernel = np.array([[-1, -1, -1],
                          [-1,  9, -1],
                          [-1, -1, -1]])
        sharpened = cv2.filter2D(denoised, -1, kernel)

        # Enhance contrast using CLAHE
        lab = cv2.cvtColor(sharpened, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced_l = clahe.apply(l)
        enhanced = cv2.merge([enhanced_l, a, b])
        final = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)

        return final

    def enhance_frame_ai(self, frame: np.ndarray, target_size: Tuple[int, int]) -> np.ndarray:
        """
        Enhance a single frame using Real-ESRGAN AI model

        Args:
            frame: Input frame (BGR format)
            target_size: Target (width, height)

        Returns:
            Enhanced frame at target size

        Raises:
            RuntimeError: If Real-ESRGAN is not available
        """
        if self.upsampler is None:
            raise RuntimeError(
                "Real-ESRGAN model not initialized. "
                "AI upscaling requires proper model initialization. "
                "Check server logs for setup errors."
            )

        try:
            # Calculate required scale factor
            current_h, current_w = frame.shape[:2]
            target_w, target_h = target_size

            logger.debug(f"AI upscaling frame from {current_w}x{current_h} to {target_w}x{target_h}")

            # Denoise before upscaling to prevent noise amplification (QUALITY mode only)
            if self.device.type == 'cuda' and self.export_mode == 'quality':
                # Light denoising preserves details
                frame = cv2.bilateralFilter(frame, d=5, sigmaColor=10, sigmaSpace=10)

            # Real-ESRGAN upscales by 4x by default
            # We'll upscale first, then resize to exact target if needed
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                # Upscale with AI (4x)
                enhanced, _ = self.upsampler.enhance(frame, outscale=4)

            upscaled_h, upscaled_w = enhanced.shape[:2]
            logger.debug(f"Real-ESRGAN upscaled to {upscaled_w}x{upscaled_h}")

            # Resize to exact target size if needed (using highest quality interpolation)
            if enhanced.shape[:2] != (target_h, target_w):
                enhanced = cv2.resize(enhanced, target_size, interpolation=cv2.INTER_LANCZOS4)
                logger.debug(f"Resized to exact target: {target_w}x{target_h}")

            # Sharpen upscaled output for better perceived quality (QUALITY mode only)
            if self.device.type == 'cuda' and self.export_mode == 'quality':
                # Gaussian blur for unsharp mask
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
                # Unsharp mask: original + (original - blurred) * amount
                enhanced = cv2.addWeighted(enhanced, 1.5, gaussian, -0.5, 0)
                # Clip values to valid range
                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

            return enhanced
        except Exception as e:
            logger.error(f"Real-ESRGAN processing failed: {e}")
            raise RuntimeError(f"AI upscaling failed: {e}")

    def get_upsampler_for_gpu(self, gpu_id: int):
        """
        Get the upsampler instance for a specific GPU

        Args:
            gpu_id: GPU device ID

        Returns:
            RealESRGANer instance for the specified GPU
        """
        if self.num_gpus > 1 and self.enable_multi_gpu and gpu_id in self.upsamplers:
            return self.upsamplers[gpu_id]
        return self.upsampler

    def process_single_frame(
        self,
        frame_data: Tuple[int, str, Dict, Tuple[int, int], int, float]
    ) -> Tuple[int, np.ndarray, bool]:
        """
        Process a single frame with AI upscaling on a specific GPU

        Args:
            frame_data: Tuple of (frame_idx, input_path, crop, target_resolution, gpu_id, time)

        Returns:
            Tuple of (frame_idx, enhanced_frame, success)
        """
        frame_idx, input_path, crop, target_resolution, gpu_id, time = frame_data

        try:
            # Extract and crop frame
            frame = self.extract_frame_with_crop(input_path, frame_idx, crop)

            # Get the appropriate upsampler for this GPU
            upsampler = self.get_upsampler_for_gpu(gpu_id)

            # AI upscale using the specific GPU's upsampler
            if upsampler is None:
                raise RuntimeError("Real-ESRGAN model not initialized")

            # Calculate required scale factor
            current_h, current_w = frame.shape[:2]
            target_w, target_h = target_resolution

            # Denoise before upscaling to prevent noise amplification (QUALITY mode only)
            gpu_device = torch.device(f'cuda:{gpu_id}') if gpu_id >= 0 else self.device
            if gpu_device.type == 'cuda' and self.export_mode == 'quality':
                # Light denoising preserves details
                frame = cv2.bilateralFilter(frame, d=5, sigmaColor=10, sigmaSpace=10)

            # Real-ESRGAN upscales by 4x by default
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                enhanced, _ = upsampler.enhance(frame, outscale=4)

            upscaled_h, upscaled_w = enhanced.shape[:2]

            # Resize to exact target size if needed
            if enhanced.shape[:2] != (target_h, target_w):
                enhanced = cv2.resize(enhanced, target_resolution, interpolation=cv2.INTER_LANCZOS4)

            # Sharpen upscaled output for better perceived quality (QUALITY mode only)
            if gpu_device.type == 'cuda' and self.export_mode == 'quality':
                # Gaussian blur for unsharp mask
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), 2.0)
                # Unsharp mask: original + (original - blurred) * amount
                enhanced = cv2.addWeighted(enhanced, 1.5, gaussian, -0.5, 0)
                # Clip values to valid range
                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

            # Log occasional progress
            if frame_idx % 30 == 0:
                logger.info(f"GPU {gpu_id}: Processed frame {frame_idx} @ {time:.2f}s")

            return (frame_idx, enhanced, True)

        except Exception as e:
            logger.error(f"GPU {gpu_id}: Failed to process frame {frame_idx}: {e}")
            return (frame_idx, None, False)

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

    def interpolate_crop(
        self,
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Dict[str, float]:
        """
        Interpolate crop values between keyframes for a given time

        Args:
            keyframes: List of keyframe dicts with 'time', 'x', 'y', 'width', 'height'
            time: Time in seconds

        Returns:
            Interpolated crop parameters
        """
        if len(keyframes) == 0:
            raise ValueError("No keyframes provided")

        if len(keyframes) == 1:
            return keyframes[0]

        # Find surrounding keyframes
        before_kf = None
        after_kf = None

        for kf in keyframes:
            if kf['time'] <= time:
                before_kf = kf
            if kf['time'] > time and after_kf is None:
                after_kf = kf
                break

        # If before first keyframe, return first
        if before_kf is None:
            return keyframes[0]

        # If after last keyframe, return last
        if after_kf is None:
            return before_kf

        # Linear interpolation between keyframes
        duration = after_kf['time'] - before_kf['time']
        if duration == 0:
            return before_kf

        progress = (time - before_kf['time']) / duration

        return {
            'x': before_kf['x'] + (after_kf['x'] - before_kf['x']) * progress,
            'y': before_kf['y'] + (after_kf['y'] - before_kf['y']) * progress,
            'width': before_kf['width'] + (after_kf['width'] - before_kf['width']) * progress,
            'height': before_kf['height'] + (after_kf['height'] - before_kf['height']) * progress,
            'time': time
        }

    def process_video_with_upscale(
        self,
        input_path: str,
        output_path: str,
        keyframes: List[Dict[str, Any]],
        target_fps: int = 30,
        export_mode: str = "quality",
        progress_callback=None
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

        Returns:
            Dict with processing results
        """
        # Get video info
        cap = cv2.VideoCapture(input_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        duration = total_frames / original_fps
        cap.release()

        logger.info(f"Processing {total_frames} frames @ {original_fps} fps")
        logger.info(f"Export mode: {export_mode.upper()}")

        # Sort keyframes by time
        keyframes_sorted = sorted(keyframes, key=lambda k: k['time'])

        logger.info("=" * 60)
        logger.info("KEYFRAME ANALYSIS")
        logger.info("=" * 60)
        logger.info(f"Total keyframes: {len(keyframes_sorted)}")
        for i, kf in enumerate(keyframes_sorted):
            logger.info(f"  Keyframe {i+1}: t={kf['time']:.2f}s, crop={int(kf['width'])}x{int(kf['height'])} at ({int(kf['x'])}, {int(kf['y'])})")

        # Determine target resolution from first frame
        # Get crop at time 0 to determine aspect ratio
        logger.info("=" * 60)
        logger.info("RESOLUTION DETECTION")
        logger.info("=" * 60)
        initial_crop = self.interpolate_crop(keyframes_sorted, 0)
        aspect_type, target_resolution = self.detect_aspect_ratio(
            int(initial_crop['width']),
            int(initial_crop['height'])
        )

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
            test_frames = [0, int(total_frames * 0.25), int(total_frames * 0.5), int(total_frames * 0.75), total_frames - 1]
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

            # Prepare frame processing tasks
            frame_tasks = []
            for frame_idx in range(total_frames):
                time = frame_idx / original_fps
                crop = self.interpolate_crop(keyframes_sorted, time)

                # Assign GPU in round-robin fashion
                gpu_id = frame_idx % num_workers if use_multi_gpu else 0

                frame_tasks.append((frame_idx, input_path, crop, target_resolution, gpu_id, time))

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
                            else:
                                failed_frames.append(result_idx)
                                logger.error(f"Frame {result_idx} processing failed")

                        except Exception as e:
                            logger.error(f"Error processing frame {frame_idx}: {e}")
                            failed_frames.append(frame_idx)

                    # Cleanup GPU memory after batch
                    if torch.cuda.is_available():
                        for gpu_id in range(self.num_gpus):
                            with torch.cuda.device(gpu_id):
                                torch.cuda.empty_cache()

            else:
                # Sequential processing (single GPU or CPU)
                logger.info(f"Processing {total_frames} frames sequentially...")

                for frame_idx in range(total_frames):
                    time = frame_idx / original_fps
                    crop = self.interpolate_crop(keyframes_sorted, time)

                    # Log crop info for first and key frames
                    if frame_idx == 0 or frame_idx % 30 == 0:
                        logger.info(f"Frame {frame_idx} @ {time:.2f}s: crop={int(crop['width'])}x{int(crop['height'])} at ({int(crop['x'])}, {int(crop['y'])})")

                    try:
                        # Extract and crop frame
                        frame = self.extract_frame_with_crop(input_path, frame_idx, crop)

                        # Verify frame was cropped
                        cropped_h, cropped_w = frame.shape[:2]
                        if frame_idx == 0:
                            logger.info(f"✓ De-zoomed frame size: {cropped_w}x{cropped_h}")

                        # AI upscale to target resolution
                        enhanced = self.enhance_frame_ai(frame, target_resolution)

                        # Verify upscaling worked
                        final_h, final_w = enhanced.shape[:2]
                        if frame_idx == 0:
                            logger.info(f"✓ Final upscaled size: {final_w}x{final_h}")
                            if (final_w, final_h) != target_resolution:
                                logger.error(f"⚠ Size mismatch! Expected {target_resolution}, got ({final_w}, {final_h})")

                        # Save enhanced frame
                        frame_path = frames_dir / f"frame_{frame_idx:06d}.png"
                        cv2.imwrite(str(frame_path), enhanced)

                        completed_frames += 1

                        # Progress callback
                        if progress_callback:
                            progress_callback(completed_frames, total_frames, f"Upscaling frame {completed_frames}/{total_frames}", phase='ai_upscale')

                        # Periodic GPU cleanup
                        if frame_idx % 10 == 0 and torch.cuda.is_available():
                            torch.cuda.empty_cache()

                    except Exception as e:
                        logger.error(f"Failed to process frame {frame_idx}: {e}")
                        failed_frames.append(frame_idx)

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

            # Reassemble video with FFmpeg
            self.create_video_from_frames(frames_dir, output_path, target_fps, input_path, export_mode, progress_callback)

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
        """
        Parse FFmpeg progress output to extract current frame number

        Args:
            line: Line from FFmpeg stderr output

        Returns:
            Frame number if found, None otherwise
        """
        import re
        # FFmpeg outputs progress lines like: "frame=  126 fps= 38 q=-1.0 ..."
        match = re.search(r'frame=\s*(\d+)', line)
        if match:
            return int(match.group(1))
        return None

    def create_video_from_frames(
        self,
        frames_dir: Path,
        output_path: str,
        fps: int,
        input_video_path: str,
        export_mode: str = "quality",
        progress_callback=None
    ):
        """
        Create video from enhanced frames using FFmpeg encoding

        Args:
            frames_dir: Directory containing frames
            output_path: Output video path
            fps: Output framerate
            input_video_path: Path to input video (for audio)
            export_mode: Export mode - "fast" (1-pass) or "quality" (2-pass)
            progress_callback: Optional callback(current, total, message, phase)
        """
        frames_pattern = str(frames_dir / "frame_%06d.png")

        # Count total frames for progress tracking
        frame_files = list(frames_dir.glob("frame_*.png"))
        total_frames = len(frame_files)
        logger.info(f"Total frames to encode: {total_frames}")

        # Set encoding parameters based on export mode
        if export_mode == "fast":
            codec = "libx264"  # H.264 - faster encoding
            preset = "medium"
            crf = "15"
            logger.info(f"Encoding video with FAST settings (H.264, 1-pass, medium preset, CRF {crf}) at {fps} fps...")
        else:
            codec = "libx265"  # H.265 - better compression
            preset = "veryslow"
            crf = "10"
            logger.info(f"Encoding video with QUALITY settings (H.265, 2-pass, veryslow preset, CRF {crf}) at {fps} fps...")

        # Pass 1 - Analysis (only for quality mode with H.265)
        if export_mode == "quality":
            ffmpeg_pass1_start = datetime.now()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 START - {ffmpeg_pass1_start.isoformat()}")
            logger.info("Starting pass 1 - analyzing video...")
            logger.info("=" * 60)
            cmd_pass1 = [
                'ffmpeg', '-y',
                '-framerate', str(fps),
                '-i', frames_pattern,
                '-i', input_video_path,
                '-map', '0:v', '-map', '1:a?',
                '-c:v', codec,
                '-preset', preset,
                '-crf', crf,
                '-x265-params', 'pass=1:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6',
                '-an',  # No audio in pass 1
                '-f', 'null',
                '/dev/null' if os.name != 'nt' else 'NUL'
            ]

            try:
                # Use Popen to read stderr in real-time for progress monitoring
                process = subprocess.Popen(
                    cmd_pass1,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )

                # Read stderr line by line to track progress
                last_frame = 0
                for line in process.stderr:
                    # Parse frame number from FFmpeg output
                    frame_num = self.parse_ffmpeg_progress(line)
                    if frame_num is not None and frame_num > last_frame:
                        last_frame = frame_num
                        # Send progress callback
                        if progress_callback:
                            progress_callback(
                                frame_num,
                                total_frames,
                                f"Pass 1: Analyzing frame {frame_num}/{total_frames}",
                                phase='ffmpeg_pass1'
                            )

                # Wait for process to complete
                process.wait()

                if process.returncode != 0:
                    # Read any remaining output for error reporting
                    _, stderr = process.communicate()
                    logger.error(f"FFmpeg pass 1 failed with return code {process.returncode}")
                    raise RuntimeError(f"Video encoding pass 1 failed: {stderr}")

                ffmpeg_pass1_end = datetime.now()
                ffmpeg_pass1_duration = (ffmpeg_pass1_end - ffmpeg_pass1_start).total_seconds()
                logger.info("=" * 60)
                logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 END - {ffmpeg_pass1_end.isoformat()}")
                logger.info(f"[EXPORT_PHASE] FFMPEG_PASS1 DURATION - {ffmpeg_pass1_duration:.2f} seconds")
                logger.info("Pass 1 complete!")
                logger.info("=" * 60)
            except subprocess.CalledProcessError as e:
                logger.error(f"FFmpeg pass 1 failed: {e.stderr}")
                raise RuntimeError(f"Video encoding pass 1 failed: {e.stderr}")
            except Exception as e:
                logger.error(f"FFmpeg pass 1 failed: {e}")
                raise RuntimeError(f"Video encoding pass 1 failed: {e}")
        else:
            logger.info("=" * 60)
            logger.info("Skipping pass 1 for FAST mode - using single-pass encoding")
            logger.info("=" * 60)

        # Pass 2 - Encode (or single-pass for fast mode)
        ffmpeg_pass2_start = datetime.now()
        logger.info("=" * 60)
        logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE START - {ffmpeg_pass2_start.isoformat()}")

        if export_mode == "quality":
            logger.info("Starting pass 2 - encoding video...")
        else:
            logger.info("Starting single-pass encoding...")

        logger.info("=" * 60)

        # Build FFmpeg command based on codec
        cmd_pass2 = [
            'ffmpeg', '-y',
            '-framerate', str(fps),
            '-i', frames_pattern,
            '-i', input_video_path,
            '-map', '0:v', '-map', '1:a?',
            '-c:v', codec,
            '-preset', preset,
            '-crf', crf
        ]

        # Add codec-specific parameters
        if codec == 'libx265':
            # H.265 specific parameters
            if export_mode == "quality":
                x265_params = 'pass=2:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'
            else:
                x265_params = 'aq-mode=3:aq-strength=1.0:deblock=-1,-1'
            cmd_pass2.extend(['-x265-params', x265_params])
        # libx264 uses default parameters (no special params needed for fast mode)

        # Add common parameters
        cmd_pass2.extend([
            '-c:a', 'aac', '-b:a', '256k',
            '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-color_range', 'tv',
            '-movflags', '+faststart',
            str(output_path)
        ])

        try:
            # Use Popen to read stderr in real-time for progress monitoring
            process = subprocess.Popen(
                cmd_pass2,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True
            )

            # Read stderr line by line to track progress
            last_frame = 0
            for line in process.stderr:
                # Parse frame number from FFmpeg output
                frame_num = self.parse_ffmpeg_progress(line)
                if frame_num is not None and frame_num > last_frame:
                    last_frame = frame_num
                    # Send progress callback
                    if progress_callback:
                        if export_mode == "quality":
                            message = f"Pass 2: Encoding frame {frame_num}/{total_frames}"
                        else:
                            message = f"Encoding frame {frame_num}/{total_frames}"
                        progress_callback(
                            frame_num,
                            total_frames,
                            message,
                            phase='ffmpeg_encode'
                        )

            # Wait for process to complete
            process.wait()

            if process.returncode != 0:
                # Read any remaining output for error reporting
                _, stderr = process.communicate()
                logger.error(f"FFmpeg encoding failed with return code {process.returncode}")
                raise RuntimeError(f"Video encoding failed: {stderr}")

            ffmpeg_pass2_end = datetime.now()
            ffmpeg_pass2_duration = (ffmpeg_pass2_end - ffmpeg_pass2_start).total_seconds()
            logger.info("=" * 60)
            logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE END - {ffmpeg_pass2_end.isoformat()}")
            logger.info(f"[EXPORT_PHASE] FFMPEG_ENCODE DURATION - {ffmpeg_pass2_duration:.2f} seconds")
            if export_mode == "quality":
                logger.info("Pass 2 complete! Video encoding finished.")
            else:
                logger.info("Single-pass encoding complete!")
            logger.info("=" * 60)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg encoding failed: {e.stderr}")
            raise RuntimeError(f"Video encoding failed: {e.stderr}")
        except Exception as e:
            logger.error(f"FFmpeg encoding failed: {e}")
            raise RuntimeError(f"Video encoding failed: {e}")
