"""
Crop interpolation utilities for FFmpeg filter generation.

Uses Catmull-Rom cubic spline to match frontend interpolation.
"""

from typing import Any


def _catmull_rom(p0: float, p1: float, p2: float, p3: float, t: float) -> float:
    t2 = t * t
    t3 = t2 * t
    return 0.5 * (
        (2 * p1)
        + (-p0 + p2) * t
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )


def _find_spline_indices(sorted_kf, time):
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


def _spline_prop(sorted_kf, indices, prop):
    p0_idx, p1_idx, p2_idx, p3_idx, progress = indices
    return _catmull_rom(
        sorted_kf[p0_idx][prop], sorted_kf[p1_idx][prop],
        sorted_kf[p2_idx][prop], sorted_kf[p3_idx][prop], progress,
    )


def interpolate_crop(keyframes: list[dict[str, Any]], time: float) -> dict[str, float]:
    """
    Interpolate crop values between keyframes using Catmull-Rom cubic spline.

    Args:
        keyframes: List of keyframe dictionaries with 'time', 'x', 'y', 'width', 'height'
        time: The time value to interpolate for

    Returns:
        Dictionary with interpolated 'x', 'y', 'width', 'height' values

    Raises:
        ValueError: If no keyframes are provided
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
    }


def generate_crop_filter(keyframes: list[dict[str, Any]], duration: float, fps: float = 30.0) -> dict[str, Any]:
    """
    Generate FFmpeg crop filter with keyframe interpolation.

    Creates FFmpeg-compatible expressions for animated crop filters that
    interpolate between keyframes over time.

    Args:
        keyframes: List of keyframe dictionaries with 'time', 'x', 'y', 'width', 'height'
        duration: Total video duration in seconds
        fps: Frames per second (default 30.0)

    Returns:
        dict: Contains both filter string and structured parameters
            {
                'filter_string': str,  # Complete filter string for logging
                'width_expr': str,     # Width expression
                'height_expr': str,    # Height expression
                'x_expr': str,         # X position expression
                'y_expr': str          # Y position expression
            }

    Raises:
        ValueError: If no keyframes are provided
    """
    if len(keyframes) == 0:
        raise ValueError("No keyframes provided")

    # If only one keyframe, use static crop
    if len(keyframes) == 1:
        kf = keyframes[0]
        # Use float values with 3 decimal precision
        w_expr = str(round(kf['width'], 3))
        h_expr = str(round(kf['height'], 3))
        x_expr = str(round(kf['x'], 3))
        y_expr = str(round(kf['y'], 3))

        return {
            'filter_string': f"crop={w_expr}:{h_expr}:{x_expr}:{y_expr}",
            'width_expr': w_expr,
            'height_expr': h_expr,
            'x_expr': x_expr,
            'y_expr': y_expr
        }

    # For multiple keyframes, we need to create an expression that changes over time
    # FFmpeg's crop filter supports expressions, but for smooth interpolation
    # we'll use a different approach with the zoompan filter or crop with expressions

    # Build crop filter with time-based expressions
    # We'll use linear interpolation between keyframes
    crop_expressions = []

    for i in range(len(keyframes) - 1):
        kf1 = keyframes[i]
        kf2 = keyframes[i + 1]

        # Time range for this segment
        t1 = kf1['time']
        t2 = kf2['time']

        # Generate interpolation expressions
        # FFmpeg's 't' variable represents current time in seconds
        crop_expressions.append({
            'start': t1,
            'end': t2,
            'x1': kf1['x'],
            'y1': kf1['y'],
            'w1': kf1['width'],
            'h1': kf1['height'],
            'x2': kf2['x'],
            'y2': kf2['y'],
            'w2': kf2['width'],
            'h2': kf2['height']
        })

    # For FFmpeg, we'll use a complex expression with if statements
    # Format: if(condition, true_value, false_value)

    def build_expression(param1_values, param2_values):
        """Build nested if expression for parameter interpolation"""
        # Map expression parameter names to actual keyframe keys
        param_map = {
            'x1': 'x', 'x2': 'x',
            'y1': 'y', 'y2': 'y',
            'w1': 'width', 'w2': 'width',
            'h1': 'height', 'h2': 'height'
        }

        # Get the actual keyframe key for default value
        kf_key = param_map.get(param1_values, param1_values)
        expr = f"{round(keyframes[-1][kf_key], 3)}"  # Default to last keyframe

        for i in range(len(crop_expressions) - 1, -1, -1):
            seg = crop_expressions[i]
            t1, t2 = seg['start'], seg['end']
            v1, v2 = round(seg[param1_values], 3), round(seg[param2_values], 3)

            # Linear interpolation: v1 + (v2 - v1) * (t - t1) / (t2 - t1)
            duration_seg = t2 - t1
            if duration_seg > 0:
                interp = f"{v1}+({v2}-{v1})*(t-{t1})/{duration_seg}"
            else:
                interp = f"{v1}"

            expr = f"if(gte(t,{t1})*lt(t,{t2}),{interp},{expr})"

        # Handle before first keyframe
        kf_key_first = param_map.get(param1_values, param1_values)
        expr = f"if(lt(t,{keyframes[0]['time']}),{round(keyframes[0][kf_key_first], 3)},{expr})"

        return expr

    x_expr = build_expression('x1', 'x2')
    y_expr = build_expression('y1', 'y2')
    w_expr = build_expression('w1', 'w2')
    h_expr = build_expression('h1', 'h2')

    return {
        'filter_string': f"crop=w={w_expr}:h={h_expr}:x={x_expr}:y={y_expr}",
        'width_expr': w_expr,
        'height_expr': h_expr,
        'x_expr': x_expr,
        'y_expr': y_expr
    }
