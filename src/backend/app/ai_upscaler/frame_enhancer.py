"""
Frame Enhancement Module

Handles AI-powered frame enhancement with:
- Adaptive parameter selection based on upscale factor
- Multi-pass upscaling for extreme scales
- Detail and edge enhancement
- Pre-upscaling source frames
"""

import cv2
import torch
import numpy as np
import logging
import os
import contextlib
from typing import Dict, Tuple, Optional, Any

logger = logging.getLogger(__name__)


class FrameEnhancer:
    """
    Handles AI-powered frame enhancement operations

    Responsibilities:
    - Adaptive enhancement parameter selection
    - Multi-pass upscaling for >4x scales
    - Detail and edge enhancement
    - Pre-upscaling source frames before cropping
    """

    def __init__(
        self,
        model_manager,
        device: torch.device,
        export_mode: str = 'quality',
        enable_multipass: bool = True,
        custom_enhance_params: Optional[Dict] = None,
        pre_enhance_source: bool = False,
        pre_enhance_params: Optional[Dict] = None,
        enable_diffusion_sr: bool = False,
        diffusion_model: Any = None
    ):
        """
        Initialize frame enhancer

        Args:
            model_manager: ModelManager instance for accessing SR backends
            device: torch.device for GPU/CPU
            export_mode: 'fast' or 'quality' (default 'quality')
            enable_multipass: Enable multi-pass upscaling for >4x scales (default True)
            custom_enhance_params: Custom enhancement parameters to override adaptive selection
            pre_enhance_source: Apply enhancement to source BEFORE Real-ESRGAN
            pre_enhance_params: Parameters for pre-enhancement
            enable_diffusion_sr: Enable Stable Diffusion upscaler for extreme cases
            diffusion_model: Stable Diffusion model instance (optional)
        """
        self.model_manager = model_manager
        self.device = device
        self.export_mode = export_mode
        self.enable_multipass = enable_multipass
        self.custom_enhance_params = custom_enhance_params
        self.pre_enhance_source = pre_enhance_source
        self.pre_enhance_params = pre_enhance_params or {}
        self.enable_diffusion_sr = enable_diffusion_sr
        self.diffusion_model = diffusion_model

        # Legacy compatibility
        self.current_sr_model = 'realesrgan'
        self.swinir_model = None
        self.hat_model = None

    def get_adaptive_enhancement_params(self, scale_factor: float) -> Dict:
        """
        Get adaptive enhancement parameters based on upscale factor.

        OPTIMIZED BASED ON A/B TESTING RESULTS:
        Testing showed that raw Real-ESRGAN output (no post-processing) produces
        identical visual quality to heavily post-processed versions, but is faster.
        Therefore, we now use minimal post-processing by default.

        Args:
            scale_factor: The upscaling ratio (target_size / crop_size)

        Returns:
            Dictionary of enhancement parameters
        """
        # Use custom parameters if provided (for A/B testing)
        if self.custom_enhance_params is not None:
            logger.info(f"Scale factor {scale_factor:.2f}x: Using CUSTOM enhancement parameters (level: {self.custom_enhance_params.get('enhancement_level', 'custom')})")
            return self.custom_enhance_params

        # OPTIMIZED: Based on A/B testing, raw Real-ESRGAN output performs best
        # No post-processing filters needed - they don't improve quality for extreme upscaling
        if scale_factor > 3.5:
            # EXTREME/ULTRA upscaling - use raw ESRGAN output (tested and verified)
            params = {
                'bilateral_d': 0,              # No denoising (ESRGAN handles this)
                'bilateral_sigma_color': 0,
                'bilateral_sigma_space': 0,
                'unsharp_weight': 1.0,         # No sharpening (ESRGAN output is sharp enough)
                'unsharp_blur_weight': 0.0,
                'gaussian_sigma': 1.0,
                'apply_clahe': False,          # No contrast enhancement needed
                'clahe_clip_limit': 3.0,
                'clahe_tile_size': (8, 8),
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'optimized_raw'
            }
            logger.info(f"Scale factor {scale_factor:.2f}x: Using OPTIMIZED RAW parameters (no post-processing)")
        elif scale_factor > 2.5:
            # HIGH upscaling (medium crops)
            params = {
                'bilateral_d': 3,
                'bilateral_sigma_color': 4,
                'bilateral_sigma_space': 4,
                'unsharp_weight': 1.35,
                'unsharp_blur_weight': -0.35,
                'gaussian_sigma': 1.2,
                'apply_clahe': True,
                'clahe_clip_limit': 3.0,
                'clahe_tile_size': (8, 8),
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'high'
            }
            logger.info(f"Scale factor {scale_factor:.2f}x: Using HIGH enhancement parameters")
        else:
            # NORMAL upscaling (large crops with plenty of source data)
            params = {
                'bilateral_d': 3,
                'bilateral_sigma_color': 5,
                'bilateral_sigma_space': 5,
                'unsharp_weight': 1.2,
                'unsharp_blur_weight': -0.2,
                'gaussian_sigma': 1.0,
                'apply_clahe': False,
                'clahe_clip_limit': 3.0,
                'clahe_tile_size': (8, 8),
                'apply_detail_enhancement': False,
                'apply_edge_enhancement': False,
                'enhancement_level': 'normal'
            }
            logger.debug(f"Scale factor {scale_factor:.2f}x: Using NORMAL enhancement parameters")

        return params

    def apply_detail_enhancement(self, image: np.ndarray) -> np.ndarray:
        """
        Apply additional detail enhancement for extreme upscaling cases.
        Uses edge-preserving filtering and local contrast enhancement.

        Args:
            image: Input BGR image

        Returns:
            Enhanced image with improved local details
        """
        # Convert to LAB color space for better processing
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)

        # Apply guided filter for edge-preserving smoothing (reduces noise while keeping edges)
        # Using bilateral as approximation since guided filter needs OpenCV contrib
        l_filtered = cv2.bilateralFilter(l_channel, d=5, sigmaColor=10, sigmaSpace=10)

        # Enhance local contrast on luminance channel
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
        l_enhanced = clahe.apply(l_filtered)

        # Blend original and enhanced (70% enhanced, 30% original to avoid over-processing)
        l_final = cv2.addWeighted(l_enhanced, 0.7, l_channel, 0.3, 0)

        # Reconstruct image
        lab_enhanced = cv2.merge([l_final, a_channel, b_channel])
        result = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)

        return result

    def apply_edge_enhancement(self, image: np.ndarray) -> np.ndarray:
        """Apply edge-specific enhancement using Sobel operators"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Detect edges with Sobel
        sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
        sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
        edges = np.sqrt(sobelx**2 + sobely**2)
        edges = np.clip(edges / edges.max() * 255, 0, 255).astype(np.uint8)

        # Create edge mask (normalize to 0-1)
        edge_mask = edges.astype(np.float32) / 255.0
        edge_mask = cv2.GaussianBlur(edge_mask, (3, 3), 0)

        # Enhance edges in original image
        enhanced = image.astype(np.float32)
        for i in range(3):  # For each BGR channel
            enhanced[:,:,i] = enhanced[:,:,i] * (1 + 0.3 * edge_mask)

        return np.clip(enhanced, 0, 255).astype(np.uint8)

    def multi_pass_upscale(self, frame: np.ndarray, target_scale: float) -> np.ndarray:
        """
        Perform multi-pass upscaling for scale factors > 4x.
        Two passes of 2x often produce better results than one pass of 4x.

        Args:
            frame: Input BGR image
            target_scale: Desired total scale factor

        Returns:
            Upscaled image
        """
        upsampler = self.model_manager.backend
        if upsampler is None:
            raise RuntimeError("Model backend not initialized")

        if target_scale <= 2.0:
            # Single pass
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                enhanced, _ = upsampler.enhance(frame, outscale=target_scale)
            return enhanced
        elif target_scale <= 4.0:
            # Single 4x pass or two 2x passes (two 2x often better)
            logger.info(f"Multi-pass: 2x -> {target_scale/2:.2f}x")
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                # First pass: 2x
                pass1, _ = upsampler.enhance(frame, outscale=2.0)
                # Second pass: remaining scale
                remaining_scale = target_scale / 2.0
                enhanced, _ = upsampler.enhance(pass1, outscale=remaining_scale)
            return enhanced
        else:
            # Scale > 4: Do 4x first (as 2x+2x), then continue
            logger.info(f"Multi-pass: 2x -> 2x -> {target_scale/4:.2f}x (extreme scale)")
            with contextlib.redirect_stderr(open(os.devnull, 'w')):
                pass1, _ = upsampler.enhance(frame, outscale=2.0)
                pass2, _ = upsampler.enhance(pass1, outscale=2.0)

                if target_scale > 4.0:
                    # Need additional scaling beyond 4x
                    remaining_scale = min(target_scale / 4.0, 2.0)
                    if remaining_scale > 1.0:
                        enhanced, _ = upsampler.enhance(pass2, outscale=remaining_scale)
                    else:
                        enhanced = pass2
                else:
                    enhanced = pass2
            return enhanced

    def pre_upscale_source_frame(self, frame: np.ndarray, crop: Dict, scale: float = 2.0) -> Tuple[np.ndarray, Dict]:
        """
        Pre-upscale the entire source frame before cropping.

        Args:
            frame: Full source frame (BGR)
            crop: Original crop region dict with x, y, width, height
            scale: Pre-upscale factor (default 2.0)

        Returns:
            Tuple of (upscaled_frame, adjusted_crop_dict)
        """
        logger.info(f"Pre-upscaling source frame by {scale}x before crop extraction")

        upsampler = self.model_manager.backend
        if upsampler is None:
            raise RuntimeError("Model backend not initialized")

        # Upscale entire frame
        with contextlib.redirect_stderr(open(os.devnull, 'w')):
            upscaled_frame, _ = upsampler.enhance(frame, outscale=scale)

        # Adjust crop coordinates to match upscaled frame
        adjusted_crop = {
            'x': crop['x'] * scale,
            'y': crop['y'] * scale,
            'width': crop['width'] * scale,
            'height': crop['height'] * scale
        }

        logger.info(f"Crop adjusted: {int(crop['width'])}x{int(crop['height'])} -> {int(adjusted_crop['width'])}x{int(adjusted_crop['height'])}")

        return upscaled_frame, adjusted_crop

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
        upsampler = self.model_manager.backend
        if upsampler is None:
            raise RuntimeError(
                "Real-ESRGAN model not initialized. "
                "AI upscaling requires proper model initialization. "
                "Check server logs for setup errors."
            )

        try:
            # Calculate required scale factor
            current_h, current_w = frame.shape[:2]
            target_w, target_h = target_size

            # Calculate overall scale factor for adaptive parameters
            scale_x = target_w / current_w
            scale_y = target_h / current_h
            overall_scale = max(scale_x, scale_y)

            logger.debug(f"AI upscaling frame from {current_w}x{current_h} to {target_w}x{target_h} (scale={overall_scale:.2f}x)")

            # Get adaptive enhancement parameters based on scale factor
            enhance_params = self.get_adaptive_enhancement_params(overall_scale)

            # PRE-ENHANCE SOURCE before Real-ESRGAN (if enabled)
            # This enhances the input to give ESRGAN better data to work with
            if self.pre_enhance_source and self.pre_enhance_params:
                # Apply CLAHE to source if requested
                if self.pre_enhance_params.get('apply_clahe', False):
                    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
                    l_channel, a_channel, b_channel = cv2.split(lab)
                    clahe = cv2.createCLAHE(
                        clipLimit=self.pre_enhance_params.get('clahe_clip_limit', 2.0),
                        tileGridSize=self.pre_enhance_params.get('clahe_tile_size', (4, 4))
                    )
                    l_enhanced = clahe.apply(l_channel)
                    lab_enhanced = cv2.merge([l_enhanced, a_channel, b_channel])
                    frame = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
                    logger.debug(f"Pre-enhanced source with CLAHE (clip={self.pre_enhance_params.get('clahe_clip_limit', 2.0)})")

                # Apply unsharp masking to source if requested
                if self.pre_enhance_params.get('unsharp_weight', 1.0) != 1.0:
                    gaussian = cv2.GaussianBlur(frame, (0, 0), self.pre_enhance_params.get('gaussian_sigma', 1.0))
                    frame = cv2.addWeighted(
                        frame,
                        self.pre_enhance_params.get('unsharp_weight', 1.0),
                        gaussian,
                        self.pre_enhance_params.get('unsharp_blur_weight', 0.0),
                        0
                    )
                    frame = np.clip(frame, 0, 255).astype(np.uint8)
                    logger.debug(f"Pre-enhanced source with unsharp mask (weight={self.pre_enhance_params.get('unsharp_weight', 1.0)})")

            # Denoise before upscaling to prevent noise amplification (QUALITY mode only)
            # Skip if bilateral_d is 0 or negative (for raw output testing)
            if (self.device.type == 'cuda' and self.export_mode == 'quality' and
                enhance_params.get('bilateral_d', 0) > 0):
                frame = cv2.bilateralFilter(
                    frame,
                    d=enhance_params['bilateral_d'],
                    sigmaColor=enhance_params['bilateral_sigma_color'],
                    sigmaSpace=enhance_params['bilateral_sigma_space']
                )

            # Calculate desired scale for Real-ESRGAN
            desired_scale = min(scale_x, scale_y)  # Remove 4.0 cap

            # Track VRAM before upscaling
            self.model_manager.update_peak_vram()

            # Check if we should use multipass for extreme scales
            if (self.enable_multipass and
                  desired_scale > 4.0 and
                  enhance_params.get('enhancement_level') in ['extreme', 'ultra', 'optimized_raw']):
                # Use multi-pass for extreme cases
                enhanced = self.multi_pass_upscale(frame, desired_scale)
            else:
                # Standard single-pass - use appropriate model
                capped_scale = min(desired_scale, 4.0)

                # Default to Real-ESRGAN
                logger.debug(f"Using Real-ESRGAN model for {capped_scale:.2f}x upscaling")
                try:
                    with contextlib.redirect_stderr(open(os.devnull, 'w')):
                        enhanced, _ = upsampler.enhance(frame, outscale=capped_scale)
                except Exception as enhance_error:
                    logger.error(f"Real-ESRGAN enhance() failed: {enhance_error}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                    # Try to recover GPU state
                    import torch
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    raise RuntimeError(f"AI upscaling failed: {enhance_error}") from enhance_error

            upscaled_h, upscaled_w = enhanced.shape[:2]
            logger.debug(f"AI model upscaled to {upscaled_w}x{upscaled_h} (scale={desired_scale:.2f})")

            # Track VRAM after upscaling (peak usage)
            self.model_manager.update_peak_vram()

            # Resize to exact target size if needed (using highest quality interpolation)
            if enhanced.shape[:2] != (target_h, target_w):
                enhanced = cv2.resize(enhanced, target_size, interpolation=cv2.INTER_LANCZOS4)
                logger.debug(f"Resized to exact target: {target_w}x{target_h}")

            # Apply CLAHE contrast enhancement if needed (for high/extreme upscaling)
            if self.device.type == 'cuda' and self.export_mode == 'quality' and enhance_params.get('apply_clahe', False):
                lab = cv2.cvtColor(enhanced, cv2.COLOR_BGR2LAB)
                l_channel, a_channel, b_channel = cv2.split(lab)
                clahe = cv2.createCLAHE(
                    clipLimit=enhance_params['clahe_clip_limit'],
                    tileGridSize=enhance_params['clahe_tile_size']
                )
                l_enhanced = clahe.apply(l_channel)
                lab_enhanced = cv2.merge([l_enhanced, a_channel, b_channel])
                enhanced = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
                logger.debug(f"Applied CLAHE contrast enhancement (clip={enhance_params['clahe_clip_limit']})")

            # Apply additional detail enhancement for extreme cases
            if self.device.type == 'cuda' and self.export_mode == 'quality' and enhance_params.get('apply_detail_enhancement', False):
                enhanced = self.apply_detail_enhancement(enhanced)
                logger.debug("Applied additional detail enhancement pass")

            # Apply edge-specific enhancement for ultra cases
            if self.device.type == 'cuda' and self.export_mode == 'quality' and enhance_params.get('apply_edge_enhancement', False):
                enhanced = self.apply_edge_enhancement(enhanced)
                logger.debug("Applied edge-specific enhancement pass")

            # Sharpen upscaled output for better perceived quality (QUALITY mode only)
            # Skip if unsharp_weight is 1.0 and blur_weight is 0.0 (no effect)
            unsharp_weight = enhance_params.get('unsharp_weight', 1.0)
            blur_weight = enhance_params.get('unsharp_blur_weight', 0.0)
            if (self.device.type == 'cuda' and self.export_mode == 'quality' and
                not (unsharp_weight == 1.0 and blur_weight == 0.0)):
                gaussian = cv2.GaussianBlur(enhanced, (0, 0), enhance_params.get('gaussian_sigma', 1.0))
                enhanced = cv2.addWeighted(
                    enhanced,
                    unsharp_weight,
                    gaussian,
                    blur_weight,
                    0
                )
                # Clip values to valid range
                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                logger.debug(f"Applied unsharp mask (weight={unsharp_weight}, blur_weight={blur_weight})")

            return enhanced
        except Exception as e:
            logger.error(f"Real-ESRGAN processing failed: {e}")
            raise RuntimeError(f"AI upscaling failed: {e}")
