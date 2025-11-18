"""
Keyframe Interpolation Module

Handles interpolation of crop and highlight keyframes:
- Linear interpolation between keyframes
- Highlight rendering with transformations
- Coordinate system conversions
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple


class KeyframeInterpolator:
    """
    Interpolates between keyframes for smooth animations

    Supports:
    - Crop keyframe interpolation
    - Highlight keyframe interpolation
    - Highlight rendering with coordinate transformations
    """

    @staticmethod
    def interpolate_crop(
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

    @staticmethod
    def interpolate_highlight(
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Optional[Dict[str, Any]]:
        """
        Interpolate highlight values between keyframes for a given time

        Args:
            keyframes: List of highlight keyframe dicts with 'time', 'x', 'y', 'radiusX', 'radiusY', 'opacity', 'color'
                      x, y are pixel coordinates in original video space, radiusX/radiusY are pixel values
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

    @staticmethod
    def render_highlight_on_frame(
        frame: np.ndarray,
        highlight: Dict[str, Any],
        original_video_size: Tuple[int, int],
        crop: Optional[Dict[str, float]] = None
    ) -> np.ndarray:
        """
        Render a semi-transparent highlight ellipse on a frame

        Args:
            frame: Input frame (BGR format, already cropped)
            highlight: Highlight parameters with x, y (pixels in original video coords), radiusX, radiusY (pixels in original coords)
            original_video_size: Original video (width, height) before crop
            crop: Crop parameters that were applied to this frame

        Returns:
            Frame with highlight overlay
        """
        if highlight is None:
            return frame

        frame_h, frame_w = frame.shape[:2]
        orig_w, orig_h = original_video_size

        # Highlight position is already in original video pixel coordinates
        highlight_x_orig = highlight['x']
        highlight_y_orig = highlight['y']
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
