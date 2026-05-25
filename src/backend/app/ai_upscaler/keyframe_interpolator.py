"""
Keyframe Interpolation Module

Handles interpolation of crop and highlight keyframes:
- Catmull-Rom cubic spline interpolation between keyframes
- Highlight rendering with transformations
- Coordinate system conversions
"""

import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple


def _catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    """Catmull-Rom spline interpolation between four points."""
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _find_spline_indices(sorted_kf: list, time: float):
    """
    Find surrounding keyframes for cubic spline interpolation.
    Returns (p0_idx, p1_idx, p2_idx, p3_idx, progress) or None.
    """
    if len(sorted_kf) < 2:
        return None

    p1_idx = -1
    p2_idx = -1

    for i, kf in enumerate(sorted_kf):
        if kf['time'] <= time:
            p1_idx = i
        if kf['time'] > time and p2_idx == -1:
            p2_idx = i
            break

    if p1_idx == -1 or p2_idx == -1:
        return None

    duration = sorted_kf[p2_idx]['time'] - sorted_kf[p1_idx]['time']
    if duration == 0:
        return None

    progress = (time - sorted_kf[p1_idx]['time']) / duration

    p0_idx = max(0, p1_idx - 1)
    p3_idx = min(len(sorted_kf) - 1, p2_idx + 1)

    return p0_idx, p1_idx, p2_idx, p3_idx, progress


