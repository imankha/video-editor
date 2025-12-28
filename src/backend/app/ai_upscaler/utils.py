"""
Utility functions for AI Video Upscaler

This module contains:
- Torchvision compatibility shims
- Aspect ratio detection
- Fallback OpenCV enhancement
"""

import cv2
import numpy as np
import logging
import sys
import types
from typing import Tuple

logger = logging.getLogger(__name__)


# ============================================================================
# COMPATIBILITY SHIM: Fix for torchvision.transforms.functional_tensor removal
# In torchvision >= 0.16.0, functional_tensor was merged into functional
# BasicSR/Real-ESRGAN may still try to import from the old location
# ============================================================================

def setup_torchvision_compatibility():
    """
    Setup compatibility shim for torchvision.transforms.functional_tensor
    This fixes compatibility issues with Real-ESRGAN and newer torchvision versions.
    """
    # Check if the module already exists (either real or previously shimmed)
    if 'torchvision.transforms.functional_tensor' not in sys.modules:
        try:
            import torchvision.transforms.functional_tensor
        except (ImportError, AttributeError, RuntimeError) as e:
            # Catch ImportError (module doesn't exist)
            # Catch AttributeError (torch.library.register_fake compatibility issues)
            # Catch RuntimeError (other torch/torchvision version mismatches)
            logger.debug(f"torchvision import compatibility issue: {e}")
            try:
                # Create a compatibility shim for the removed module
                # First ensure torchvision.transforms is loaded
                import torchvision.transforms
                import torchvision.transforms.functional as F
            except (AttributeError, OSError, ImportError) as import_err:
                # If torchvision itself fails to import due to DLL/compatibility issues,
                # log the error and return - AI upscaler won't work but app can still run
                logger.warning(f"Failed to import torchvision for compatibility shim: {import_err}")
                logger.warning("AI upscaling features will be disabled")
                return

            # Create fake module that redirects to functional
            functional_tensor = types.ModuleType('torchvision.transforms.functional_tensor')
            functional_tensor.__file__ = F.__file__
            functional_tensor.__package__ = 'torchvision.transforms'

            # Copy all attributes from functional to functional_tensor
            for attr in dir(F):
                if not attr.startswith('_'):
                    try:
                        setattr(functional_tensor, attr, getattr(F, attr))
                    except Exception:
                        pass

            # Register the shim module in sys.modules
            sys.modules['torchvision.transforms.functional_tensor'] = functional_tensor

            # Also add it as an attribute of torchvision.transforms so that
            # "from torchvision.transforms import functional_tensor" works
            torchvision.transforms.functional_tensor = functional_tensor

            logger.info(
                "Applied torchvision.transforms.functional_tensor compatibility shim for Real-ESRGAN"
            )


def detect_aspect_ratio(width: int, height: int) -> Tuple[str, Tuple[int, int]]:
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


def enhance_frame_opencv(frame: np.ndarray, target_size: Tuple[int, int]) -> np.ndarray:
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
