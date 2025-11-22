"""
Frame Interpolation Module

Provides high-quality frame interpolation for slow motion effects with tiered fallback:
1. RIFE with CUDA (best quality, requires NVIDIA GPU)
2. RIFE ncnn with Vulkan (good quality, cross-platform GPU)
3. FFmpeg minterpolate (fallback, CPU-based)
"""

import subprocess
import shutil
import logging
import os
import math
import tempfile
from pathlib import Path
from typing import Optional, Tuple, List, Callable
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class InterpolationBackend(Enum):
    """Available interpolation backends in order of preference"""
    RIFE_CUDA = "rife_cuda"
    RIFE_NCNN = "rife_ncnn"
    MINTERPOLATE = "minterpolate"


@dataclass
class GPUCapabilities:
    """Detected GPU capabilities for frame interpolation"""
    has_cuda: bool = False
    has_vulkan: bool = False
    cuda_device_name: Optional[str] = None
    vulkan_device_name: Optional[str] = None
    rife_cuda_available: bool = False
    rife_ncnn_available: bool = False


class FrameInterpolator:
    """
    High-quality frame interpolation with automatic backend selection.

    Automatically detects available GPU capabilities and selects the best
    interpolation backend:
    1. RIFE CUDA - Best quality, requires NVIDIA GPU with CUDA
    2. RIFE ncnn - Good quality, requires Vulkan-capable GPU
    3. minterpolate - Fallback, CPU-based FFmpeg filter
    """

    _capabilities: Optional[GPUCapabilities] = None
    _selected_backend: Optional[InterpolationBackend] = None

    def __init__(self):
        """Initialize frame interpolator and detect capabilities"""
        if FrameInterpolator._capabilities is None:
            FrameInterpolator._capabilities = self._detect_capabilities()
            FrameInterpolator._selected_backend = self._select_backend()
            self._log_backend_selection()

    @staticmethod
    def _detect_capabilities() -> GPUCapabilities:
        """Detect available GPU and interpolation capabilities"""
        caps = GPUCapabilities()

        # Check for CUDA availability
        caps.has_cuda, caps.cuda_device_name = FrameInterpolator._check_cuda()

        # Check for Vulkan availability
        caps.has_vulkan, caps.vulkan_device_name = FrameInterpolator._check_vulkan()

        # Check for RIFE CUDA (Python package or standalone)
        caps.rife_cuda_available = FrameInterpolator._check_rife_cuda(caps.has_cuda)

        # Check for RIFE ncnn binary
        caps.rife_ncnn_available = FrameInterpolator._check_rife_ncnn(caps.has_vulkan)

        return caps

    @staticmethod
    def _check_cuda() -> Tuple[bool, Optional[str]]:
        """Check if CUDA is available"""
        try:
            import torch
            if torch.cuda.is_available():
                device_name = torch.cuda.get_device_name(0)
                logger.info(f"CUDA available: {device_name}")
                return True, device_name
        except ImportError:
            logger.debug("PyTorch not installed, CUDA check skipped")
        except Exception as e:
            logger.debug(f"CUDA check failed: {e}")

        # Fallback: check nvidia-smi
        try:
            result = subprocess.run(
                ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                device_name = result.stdout.strip().split('\n')[0]
                logger.info(f"CUDA available (nvidia-smi): {device_name}")
                return True, device_name
        except Exception:
            pass

        return False, None

    @staticmethod
    def _check_vulkan() -> Tuple[bool, Optional[str]]:
        """Check if Vulkan is available"""
        # Try vulkaninfo command
        try:
            result = subprocess.run(
                ['vulkaninfo', '--summary'],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                # Parse device name from output
                for line in result.stdout.split('\n'):
                    if 'deviceName' in line:
                        device_name = line.split('=')[-1].strip()
                        logger.info(f"Vulkan available: {device_name}")
                        return True, device_name
                # Vulkan works but couldn't parse device name
                logger.info("Vulkan available")
                return True, "Unknown Vulkan Device"
        except FileNotFoundError:
            logger.debug("vulkaninfo not found")
        except Exception as e:
            logger.debug(f"Vulkan check failed: {e}")

        # Fallback: check if rife-ncnn-vulkan can enumerate devices
        try:
            rife_ncnn = shutil.which('rife-ncnn-vulkan')
            if rife_ncnn:
                # rife-ncnn-vulkan will fail gracefully if no Vulkan
                result = subprocess.run(
                    [rife_ncnn, '-h'],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    return True, "Vulkan (via rife-ncnn)"
        except Exception:
            pass

        return False, None

    @staticmethod
    def _check_rife_cuda(has_cuda: bool) -> bool:
        """Check if RIFE CUDA is available"""
        if not has_cuda:
            return False

        # Check for rife Python package
        try:
            # Try importing the RIFE model
            from inference_rife import Model
            logger.info("RIFE CUDA available (Python package)")
            return True
        except ImportError:
            pass

        # Check for standalone rife binary with CUDA support
        rife_bin = shutil.which('rife')
        if rife_bin:
            try:
                result = subprocess.run(
                    [rife_bin, '--help'],
                    capture_output=True, text=True, timeout=5
                )
                if 'cuda' in result.stdout.lower() or 'gpu' in result.stdout.lower():
                    logger.info("RIFE CUDA available (standalone binary)")
                    return True
            except Exception:
                pass

        # Check for inference_video.py script (common RIFE distribution)
        rife_script = Path(__file__).parent / 'rife' / 'inference_video.py'
        if rife_script.exists():
            logger.info("RIFE CUDA available (local script)")
            return True

        return False

    @staticmethod
    def _check_rife_ncnn(has_vulkan: bool) -> bool:
        """Check if RIFE ncnn is available"""
        if not has_vulkan:
            return False

        # Check for rife-ncnn-vulkan binary
        rife_ncnn = shutil.which('rife-ncnn-vulkan')
        if rife_ncnn:
            logger.info(f"RIFE ncnn available: {rife_ncnn}")
            return True

        # Check common installation paths
        common_paths = [
            '/usr/local/bin/rife-ncnn-vulkan',
            '/usr/bin/rife-ncnn-vulkan',
            str(Path.home() / '.local' / 'bin' / 'rife-ncnn-vulkan'),
            str(Path.home() / 'bin' / 'rife-ncnn-vulkan'),
        ]

        for path in common_paths:
            if Path(path).exists():
                logger.info(f"RIFE ncnn available: {path}")
                return True

        return False

    def _select_backend(self) -> InterpolationBackend:
        """Select the best available interpolation backend"""
        caps = self._capabilities

        if caps.rife_cuda_available:
            return InterpolationBackend.RIFE_CUDA

        if caps.rife_ncnn_available:
            return InterpolationBackend.RIFE_NCNN

        return InterpolationBackend.MINTERPOLATE

    def _log_backend_selection(self):
        """Log the selected backend and any warnings about fallbacks"""
        caps = self._capabilities
        backend = self._selected_backend

        logger.info("=" * 60)
        logger.info("FRAME INTERPOLATION BACKEND SELECTION")
        logger.info("=" * 60)

        if backend == InterpolationBackend.RIFE_CUDA:
            logger.info(f"✓ Using RIFE with CUDA ({caps.cuda_device_name})")
            logger.info("  → Best quality AI-based frame interpolation")

        elif backend == InterpolationBackend.RIFE_NCNN:
            logger.warning("=" * 60)
            logger.warning("⚠ CUDA NOT AVAILABLE - Using RIFE ncnn (Vulkan) fallback")
            logger.warning("=" * 60)
            logger.warning(f"  Missing: NVIDIA GPU with CUDA support")
            logger.warning(f"  Fallback: RIFE ncnn with Vulkan ({caps.vulkan_device_name})")
            logger.warning(f"  Impact: Slightly slower than CUDA, same quality")
            logger.warning("  To enable CUDA:")
            logger.warning("    1. Install NVIDIA GPU drivers")
            logger.warning("    2. Install PyTorch with CUDA: pip install torch --index-url https://download.pytorch.org/whl/cu121")
            logger.warning("    3. Install RIFE: pip install rife-ncnn-vulkan or clone https://github.com/hzwer/ECCV2022-RIFE")
            logger.warning("=" * 60)

        elif backend == InterpolationBackend.MINTERPOLATE:
            logger.warning("=" * 60)
            logger.warning("⚠ NO GPU INTERPOLATION AVAILABLE - Using FFmpeg minterpolate fallback")
            logger.warning("=" * 60)

            missing = []
            if not caps.has_cuda:
                missing.append("CUDA (NVIDIA GPU)")
            elif not caps.rife_cuda_available:
                missing.append("RIFE CUDA package")

            if not caps.has_vulkan:
                missing.append("Vulkan support")
            elif not caps.rife_ncnn_available:
                missing.append("rife-ncnn-vulkan binary")

            logger.warning(f"  Missing: {', '.join(missing)}")
            logger.warning(f"  Fallback: FFmpeg minterpolate (CPU-based)")
            logger.warning(f"  Impact: Lower quality, significantly slower for long videos")
            logger.warning("  To enable GPU interpolation:")
            logger.warning("    For CUDA (best):")
            logger.warning("      1. Install NVIDIA drivers")
            logger.warning("      2. pip install torch --index-url https://download.pytorch.org/whl/cu121")
            logger.warning("      3. Clone RIFE: git clone https://github.com/hzwer/ECCV2022-RIFE")
            logger.warning("    For Vulkan (alternative):")
            logger.warning("      1. Install Vulkan drivers for your GPU")
            logger.warning("      2. Install rife-ncnn-vulkan from https://github.com/nihui/rife-ncnn-vulkan")
            logger.warning("=" * 60)

        logger.info("=" * 60)

    @property
    def backend(self) -> InterpolationBackend:
        """Get the selected interpolation backend"""
        return self._selected_backend

    @property
    def capabilities(self) -> GPUCapabilities:
        """Get detected GPU capabilities"""
        return self._capabilities

    def get_backend_info(self) -> dict:
        """Get information about the selected backend for API responses"""
        caps = self._capabilities
        backend = self._selected_backend

        return {
            'backend': backend.value,
            'has_cuda': caps.has_cuda,
            'has_vulkan': caps.has_vulkan,
            'cuda_device': caps.cuda_device_name,
            'vulkan_device': caps.vulkan_device_name,
            'is_fallback': backend == InterpolationBackend.MINTERPOLATE,
            'quality_tier': {
                InterpolationBackend.RIFE_CUDA: 'best',
                InterpolationBackend.RIFE_NCNN: 'high',
                InterpolationBackend.MINTERPOLATE: 'standard'
            }[backend]
        }

    def interpolate_frames(
        self,
        input_frames_dir: Path,
        output_frames_dir: Path,
        multiplier: int = 2,
        fps: Optional[float] = None,
        progress_callback: Optional[Callable[[int, int, str], None]] = None
    ) -> bool:
        """
        Interpolate frames to increase frame count.

        Args:
            input_frames_dir: Directory containing input frames (frame_%06d.png)
            output_frames_dir: Directory to write interpolated frames
            multiplier: Frame multiplication factor (2 = double frames for 0.5x slowmo)
            fps: Original FPS (used for some backends)
            progress_callback: Optional callback(current, total, message)

        Returns:
            True if interpolation succeeded, False otherwise
        """
        backend = self._selected_backend

        if backend == InterpolationBackend.RIFE_CUDA:
            return self._interpolate_rife_cuda(
                input_frames_dir, output_frames_dir, multiplier, progress_callback
            )
        elif backend == InterpolationBackend.RIFE_NCNN:
            return self._interpolate_rife_ncnn(
                input_frames_dir, output_frames_dir, multiplier, progress_callback
            )
        else:
            # minterpolate is handled differently - returns False to signal
            # that FFmpeg filter should be used instead
            return False

    def _interpolate_rife_cuda(
        self,
        input_dir: Path,
        output_dir: Path,
        multiplier: int,
        progress_callback: Optional[Callable]
    ) -> bool:
        """Interpolate using RIFE with CUDA"""
        try:
            # Try Python API first
            return self._interpolate_rife_python(
                input_dir, output_dir, multiplier, progress_callback
            )
        except Exception as e:
            logger.warning(f"RIFE Python API failed: {e}, trying script fallback")
            return self._interpolate_rife_script(
                input_dir, output_dir, multiplier, progress_callback
            )

    def _interpolate_rife_python(
        self,
        input_dir: Path,
        output_dir: Path,
        multiplier: int,
        progress_callback: Optional[Callable]
    ) -> bool:
        """Interpolate using RIFE Python API"""
        import torch
        import cv2
        import numpy as np
        from pathlib import Path

        # Lazy import RIFE model
        try:
            from inference_rife import Model
        except ImportError:
            # Try alternative import path
            import sys
            rife_path = Path(__file__).parent / 'rife'
            if rife_path.exists():
                sys.path.insert(0, str(rife_path))
                from model.RIFE import Model
            else:
                raise ImportError("RIFE model not found")

        logger.info(f"RIFE CUDA: Interpolating frames {multiplier}x")

        # Initialize model
        device = torch.device('cuda')
        model = Model()
        model.load_model(str(Path(__file__).parent / 'rife' / 'train_log'), -1)
        model.eval()
        model.device()

        # Get input frames
        input_frames = sorted(input_dir.glob('frame_*.png'))
        total_frames = len(input_frames)
        output_idx = 0

        output_dir.mkdir(parents=True, exist_ok=True)

        for i, frame_path in enumerate(input_frames[:-1]):
            if progress_callback:
                progress_callback(i, total_frames - 1, f"RIFE interpolating frame {i}/{total_frames-1}")

            # Read frames
            img0 = cv2.imread(str(frame_path))
            img1 = cv2.imread(str(input_frames[i + 1]))

            # Convert to tensor
            img0_tensor = torch.from_numpy(img0.transpose(2, 0, 1)).float().unsqueeze(0).to(device) / 255.0
            img1_tensor = torch.from_numpy(img1.transpose(2, 0, 1)).float().unsqueeze(0).to(device) / 255.0

            # Pad to multiple of 32
            h, w = img0.shape[:2]
            ph = ((h - 1) // 32 + 1) * 32
            pw = ((w - 1) // 32 + 1) * 32
            padding = (0, pw - w, 0, ph - h)
            img0_padded = torch.nn.functional.pad(img0_tensor, padding)
            img1_padded = torch.nn.functional.pad(img1_tensor, padding)

            # Write original frame
            cv2.imwrite(str(output_dir / f'frame_{output_idx:06d}.png'), img0)
            output_idx += 1

            # Generate intermediate frames
            for t in range(1, multiplier):
                timestep = t / multiplier
                with torch.no_grad():
                    mid = model.inference(img0_padded, img1_padded, timestep)

                # Remove padding and convert back
                mid = mid[:, :, :h, :w]
                mid_np = (mid[0].cpu().numpy().transpose(1, 2, 0) * 255).astype(np.uint8)
                cv2.imwrite(str(output_dir / f'frame_{output_idx:06d}.png'), mid_np)
                output_idx += 1

        # Write last frame
        last_frame = cv2.imread(str(input_frames[-1]))
        cv2.imwrite(str(output_dir / f'frame_{output_idx:06d}.png'), last_frame)

        logger.info(f"RIFE CUDA: Generated {output_idx + 1} frames from {total_frames} input frames")
        return True

    def _interpolate_rife_script(
        self,
        input_dir: Path,
        output_dir: Path,
        multiplier: int,
        progress_callback: Optional[Callable]
    ) -> bool:
        """Interpolate using RIFE inference script"""
        rife_script = Path(__file__).parent / 'rife' / 'inference_img.py'

        if not rife_script.exists():
            raise FileNotFoundError(f"RIFE script not found: {rife_script}")

        cmd = [
            'python', str(rife_script),
            '--img', str(input_dir),
            '--exp', str(int(math.log2(multiplier))),  # exp=1 for 2x, exp=2 for 4x
            '--output', str(output_dir)
        ]

        logger.info(f"Running RIFE script: {' '.join(cmd)}")

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            logger.error(f"RIFE script failed: {result.stderr}")
            return False

        return True

    def _interpolate_rife_ncnn(
        self,
        input_dir: Path,
        output_dir: Path,
        multiplier: int,
        progress_callback: Optional[Callable]
    ) -> bool:
        """Interpolate using RIFE ncnn (Vulkan)"""
        rife_ncnn = shutil.which('rife-ncnn-vulkan')

        if not rife_ncnn:
            # Check common paths
            common_paths = [
                '/usr/local/bin/rife-ncnn-vulkan',
                '/usr/bin/rife-ncnn-vulkan',
                str(Path.home() / '.local' / 'bin' / 'rife-ncnn-vulkan'),
            ]
            for path in common_paths:
                if Path(path).exists():
                    rife_ncnn = path
                    break

        if not rife_ncnn:
            logger.error("rife-ncnn-vulkan not found")
            return False

        output_dir.mkdir(parents=True, exist_ok=True)

        # rife-ncnn-vulkan uses -n for multiplier (number of intermediate frames)
        # -n 1 = 2x (1 intermediate), -n 3 = 4x (3 intermediates)
        n_intermediate = multiplier - 1

        cmd = [
            rife_ncnn,
            '-i', str(input_dir),
            '-o', str(output_dir),
            '-n', str(n_intermediate),
            '-f', 'frame_%06d.png',
            '-j', '1:2:2',  # Thread config: load:proc:save
            '-v'  # Verbose output for progress
        ]

        logger.info(f"Running RIFE ncnn: {' '.join(cmd)}")

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            # Parse progress from output
            for line in process.stdout:
                logger.debug(f"RIFE ncnn: {line.strip()}")
                # Progress callback if available
                if progress_callback and 'frame' in line.lower():
                    # Try to parse frame number
                    import re
                    match = re.search(r'(\d+)', line)
                    if match:
                        frame_num = int(match.group(1))
                        progress_callback(frame_num, -1, f"RIFE ncnn: {line.strip()}")

            process.wait()

            if process.returncode != 0:
                logger.error(f"RIFE ncnn failed with return code {process.returncode}")
                return False

            logger.info("RIFE ncnn interpolation complete")
            return True

        except Exception as e:
            logger.error(f"RIFE ncnn failed: {e}")
            return False

    def get_minterpolate_filter(
        self,
        target_fps: int,
        high_quality: bool = True
    ) -> str:
        """
        Get FFmpeg minterpolate filter string for fallback.

        Args:
            target_fps: Target frames per second
            high_quality: Use high-quality settings (slower)

        Returns:
            FFmpeg filter string
        """
        if high_quality:
            # Best quality minterpolate settings
            return (
                f"minterpolate=fps={target_fps}:"
                f"mi_mode=mci:"        # Motion compensated interpolation
                f"mc_mode=aobmc:"      # Adaptive overlapped block motion compensation
                f"me_mode=bidir:"      # Bidirectional motion estimation
                f"vsbmc=1:"            # Variable-size block motion compensation
                f"scd=fdiff:"          # Scene change detection
                f"scd_threshold=10"    # Scene change threshold
            )
        else:
            # Faster but lower quality
            return f"minterpolate=fps={target_fps}:mi_mode=blend"


# Singleton instance for easy access
_interpolator: Optional[FrameInterpolator] = None


def get_frame_interpolator() -> FrameInterpolator:
    """Get or create the frame interpolator singleton"""
    global _interpolator
    if _interpolator is None:
        _interpolator = FrameInterpolator()
    return _interpolator


def detect_interpolation_capabilities() -> dict:
    """Detect and return interpolation capabilities (for API responses)"""
    interpolator = get_frame_interpolator()
    return interpolator.get_backend_info()