def _spline_prop(sorted_kf: list, indices: tuple, prop: str) -> float:
    """Interpolate a single property using Catmull-Rom spline."""
    p0_idx, p1_idx, p2_idx, p3_idx, progress = indices
    return _catmull_rom(
        sorted_kf[p0_idx][prop],
        sorted_kf[p1_idx][prop],
        sorted_kf[p2_idx][prop],
        sorted_kf[p3_idx][prop],
        progress,
    )


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
        Interpolate crop values between keyframes using Catmull-Rom cubic spline.

        Must match the frontend's interpolateCropSpline() exactly.

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

        if time <= keyframes[0]['time']:
            return keyframes[0]

        if time >= keyframes[-1]['time']:
            return keyframes[-1]

        indices = _find_spline_indices(keyframes, time)
        if indices is None:
            nearest = min(keyframes, key=lambda k: abs(k['time'] - time))
            return nearest

        return {
            'x': _spline_prop(keyframes, indices, 'x'),
            'y': _spline_prop(keyframes, indices, 'y'),
            'width': _spline_prop(keyframes, indices, 'width'),
            'height': _spline_prop(keyframes, indices, 'height'),
            'time': time
        }

    @staticmethod
    def interpolate_highlight(
        keyframes: List[Dict[str, Any]],
        time: float
    ) -> Optional[Dict[str, Any]]:
        """
        Interpolate highlight values between keyframes using Catmull-Rom cubic spline.

        Must match the frontend's interpolateHighlightSpline() exactly so
        the exported video matches the overlay editor preview.

        Args:
            keyframes: List of highlight keyframe dicts with 'time', 'x', 'y', 'radiusX', 'radiusY', 'opacity', 'color'
            time: Time in seconds

        Returns:
            Interpolated highlight parameters, or None if no active highlight
        """
        if len(keyframes) == 0:
            return None

        valid_keyframes = [k for k in keyframes if k.get('time') is not None]
        if len(valid_keyframes) == 0:
            return None
        sorted_kf = sorted(valid_keyframes, key=lambda k: k['time'])

        if time > sorted_kf[-1]['time']:
            return None

        if len(sorted_kf) == 1:
            return sorted_kf[0]

        if time <= sorted_kf[0]['time']:
            return sorted_kf[0]

        if time >= sorted_kf[-1]['time']:
            return sorted_kf[-1]

        indices = _find_spline_indices(sorted_kf, time)
        if indices is None:
            # Fallback: nearest keyframe
            nearest = min(sorted_kf, key=lambda k: abs(k['time'] - time))
            return nearest

        p0_idx, p1_idx, p2_idx, p3_idx, progress = indices

        return {
            'x': _spline_prop(sorted_kf, indices, 'x'),
            'y': _spline_prop(sorted_kf, indices, 'y'),
            'radiusX': _spline_prop(sorted_kf, indices, 'radiusX'),
            'radiusY': _spline_prop(sorted_kf, indices, 'radiusY'),
            'strokeOpacity': max(0.0, min(1.0, _spline_prop(sorted_kf, indices, 'strokeOpacity'))),
            'fillOpacity': max(0.0, min(1.0, _spline_prop(sorted_kf, indices, 'fillOpacity'))),
            'color': sorted_kf[p1_idx]['color'],
            'time': time
        }

    @staticmethod
    def interpolate_highlight_from_regions(
        regions: List[Dict[str, Any]],
        time: float
    ) -> Optional[Dict[str, Any]]:
        """
        Find the active region for a given time and interpolate highlight.

        Args:
            regions: List of highlight regions, each with:
                - start_time: Region start time
                - end_time: Region end time
                - enabled: Whether region is active
                - keyframes: List of keyframes with time, x, y, radiusX, radiusY, opacity, color

        Returns:
            Interpolated highlight parameters, or None if no active region at this time
        """
        if not regions:
            return None

        # Find active region for this time
        for region in regions:
            # Skip disabled regions
            if region.get('enabled') is False:
                continue

            start_time = region.get('start_time', 0)
            end_time = region.get('end_time', 0)

            # Check if time is within region
            if start_time <= time <= end_time:
                keyframes = region.get('keyframes', [])
                if keyframes:
                    return KeyframeInterpolator.interpolate_highlight(keyframes, time)

        return None

    @staticmethod
    def render_highlight_on_frame(
        frame: np.ndarray,
        highlight: Dict[str, Any],
        original_video_size: Tuple[int, int],
        crop: Optional[Dict[str, float]] = None,
        effect_type: str = "original",
        overlay_settings: Optional[Dict[str, Any]] = None,
    ) -> np.ndarray:
        if highlight is None:
            return frame

        frame_h, frame_w = frame.shape[:2]
        orig_w, orig_h = original_video_size

        highlight_x_orig = highlight['x']
        highlight_y_orig = highlight['y']
        radius_x_orig = highlight['radiusX']
        radius_y_orig = highlight['radiusY']

        settings = overlay_settings or {}
        if settings.get('highlight_shape') == 'ground':
            highlight_y_orig = highlight_y_orig + radius_y_orig
            radius_x_orig = radius_x_orig * (2.0 / 1.3)
            radius_y_orig = radius_y_orig * 0.3

        if crop:
            crop_x = crop['x']
            crop_y = crop['y']
            crop_w = crop['width']
            crop_h = crop['height']

            highlight_x_crop = highlight_x_orig - crop_x
            highlight_y_crop = highlight_y_orig - crop_y

            scale_x = frame_w / crop_w
            scale_y = frame_h / crop_h

            center_x = int(highlight_x_crop * scale_x)
            center_y = int(highlight_y_crop * scale_y)
            radius_x = int(radius_x_orig * scale_x)
            radius_y = int(radius_y_orig * scale_y)
        else:
            scale_x = frame_w / orig_w
            scale_y = frame_h / orig_h

            center_x = int(highlight_x_orig * scale_x)
            center_y = int(highlight_y_orig * scale_y)
            radius_x = int(radius_x_orig * scale_x)
            radius_y = int(radius_y_orig * scale_y)

        if (center_x + radius_x < 0 or center_x - radius_x > frame_w or
            center_y + radius_y < 0 or center_y - radius_y > frame_h):
            return frame

        color_hex = highlight['color'].lstrip('#')
        if len(color_hex) == 6:
            r = int(color_hex[0:2], 16)
            g = int(color_hex[2:4], 16)
            b = int(color_hex[4:6], 16)
            color_bgr = (b, g, r)
        else:
            color_bgr = (255, 255, 255)

        stroke_width_setting = settings.get('stroke_width', 2)
        fill_enabled = settings.get('fill_enabled', False)
        fill_opacity = highlight.get('fillOpacity', settings.get('fill_opacity', 0.05))
        stroke_opacity = highlight.get('strokeOpacity', 0.85)
        dim_strength = settings.get('dim_strength', 0.15)

        stroke_w = max(2, round(stroke_width_setting * frame_h / 1080))
        outline_w = stroke_w + 2

        result = frame

        if effect_type == "dark_overlay":
            mask = np.zeros((frame_h, frame_w), dtype=np.uint8)
            cv2.ellipse(mask, center=(center_x, center_y), axes=(radius_x, radius_y),
                       angle=0, startAngle=0, endAngle=360, color=255, thickness=-1)
            mask_inv = cv2.bitwise_not(mask)
            mask_inv_3ch = cv2.cvtColor(mask_inv, cv2.COLOR_GRAY2BGR).astype(np.float32) / 255.0
            result = result.astype(np.float32)
            result = result * (1.0 - mask_inv_3ch * dim_strength)
            result = np.clip(result, 0, 255).astype(np.uint8)

        if fill_enabled and fill_opacity > 0:
            color_value = highlight.get('color')
            has_color = color_value is not None and color_value != 'none'
            if has_color:
                overlay = result.copy()
                cv2.ellipse(overlay, center=(center_x, center_y), axes=(radius_x, radius_y),
                           angle=0, startAngle=0, endAngle=360, color=color_bgr, thickness=-1)
                result = cv2.addWeighted(overlay, fill_opacity, result, 1 - fill_opacity, 0)

        outline_bgr = tuple(int(c * 0.3) for c in color_bgr)
        outline_overlay = result.copy()
        cv2.ellipse(outline_overlay, center=(center_x, center_y), axes=(radius_x, radius_y),
                   angle=0, startAngle=0, endAngle=360, color=outline_bgr, thickness=outline_w)
        result = cv2.addWeighted(outline_overlay, 0.5, result, 0.5, 0)

        # Main colored stroke
        stroke_overlay = result.copy()
        cv2.ellipse(stroke_overlay, center=(center_x, center_y), axes=(radius_x, radius_y),
                   angle=0, startAngle=0, endAngle=360, color=color_bgr, thickness=stroke_w)
        result = cv2.addWeighted(stroke_overlay, stroke_opacity, result, 1 - stroke_opacity, 0)

        return result
