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

    def __init__(self, model_name: str = 'RealESRGAN_x4plus', device: str = 'cuda'):
        """
        Initialize the AI upscaler

        Args:
            model_name: Model to use for upscaling
            device: 'cuda' for GPU or 'cpu' for CPU processing
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        logger.info(f"Using device: {self.device}")

        self.model_name = model_name
        self.upsampler = None
        self.setup_model()

    def setup_model(self):
        """Download and setup Real-ESRGAN model"""
        try:
            from basicsr.archs.rrdbnet_arch import RRDBNet
            from realesrgan import RealESRGANer

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
                logger.info("Downloading Real-ESRGAN weights...")
                import wget
                wget.download(
                    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth',
                    out='weights/'
                )

            # Initialize upsampler with tiling for memory efficiency
            self.upsampler = RealESRGANer(
                scale=4,
                model_path=model_path,
                dni_weight=None,
                model=model,
                tile=512,  # Process in 512x512 tiles to save GPU memory
                tile_pad=10,
                pre_pad=0,
                half=True if self.device.type == 'cuda' else False,
                device=self.device
            )
            logger.info("Real-ESRGAN model loaded successfully!")

        except ImportError as e:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: Real-ESRGAN AI model failed to load!")
            logger.error("=" * 80)
            logger.error(f"Import error: {e}")
            logger.error("")
            logger.error("This means the AI upscaling will NOT work - only basic interpolation!")
            logger.error("")
            logger.error("To fix, install the dependencies:")
            logger.error("  cd src/backend")
            logger.error("  pip install torch torchvision")
            logger.error("  pip install basicsr realesrgan")
            logger.error("  # Then restart the backend")
            logger.error("=" * 80)
            self.upsampler = None
        except Exception as e:
            logger.error("=" * 80)
            logger.error("❌ CRITICAL: Real-ESRGAN setup failed!")
            logger.error("=" * 80)
            logger.error(f"Error: {e}")
            logger.error("=" * 80)
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
        # Upscale using cubic interpolation
        upscaled = cv2.resize(frame, target_size, interpolation=cv2.INTER_CUBIC)

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
        Enhance a single frame using AI model

        Args:
            frame: Input frame (BGR format)
            target_size: Target (width, height)

        Returns:
            Enhanced frame at target size
        """
        if self.upsampler is not None:
            try:
                # Calculate required scale factor
                current_h, current_w = frame.shape[:2]
                target_w, target_h = target_size

                logger.debug(f"Upscaling frame from {current_w}x{current_h} to {target_w}x{target_h}")

                # Real-ESRGAN upscales by 4x by default
                # We'll upscale first, then resize to exact target
                with contextlib.redirect_stderr(open(os.devnull, 'w')):
                    # Upscale with AI (4x)
                    enhanced, _ = self.upsampler.enhance(frame, outscale=4)

                upscaled_h, upscaled_w = enhanced.shape[:2]
                logger.debug(f"Real-ESRGAN upscaled to {upscaled_w}x{upscaled_h}")

                # Resize to exact target size if needed
                if enhanced.shape[:2] != (target_h, target_w):
                    enhanced = cv2.resize(enhanced, target_size, interpolation=cv2.INTER_LANCZOS4)
                    logger.debug(f"Resized to exact target: {target_w}x{target_h}")

                return enhanced
            except Exception as e:
                logger.error(f"Real-ESRGAN failed: {e}. Falling back to OpenCV.")
                return self.enhance_frame_opencv(frame, target_size)
        else:
            logger.warning("Real-ESRGAN not available, using OpenCV fallback")
            # Fallback to OpenCV
            return self.enhance_frame_opencv(frame, target_size)

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
        progress_callback=None
    ) -> Dict[str, Any]:
        """
        Process video with de-zoom and AI upscaling

        Args:
            input_path: Path to input video
            output_path: Path to output video
            keyframes: List of crop keyframes
            target_fps: Output framerate
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
            # Log AI model status
            logger.info("=" * 60)
            logger.info("PROCESSING PIPELINE")
            logger.info("=" * 60)
            if self.upsampler is not None:
                logger.info(f"✓ Using Real-ESRGAN AI model for upscaling")
            else:
                logger.warning(f"⚠ Real-ESRGAN not available - using OpenCV fallback (quality will be lower)")

            # Test interpolation smoothness (log a few sample points)
            logger.info("=" * 60)
            logger.info("INTERPOLATION TEST (sample frames)")
            logger.info("=" * 60)
            test_frames = [0, int(total_frames * 0.25), int(total_frames * 0.5), int(total_frames * 0.75), total_frames - 1]
            for test_idx in test_frames:
                test_time = test_idx / original_fps
                test_crop = self.interpolate_crop(keyframes_sorted, test_time)
                logger.info(f"  Frame {test_idx} @ {test_time:.2f}s: crop={int(test_crop['width'])}x{int(test_crop['height'])} at ({int(test_crop['x'])}, {int(test_crop['y'])})")

            # Process each frame
            logger.info("=" * 60)
            logger.info("STARTING FRAME-BY-FRAME PROCESSING")
            logger.info("=" * 60)
            for frame_idx in range(total_frames):
                # Calculate time for this frame
                time = frame_idx / original_fps

                # Get crop for this time (de-zoom step)
                crop = self.interpolate_crop(keyframes_sorted, time)

                # Log crop info for first and key frames
                if frame_idx == 0 or frame_idx % 30 == 0:
                    logger.info(f"Frame {frame_idx} @ {time:.2f}s: crop={int(crop['width'])}x{int(crop['height'])} at ({int(crop['x'])}, {int(crop['y'])})")

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

                # Progress callback
                if progress_callback:
                    progress_callback(frame_idx + 1, total_frames, f"Upscaling frame {frame_idx + 1}/{total_frames}")

                # Periodic GPU cleanup
                if frame_idx % 10 == 0 and torch.cuda.is_available():
                    torch.cuda.empty_cache()

            # Reassemble video with FFmpeg
            self.create_video_from_frames(frames_dir, output_path, target_fps)

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

    def create_video_from_frames(
        self,
        frames_dir: Path,
        output_path: str,
        fps: int
    ):
        """
        Create video from enhanced frames using FFmpeg

        Args:
            frames_dir: Directory containing frames
            output_path: Output video path
            fps: Output framerate
        """
        frames_pattern = str(frames_dir / "frame_%06d.png")

        logger.info(f"Encoding video with FFmpeg at {fps} fps...")

        cmd = [
            'ffmpeg',
            '-y',  # Overwrite output
            '-framerate', str(fps),
            '-i', frames_pattern,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '18',  # High quality
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-max_muxing_queue_size', '9999',
            str(output_path)
        ]

        try:
            result = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True
            )
            logger.info("Video encoding complete!")
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg encoding failed: {e.stderr}")
            raise RuntimeError(f"Video encoding failed: {e.stderr}")
