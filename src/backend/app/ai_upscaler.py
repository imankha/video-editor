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

    def __init__(self, model_name: str = 'RealESRGAN_x4plus', device: str = 'cuda', enable_multi_gpu: bool = True, export_mode: str = 'quality', sr_backend: str = 'realesrgan'):
        """
        Initialize the AI upscaler

        Args:
            model_name: Model to use for upscaling
            device: 'cuda' for GPU or 'cpu' for CPU processing
            enable_multi_gpu: Enable multi-GPU parallel processing (default: True)
            export_mode: Export mode - "fast" or "quality" (default "quality")
            sr_backend: Super-resolution backend - "realesrgan" or "realbasicvsr" (default "realesrgan")
        """
        # Detect available GPUs
        self.num_gpus = 0
        self.enable_multi_gpu = enable_multi_gpu
        self.export_mode = export_mode
        self.sr_backend = sr_backend
        self.vsr_model = None  # For RealBasicVSR

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

        # Setup appropriate backend
        if self.sr_backend == 'realbasicvsr':
            logger.info(f"Using RealBasicVSR backend for video super-resolution")
            self.setup_realbasicvsr()
        else:
            logger.info(f"Using Real-ESRGAN backend for frame-by-frame super-resolution")
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

    def setup_realbasicvsr(self):
        """Setup RealBasicVSR model for temporal video super-resolution"""
        try:
            # Try to import mmagic (formerly mmediting)
            try:
                from mmagic.apis import MMagicInferencer
                logger.info("Using MMagic API for RealBasicVSR")
                self._mmagic_version = 'mmagic'
            except ImportError:
                try:
                    from mmedit.apis import init_model
                    logger.info("Using MMEdit API for RealBasicVSR")
                    self._mmagic_version = 'mmedit'
                except ImportError:
                    logger.error("Neither MMagic nor MMEdit is installed")
                    raise ImportError("RealBasicVSR requires mmagic or mmedit package")

            logger.info(f"Initializing RealBasicVSR model...")

            # Model configuration paths
            # Users need to download these from MMagic model zoo
            weights_dir = Path('weights')
            weights_dir.mkdir(exist_ok=True)

            config_path = weights_dir / 'realbasicvsr_x4.py'
            checkpoint_path = weights_dir / 'realbasicvsr_x4.pth'

            # Check if config and weights exist
            if not config_path.exists() or not checkpoint_path.exists():
                logger.warning("=" * 60)
                logger.warning("RealBasicVSR model files not found!")
                logger.warning("=" * 60)
                logger.warning(f"Expected config: {config_path}")
                logger.warning(f"Expected weights: {checkpoint_path}")
                logger.warning("")
                logger.warning("Please download from MMagic model zoo:")
                logger.warning("  https://github.com/open-mmlab/mmagic/tree/main/configs/realbasicvsr")
                logger.warning("")
                logger.warning("Falling back to Real-ESRGAN backend...")
                logger.warning("=" * 60)
                self.sr_backend = 'realesrgan'
                self.setup_model()
                return

            # Initialize the model
            if self._mmagic_version == 'mmagic':
                # MMagic 1.x API
                self.vsr_model = MMagicInferencer(
                    'realbasicvsr',
                    model_config=str(config_path),
                    model_ckpt=str(checkpoint_path),
                    device=str(self.device)
                )
            else:
                # MMEdit API (older)
                self.vsr_model = init_model(str(config_path), str(checkpoint_path), device=self.device)

            logger.info("✓ RealBasicVSR model loaded successfully!")
            logger.info(f"  Config: {config_path}")
            logger.info(f"  Weights: {checkpoint_path}")
            logger.info(f"  Device: {self.device}")

            # Also initialize Real-ESRGAN as fallback (for fast mode)
            logger.info("Also initializing Real-ESRGAN as fallback...")
            self.setup_model()

        except ImportError as e:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: RealBasicVSR dependencies not installed!")
            logger.error("=" * 80)
            logger.error(f"Import error: {e}")
            logger.error("")
            logger.error("To install MMagic (recommended):")
            logger.error("  pip install mmagic")
            logger.error("  # or for older systems:")
            logger.error("  pip install mmedit")
            logger.error("")
            logger.error("Falling back to Real-ESRGAN backend...")
            logger.error("=" * 80)
            self.sr_backend = 'realesrgan'
            self.setup_model()
        except Exception as e:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: RealBasicVSR setup failed!")
            logger.error("=" * 80)
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error message: {e}")
            logger.error("")
            logger.error("Falling back to Real-ESRGAN backend...")
            logger.error("=" * 80)
            import traceback
            logger.error(traceback.format_exc())
            self.sr_backend = 'realesrgan'
            self.setup_model()

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
            # Using milder settings to preserve more detail
            if self.device.type == 'cuda' and self.export_mode == 'quality':
                # Light denoising - reduced from d=5, sigma=10 to d=3, sigma=5
                frame = cv2.bilateralFilter(frame, d=3, sigmaColor=5, sigmaSpace=5)

            # Calculate desired scale for Real-ESRGAN
            scale_x = target_w / current_w
            scale_y = target_h / current_h
            desired_scale = min(scale_x, scale_y, 4.0)

            # Real-ESRGAN can use outscale < 4 for more efficient processing
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                enhanced, _ = self.upsampler.enhance(frame, outscale=desired_scale)

            upscaled_h, upscaled_w = enhanced.shape[:2]
            logger.debug(f"Real-ESRGAN upscaled to {upscaled_w}x{upscaled_h} (scale={desired_scale:.2f})")

            # Resize to exact target size if needed (using highest quality interpolation)
            if enhanced.shape[:2] != (target_h, target_w):
                enhanced = cv2.resize(enhanced, target_size, interpolation=cv2.INTER_LANCZOS4)
                logger.debug(f"Resized to exact target: {target_w}x{target_h}")

            # Sharpen upscaled output for better perceived quality (QUALITY mode only)
            # Using milder unsharp mask to avoid over-sharpening
            if self.device.type == 'cuda' and self.export_mode == 'quality':
                # Gaussian blur for unsharp mask - reduced sigma from 2.0 to 1.0
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), 1.0)
                # Unsharp mask: reduced from 1.5/-0.5 to 1.2/-0.2
                enhanced = cv2.addWeighted(enhanced, 1.2, gaussian, -0.2, 0)
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
        frame_data: Tuple[int, str, Dict, Tuple[int, int], int, float, Optional[Dict], Tuple[int, int]]
    ) -> Tuple[int, np.ndarray, bool]:
        """
        Process a single frame with AI upscaling on a specific GPU

        Args:
            frame_data: Tuple of (frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size)

        Returns:
            Tuple of (frame_idx, enhanced_frame, success)
        """
        frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size = frame_data

        try:
            # Extract and crop frame
            frame = self.extract_frame_with_crop(input_path, frame_idx, crop)

            # Apply highlight overlay if provided
            if highlight is not None:
                frame = self.render_highlight_on_frame(frame, highlight, original_video_size, crop)

            # Get the appropriate upsampler for this GPU
            upsampler = self.get_upsampler_for_gpu(gpu_id)

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

    def process_with_realbasicvsr(
        self,
        input_path: str,
        keyframes_sorted: List[Dict[str, Any]],
        target_resolution: Tuple[int, int],
        total_frames: int,
        original_fps: float,
        frames_dir: Path,
        progress_callback=None
    ) -> int:
        """
        Process video using RealBasicVSR temporal super-resolution

        Args:
            input_path: Path to input video
            keyframes_sorted: Sorted list of keyframes
            target_resolution: Target (width, height)
            total_frames: Total number of frames
            original_fps: Original video FPS
            frames_dir: Directory to save enhanced frames
            progress_callback: Optional progress callback

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

        # Step 1: Extract and crop all frames (no SR yet)
        for frame_idx in range(total_frames):
            time = frame_idx / original_fps
            crop = self.interpolate_crop(keyframes_sorted, time)

            frame = self.extract_frame_with_crop(input_path, frame_idx, crop)

            # Save cropped frame
            frame_path = cropped_dir / f"frame_{frame_idx:06d}.png"
            cv2.imwrite(str(frame_path), frame)

            if progress_callback and frame_idx % 10 == 0:
                progress_callback(
                    frame_idx + 1,
                    total_frames * 2,  # Account for both cropping and upscaling phases
                    f"Cropping frame {frame_idx + 1}/{total_frames}",
                    phase='crop'
                )

            if frame_idx == 0:
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

    def interpolate_highlight(
        self,
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Optional[Dict[str, Any]]:
        """
        Interpolate highlight values between keyframes for a given time

        Args:
            keyframes: List of highlight keyframe dicts with 'time', 'x', 'y', 'radiusX', 'radiusY', 'opacity', 'color'
                      x, y are percentages (0-100), radiusX/radiusY are pixel values
            time: Time in seconds

        Returns:
            Interpolated highlight parameters, or None if time is after last keyframe
        """
        if len(keyframes) == 0:
            return None

        # Sort keyframes by time
        sorted_kf = sorted(keyframes, key=lambda k: k['time'])

        # If time is after the last keyframe, no highlight should be rendered
        if time > sorted_kf[-1]['time']:
            return None

        if len(sorted_kf) == 1:
            return sorted_kf[0]

        # Find surrounding keyframes
        before_kf = None
        after_kf = None

        for kf in sorted_kf:
            if kf['time'] <= time:
                before_kf = kf
            if kf['time'] > time and after_kf is None:
                after_kf = kf
                break

        # If before first keyframe, return first
        if before_kf is None:
            return sorted_kf[0]

        # If after last keyframe (shouldn't happen due to check above), return None
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
            'radiusX': before_kf['radiusX'] + (after_kf['radiusX'] - before_kf['radiusX']) * progress,
            'radiusY': before_kf['radiusY'] + (after_kf['radiusY'] - before_kf['radiusY']) * progress,
            'opacity': before_kf['opacity'] + (after_kf['opacity'] - before_kf['opacity']) * progress,
            'color': before_kf['color'],  # Use color from before keyframe (no interpolation for color)
            'time': time
        }

    def render_highlight_on_frame(
        self,
        frame: np.ndarray,
        highlight: Dict[str, Any],
        original_video_size: Tuple[int, int],
        crop: Optional[Dict[str, float]] = None
    ) -> np.ndarray:
        """
        Render a semi-transparent highlight ellipse on a frame

        Args:
            frame: Input frame (BGR format, already cropped)
            highlight: Highlight parameters with x, y (percentages 0-100), radiusX, radiusY (pixels in original coords)
            original_video_size: Original video (width, height) before crop
            crop: Crop parameters that were applied to this frame

        Returns:
            Frame with highlight overlay
        """
        if highlight is None:
            return frame

        frame_h, frame_w = frame.shape[:2]
        orig_w, orig_h = original_video_size

        # Convert highlight position from percentage to original video pixels
        highlight_x_orig = (highlight['x'] / 100.0) * orig_w
        highlight_y_orig = (highlight['y'] / 100.0) * orig_h
        radius_x_orig = highlight['radiusX']
        radius_y_orig = highlight['radiusY']

        # Transform highlight coordinates to cropped frame coordinates
        if crop:
            crop_x = crop['x']
            crop_y = crop['y']
            crop_w = crop['width']
            crop_h = crop['height']

            # Transform center position relative to crop
            highlight_x_crop = highlight_x_orig - crop_x
            highlight_y_crop = highlight_y_orig - crop_y

            # Scale to current frame size (in case frame was resized after crop)
            scale_x = frame_w / crop_w
            scale_y = frame_h / crop_h

            center_x = int(highlight_x_crop * scale_x)
            center_y = int(highlight_y_crop * scale_y)
            radius_x = int(radius_x_orig * scale_x)
            radius_y = int(radius_y_orig * scale_y)
        else:
            # No crop, just scale to frame size
            scale_x = frame_w / orig_w
            scale_y = frame_h / orig_h

            center_x = int(highlight_x_orig * scale_x)
            center_y = int(highlight_y_orig * scale_y)
            radius_x = int(radius_x_orig * scale_x)
            radius_y = int(radius_y_orig * scale_y)

        # Check if ellipse is within frame bounds (at least partially)
        if (center_x + radius_x < 0 or center_x - radius_x > frame_w or
            center_y + radius_y < 0 or center_y - radius_y > frame_h):
            # Ellipse is completely outside frame
            return frame

        # Parse color from hex string (e.g., "#FFFF00")
        color_hex = highlight['color'].lstrip('#')
        if len(color_hex) == 6:
            r = int(color_hex[0:2], 16)
            g = int(color_hex[2:4], 16)
            b = int(color_hex[4:6], 16)
            color_bgr = (b, g, r)  # OpenCV uses BGR
        else:
            # Default to yellow if parsing fails
            color_bgr = (0, 255, 255)  # Yellow in BGR

        opacity = highlight['opacity']

        # Create an overlay for blending
        overlay = frame.copy()

        # Draw filled ellipse on overlay
        cv2.ellipse(
            overlay,
            center=(center_x, center_y),
            axes=(radius_x, radius_y),
            angle=0,
            startAngle=0,
            endAngle=360,
            color=color_bgr,
            thickness=-1  # Filled
        )

        # Blend the overlay with original frame using opacity
        result = cv2.addWeighted(overlay, opacity, frame, 1 - opacity, 0)

        # Draw ellipse stroke (outline) for better visibility
        stroke_opacity = 0.6
        stroke_overlay = result.copy()
        cv2.ellipse(
            stroke_overlay,
            center=(center_x, center_y),
            axes=(radius_x, radius_y),
            angle=0,
            startAngle=0,
            endAngle=360,
            color=color_bgr,
            thickness=3
        )
        result = cv2.addWeighted(stroke_overlay, stroke_opacity, result, 1 - stroke_opacity, 0)

        return result

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
        highlight_keyframes: Optional[List[Dict[str, Any]]] = None
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
        # Get video info
        cap = cv2.VideoCapture(input_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        original_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        original_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / original_fps
        cap.release()

        # Store original video size for highlight rendering
        original_video_size = (original_width, original_height)

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
                logger.info(f"  Highlight {i+1}: t={hkf['time']:.2f}s, pos=({hkf['x']:.1f}%, {hkf['y']:.1f}%), "
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

        # Ideal 4x SR size
        sr_w = crop_w * 4
        sr_h = crop_h * 4

        # Clamp to a sane max (1440p for quality, avoids over-upscaling small crops)
        max_w, max_h = 2560, 1440  # 1440p cap
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
                    progress_callback
                )
                failed_frames = []
            else:
                # Use Real-ESRGAN frame-by-frame processing
                logger.info("Using Real-ESRGAN frame-by-frame super-resolution backend")

                # Prepare frame processing tasks
                frame_tasks = []
                for frame_idx in range(total_frames):
                    time = frame_idx / original_fps
                    crop = self.interpolate_crop(keyframes_sorted, time)

                    # Get highlight for this frame (if any)
                    highlight = None
                    if highlight_keyframes and len(highlight_keyframes) > 0:
                        highlight = self.interpolate_highlight(highlight_keyframes, time)

                    # Assign GPU in round-robin fashion
                    gpu_id = frame_idx % num_workers if use_multi_gpu else 0

                    frame_tasks.append((frame_idx, input_path, crop, target_resolution, gpu_id, time, highlight, original_video_size))

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

                            # Apply highlight overlay if keyframes are provided
                            if highlight_keyframes and len(highlight_keyframes) > 0:
                                highlight = self.interpolate_highlight(highlight_keyframes, time)
                                if highlight is not None:
                                    frame = self.render_highlight_on_frame(frame, highlight, original_video_size, crop)
                                    if frame_idx == 0:
                                        logger.info(f"✓ Highlight overlay applied at ({highlight['x']:.1f}%, {highlight['y']:.1f}%)")
                                elif frame_idx == 0:
                                    logger.info("No highlight for first frame (time is after last keyframe)")

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
            self.create_video_from_frames(frames_dir, output_path, target_fps, input_path, export_mode, progress_callback, segment_data, include_audio)

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

    def export_comparison_batch(
        self,
        input_path: str,
        output_dir: str,
        keyframes: List[Dict[str, Any]],
        base_name: str = "comparison",
        progress_callback=None,
        segment_data: Optional[Dict[str, Any]] = None,
        include_audio: bool = True
    ) -> Dict[str, Any]:
        """
        Export multiple versions for quality comparison testing.
        Exports: realesrgan_30fps, realesrgan_60fps, realbasicvsr_30fps, realbasicvsr_60fps

        Args:
            input_path: Path to input video
            output_dir: Directory to save comparison videos
            keyframes: List of crop keyframes
            base_name: Base name for output files
            progress_callback: Optional callback(current, total, message, phase)
            segment_data: Optional segment speed/trim data
            include_audio: Include audio in export (default True)

        Returns:
            Dict with results for each export variant
        """
        from pathlib import Path
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        results = {}
        variants = [
            ('realesrgan', 30),
            ('realesrgan', 60),
            ('realbasicvsr', 30),
            ('realbasicvsr', 60),
        ]

        total_variants = len(variants)
        batch_start_time = datetime.now()

        logger.info("=" * 60)
        logger.info("COMPARISON BATCH EXPORT")
        logger.info("=" * 60)
        logger.info(f"Exporting {total_variants} variants for quality comparison:")
        for backend, fps in variants:
            logger.info(f"  - {backend}_{fps}fps")
        logger.info("=" * 60)

        for variant_idx, (backend, target_fps) in enumerate(variants):
            variant_name = f"{backend}_{target_fps}fps"
            output_file = output_path / f"{base_name}_{variant_name}.mp4"

            logger.info(f"\n{'=' * 60}")
            logger.info(f"VARIANT {variant_idx + 1}/{total_variants}: {variant_name}")
            logger.info(f"{'=' * 60}")

            # Create a new upscaler instance with the appropriate backend
            try:
                # Save current backend
                original_backend = self.sr_backend

                # Switch backend
                self.sr_backend = backend

                # Re-initialize if switching to RealBasicVSR
                if backend == 'realbasicvsr' and self.vsr_model is None:
                    logger.info(f"Initializing RealBasicVSR backend...")
                    self.setup_realbasicvsr()

                # Create wrapper for progress callback that accounts for variant
                def variant_progress(current, total, message, phase=''):
                    if progress_callback:
                        overall_progress = variant_idx * 100 + (current / total * 100)
                        progress_callback(
                            overall_progress,
                            total_variants * 100,
                            f"[{variant_name}] {message}",
                            phase=phase
                        )

                # Track time for this variant
                variant_start_time = datetime.now()

                # Process video
                result = self.process_video_with_upscale(
                    input_path=input_path,
                    output_path=str(output_file),
                    keyframes=keyframes,
                    target_fps=target_fps,
                    export_mode='fast',  # Use fast mode for comparison (H.264, single-pass)
                    progress_callback=variant_progress,
                    segment_data=segment_data,
                    include_audio=include_audio
                )

                variant_end_time = datetime.now()
                variant_duration = (variant_end_time - variant_start_time).total_seconds()

                # Get file size
                file_size_mb = os.path.getsize(str(output_file)) / (1024 * 1024)

                results[variant_name] = {
                    'success': True,
                    'output_path': str(output_file),
                    'backend': backend,
                    'fps': target_fps,
                    'duration_seconds': variant_duration,
                    'duration_formatted': f"{int(variant_duration // 60)}m {int(variant_duration % 60)}s",
                    'file_size_mb': round(file_size_mb, 2),
                    'details': result
                }

                logger.info(f"✓ {variant_name} export complete: {output_file}")
                logger.info(f"  Time: {variant_duration:.2f}s ({int(variant_duration // 60)}m {int(variant_duration % 60)}s)")
                logger.info(f"  Size: {file_size_mb:.2f} MB")

                # Restore original backend
                self.sr_backend = original_backend

            except Exception as e:
                logger.error(f"✗ {variant_name} export failed: {e}")
                results[variant_name] = {
                    'success': False,
                    'error': str(e),
                    'backend': backend,
                    'fps': target_fps,
                    'duration_seconds': 0,
                    'duration_formatted': 'N/A',
                    'file_size_mb': 0
                }
                # Continue with other variants even if one fails
                continue

        batch_end_time = datetime.now()
        total_batch_duration = (batch_end_time - batch_start_time).total_seconds()

        logger.info(f"\n{'=' * 60}")
        logger.info("COMPARISON BATCH COMPLETE")
        logger.info("=" * 60)
        successful = sum(1 for r in results.values() if r.get('success', False))
        logger.info(f"Successfully exported {successful}/{total_variants} variants")
        logger.info(f"Total batch time: {total_batch_duration:.2f}s ({int(total_batch_duration // 60)}m {int(total_batch_duration % 60)}s)")
        for variant_name, result in results.items():
            if result.get('success'):
                logger.info(f"  ✓ {variant_name}: {result['output_path']}")
                logger.info(f"      Time: {result['duration_formatted']}, Size: {result['file_size_mb']} MB")
            else:
                logger.info(f"  ✗ {variant_name}: {result.get('error', 'Unknown error')}")
        logger.info("=" * 60)

        # Generate comparison report
        report_path = output_path / f"{base_name}_comparison_report.txt"
        self._write_comparison_report(
            report_path=report_path,
            results=results,
            total_batch_duration=total_batch_duration,
            batch_start_time=batch_start_time,
            batch_end_time=batch_end_time,
            input_path=input_path,
            base_name=base_name
        )

        return {
            'success': successful == total_variants,
            'total_variants': total_variants,
            'successful_variants': successful,
            'total_duration_seconds': total_batch_duration,
            'total_duration_formatted': f"{int(total_batch_duration // 60)}m {int(total_batch_duration % 60)}s",
            'report_path': str(report_path),
            'results': results
        }

    def _write_comparison_report(
        self,
        report_path: Path,
        results: Dict[str, Any],
        total_batch_duration: float,
        batch_start_time: datetime,
        batch_end_time: datetime,
        input_path: str,
        base_name: str
    ):
        """Write a comparison report to a text file"""
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write("=" * 70 + "\n")
            f.write("VIDEO UPSCALING COMPARISON REPORT\n")
            f.write("=" * 70 + "\n\n")

            f.write(f"Generated: {batch_end_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Input Video: {input_path}\n")
            f.write(f"Base Name: {base_name}\n\n")

            f.write("-" * 70 + "\n")
            f.write("TIMING SUMMARY\n")
            f.write("-" * 70 + "\n")
            f.write(f"Batch Start: {batch_start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Batch End:   {batch_end_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Total Time:  {total_batch_duration:.2f} seconds ")
            f.write(f"({int(total_batch_duration // 60)} min {int(total_batch_duration % 60)} sec)\n\n")

            f.write("-" * 70 + "\n")
            f.write("VARIANT RESULTS\n")
            f.write("-" * 70 + "\n\n")

            # Sort by variant name for consistent ordering
            for variant_name in sorted(results.keys()):
                result = results[variant_name]
                f.write(f"Variant: {variant_name}\n")
                f.write(f"  Backend: {result['backend']}\n")
                f.write(f"  FPS: {result['fps']}\n")

                if result.get('success'):
                    f.write(f"  Status: SUCCESS\n")
                    f.write(f"  Processing Time: {result['duration_formatted']} ({result['duration_seconds']:.2f}s)\n")
                    f.write(f"  File Size: {result['file_size_mb']} MB\n")
                    f.write(f"  Output: {result['output_path']}\n")

                    # Add resolution info if available
                    if 'details' in result and 'target_resolution' in result['details']:
                        res = result['details']['target_resolution']
                        f.write(f"  Resolution: {res[0]}x{res[1]}\n")
                else:
                    f.write(f"  Status: FAILED\n")
                    f.write(f"  Error: {result.get('error', 'Unknown error')}\n")

                f.write("\n")

            f.write("-" * 70 + "\n")
            f.write("PERFORMANCE COMPARISON\n")
            f.write("-" * 70 + "\n\n")

            # Create a comparison table
            successful_variants = {k: v for k, v in results.items() if v.get('success')}
            if successful_variants:
                # Find fastest and slowest
                fastest = min(successful_variants.items(), key=lambda x: x[1]['duration_seconds'])
                slowest = max(successful_variants.items(), key=lambda x: x[1]['duration_seconds'])
                smallest = min(successful_variants.items(), key=lambda x: x[1]['file_size_mb'])
                largest = max(successful_variants.items(), key=lambda x: x[1]['file_size_mb'])

                f.write(f"Fastest:      {fastest[0]} - {fastest[1]['duration_formatted']}\n")
                f.write(f"Slowest:      {slowest[0]} - {slowest[1]['duration_formatted']}\n")
                f.write(f"Smallest:     {smallest[0]} - {smallest[1]['file_size_mb']} MB\n")
                f.write(f"Largest:      {largest[0]} - {largest[1]['file_size_mb']} MB\n\n")

                # Time comparison table
                f.write("Time Comparison (relative to fastest):\n")
                for variant_name in sorted(successful_variants.keys()):
                    result = successful_variants[variant_name]
                    relative = result['duration_seconds'] / fastest[1]['duration_seconds']
                    bar_length = int(relative * 20)
                    bar = "█" * bar_length
                    f.write(f"  {variant_name:25s} {result['duration_formatted']:>10s} {bar} ({relative:.2f}x)\n")
                f.write("\n")

                # File size comparison table
                f.write("File Size Comparison (relative to smallest):\n")
                for variant_name in sorted(successful_variants.keys()):
                    result = successful_variants[variant_name]
                    relative = result['file_size_mb'] / smallest[1]['file_size_mb']
                    bar_length = int(relative * 20)
                    bar = "█" * bar_length
                    f.write(f"  {variant_name:25s} {result['file_size_mb']:>8.2f} MB {bar} ({relative:.2f}x)\n")
            else:
                f.write("No successful exports to compare.\n")

            f.write("\n" + "=" * 70 + "\n")
            f.write("END OF REPORT\n")
            f.write("=" * 70 + "\n")

        logger.info(f"✓ Comparison report written to: {report_path}")

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
        progress_callback=None,
        segment_data: Optional[Dict[str, Any]] = None,
        include_audio: bool = True
    ):
        """
        Create video from enhanced frames using FFmpeg encoding
        Applies segment speed changes (with AI frame interpolation for 0.5x) and trimming

        Args:
            frames_dir: Directory containing frames
            output_path: Output video path
            fps: Output framerate
            input_video_path: Path to input video (for audio)
            export_mode: Export mode - "fast" (1-pass) or "quality" (2-pass)
            progress_callback: Optional callback(current, total, message, phase)
            segment_data: Optional segment speed/trim data for applying speed changes
            include_audio: Include audio in export (default True)
        """
        frames_pattern = str(frames_dir / "frame_%06d.png")

        # Count total frames for progress tracking
        frame_files = list(frames_dir.glob("frame_*.png"))
        input_frame_count = len(frame_files)
        logger.info(f"Total input frames: {input_frame_count}")

        # Get original FPS from input video (needed for frame interpolation and segment processing)
        cap = cv2.VideoCapture(input_video_path)
        original_fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()

        # Detect if frame interpolation is needed (target FPS > source FPS)
        # Use tolerance to handle floating-point comparisons (e.g., 29.97 vs 30)
        fps_tolerance = 0.5
        needs_interpolation = fps > (original_fps + fps_tolerance)
        interpolation_ratio = fps / original_fps if needs_interpolation else 1.0

        if needs_interpolation:
            logger.info("=" * 60)
            logger.info("AI FRAME INTERPOLATION REQUIRED")
            logger.info("=" * 60)
            logger.info(f"Source FPS: {original_fps}")
            logger.info(f"Target FPS: {fps}")
            logger.info(f"Interpolation ratio: {interpolation_ratio:.2f}x")
            logger.info(f"Using minterpolate with motion compensation for smooth {fps}fps output")
            logger.info("=" * 60)
        elif fps < original_fps:
            logger.info(f"Downsampling from {original_fps}fps to {fps}fps (no interpolation needed)")
        else:
            logger.info(f"Source and target FPS match ({original_fps}fps → {fps}fps, no interpolation needed)")

        # Build FFmpeg complex filter for segment speed changes
        filter_complex = None
        expected_output_frames = input_frame_count
        trim_filter = None

        # Determine input framerate for FFmpeg (use original FPS to maintain correct timing)
        input_framerate = original_fps

        if segment_data:
            logger.info("=" * 60)
            logger.info("APPLYING SEGMENT SPEED/TRIM PROCESSING")
            logger.info("=" * 60)

            segments = segment_data.get('segments', [])
            trim_start = segment_data.get('trim_start', 0)
            trim_end = segment_data.get('trim_end')

            if segments:
                # Build complex filtergraph for segment-based speed changes
                filter_parts = []
                output_labels = []
                expected_output_frames = 0

                for i, seg in enumerate(segments):
                    start_time = seg['start']
                    end_time = seg['end']
                    speed = seg['speed']

                    # Calculate input frames for this segment
                    segment_duration = end_time - start_time
                    segment_input_frames = int(segment_duration * original_fps)

                    if speed == 0.5:
                        # For 0.5x speed: trim segment, apply minterpolate to double frames
                        logger.info(f"Segment {i}: {start_time:.2f}s-{end_time:.2f}s @ 0.5x speed")
                        logger.info(f"  → Input frames: {segment_input_frames}, Output frames (2x): {segment_input_frames * 2}")
                        logger.info(f"  → Using minterpolate with motion compensation")

                        # Trim, reset PTS, interpolate to double FPS
                        filter_parts.append(
                            f"[0:v]trim=start={start_time}:end={end_time},setpts=PTS-STARTPTS,"
                            f"minterpolate=fps={fps*2}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:scd=none,"
                            f"setpts=PTS*2[v{i}]"
                        )
                        expected_output_frames += segment_input_frames * 2
                        output_labels.append(f"[v{i}]")
                    else:
                        # For other speeds or normal: trim and optionally adjust PTS
                        logger.info(f"Segment {i}: {start_time:.2f}s-{end_time:.2f}s @ {speed}x speed")
                        logger.info(f"  → Frames: {segment_input_frames}")

                        filter_parts.append(
                            f"[0:v]trim=start={start_time}:end={end_time},setpts=PTS-STARTPTS[v{i}]"
                        )
                        expected_output_frames += segment_input_frames
                        output_labels.append(f"[v{i}]")

                # Concatenate all segments
                concat_inputs = ''.join(output_labels)
                concat_filter = f'{concat_inputs}concat=n={len(segments)}:v=1:a=0'

                # Apply frame interpolation after concatenation if needed
                if needs_interpolation:
                    logger.info("=" * 60)
                    logger.info("APPLYING FRAME INTERPOLATION AFTER SEGMENT PROCESSING")
                    logger.info("=" * 60)
                    logger.info(f"Interpolating concatenated segments from {original_fps}fps to {fps}fps")
                    filter_complex = ';'.join(filter_parts) + f';{concat_filter}[concat];[concat]minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:scd=none[outv]'
                    expected_output_frames = int(expected_output_frames * interpolation_ratio)
                    logger.info(f"Expected output frames after interpolation: {expected_output_frames}")
                else:
                    filter_complex = ';'.join(filter_parts) + f';{concat_filter}[outv]'

                logger.info(f"Expected output frames: {expected_output_frames}")
                logger.info(f"Filter complex: {filter_complex}")

            # Handle trim (apply after segment processing if no segments)
            if trim_start > 0 or trim_end:
                if not filter_complex:
                    # Simple trim without segments
                    if trim_end:
                        trim_filter = f"trim=start={trim_start}:end={trim_end},setpts=PTS-STARTPTS"
                        logger.info(f"Applying trim: {trim_start:.2f}s to {trim_end:.2f}s")
                    else:
                        trim_filter = f"trim=start={trim_start},setpts=PTS-STARTPTS"
                        logger.info(f"Trimming start at {trim_start:.2f}s")

                    # Recalculate expected frames for trim
                    total_duration = input_frame_count / original_fps
                    actual_end = trim_end if trim_end else total_duration
                    trimmed_duration = actual_end - trim_start
                    expected_output_frames = int(trimmed_duration * original_fps)

        # Apply frame interpolation if needed (when target FPS > source FPS and no segment processing)
        if needs_interpolation and not filter_complex and not trim_filter:
            # Add minterpolate filter for frame interpolation
            logger.info("=" * 60)
            logger.info("APPLYING FRAME INTERPOLATION FILTER")
            logger.info("=" * 60)
            logger.info(f"Interpolating {input_frame_count} frames @ {original_fps}fps → {int(input_frame_count * interpolation_ratio)} frames @ {fps}fps")

            # Create video filter with minterpolate
            trim_filter = f"minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:scd=none"
            expected_output_frames = int(input_frame_count * interpolation_ratio)

            logger.info(f"Motion interpolation filter: {trim_filter}")
            logger.info("=" * 60)
        elif needs_interpolation and trim_filter:
            # Append minterpolate to existing trim filter
            logger.info("=" * 60)
            logger.info("APPLYING FRAME INTERPOLATION WITH TRIM")
            logger.info("=" * 60)
            logger.info(f"Combining trim and interpolation filters")

            trim_filter = f"{trim_filter},minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:scd=none"
            expected_output_frames = int(expected_output_frames * interpolation_ratio)

            logger.info(f"Combined filter: {trim_filter}")
            logger.info("=" * 60)

        logger.info(f"Expected output frame count: {expected_output_frames}")

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
                '-framerate', str(input_framerate),
                '-i', frames_pattern,
                '-i', input_video_path
            ]

            # Add filter_complex for segment processing or simple trim filter
            if filter_complex:
                cmd_pass1.extend(['-filter_complex', filter_complex, '-map', '[outv]', '-map', '1:a?'])
            elif trim_filter:
                cmd_pass1.extend(['-vf', trim_filter, '-map', '0:v', '-map', '1:a?'])
            else:
                cmd_pass1.extend(['-map', '0:v', '-map', '1:a?'])

            cmd_pass1.extend([
                '-c:v', codec,
                '-preset', preset,
                '-crf', crf,
                '-x265-params', 'pass=1:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6',
                '-an',  # No audio in pass 1
                '-f', 'null',
                '/dev/null' if os.name != 'nt' else 'NUL'
            ])

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
                                expected_output_frames,
                                f"Pass 1: Analyzing frame {frame_num}/{expected_output_frames}",
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

        logger.info(f"Input framerate: {input_framerate}fps")
        logger.info(f"Output framerate: {fps}fps")
        if needs_interpolation:
            logger.info(f"Frame interpolation: {interpolation_ratio:.2f}x (minterpolate active)")
        logger.info("=" * 60)

        # Build FFmpeg command based on codec
        cmd_pass2 = [
            'ffmpeg', '-y',
            '-framerate', str(input_framerate),
            '-i', frames_pattern,
            '-i', input_video_path
        ]

        # Add filter_complex for segment processing or simple trim filter
        if filter_complex:
            cmd_pass2.extend(['-filter_complex', filter_complex, '-map', '[outv]'])
            if include_audio:
                cmd_pass2.extend(['-map', '1:a?'])
        elif trim_filter:
            cmd_pass2.extend(['-vf', trim_filter, '-map', '0:v'])
            if include_audio:
                cmd_pass2.extend(['-map', '1:a?'])
        else:
            cmd_pass2.extend(['-map', '0:v'])
            if include_audio:
                cmd_pass2.extend(['-map', '1:a?'])

        cmd_pass2.extend([
            '-c:v', codec,
            '-preset', preset,
            '-crf', crf
        ])

        # Add codec-specific parameters
        if codec == 'libx265':
            # H.265 specific parameters
            if export_mode == "quality":
                x265_params = 'pass=2:vbv-maxrate=80000:vbv-bufsize=160000:aq-mode=3:aq-strength=1.0:deblock=-1,-1:me=star:subme=7:merange=57:ref=6:psy-rd=2.5:psy-rdoq=1.0:bframes=8:b-adapt=2:rc-lookahead=60:rect=1:amp=1:rd=6'
            else:
                x265_params = 'aq-mode=3:aq-strength=1.0:deblock=-1,-1'
            cmd_pass2.extend(['-x265-params', x265_params])
        # libx264 uses default parameters (no special params needed for fast mode)

        # Add audio encoding parameters if audio is included
        if include_audio:
            cmd_pass2.extend(['-c:a', 'aac', '-b:a', '256k'])
        else:
            cmd_pass2.extend(['-an'])  # No audio

        # Add common parameters
        cmd_pass2.extend([
            '-r', str(fps),  # Explicit output framerate - CRITICAL for frame interpolation
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
                            message = f"Pass 2: Encoding frame {frame_num}/{expected_output_frames}"
                        else:
                            message = f"Encoding frame {frame_num}/{expected_output_frames}"
                        progress_callback(
                            frame_num,
                            expected_output_frames,
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
