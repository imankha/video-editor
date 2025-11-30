"""
Crop interpolation utilities for FFmpeg filter generation.

This module provides functions for interpolating crop values between keyframes
and generating FFmpeg-compatible filter expressions.
"""

from typing import List, Dict, Any


def interpolate_crop(keyframes: List[Dict[str, Any]], time: float) -> Dict[str, float]:
    """
    Interpolate crop values between keyframes for a given time.

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
    progress = (time - before_kf['time']) / duration

    return {
        'x': before_kf['x'] + (after_kf['x'] - before_kf['x']) * progress,
        'y': before_kf['y'] + (after_kf['y'] - before_kf['y']) * progress,
        'width': before_kf['width'] + (after_kf['width'] - before_kf['width']) * progress,
        'height': before_kf['height'] + (after_kf['height'] - before_kf['height']) * progress
    }


def generate_crop_filter(keyframes: List[Dict[str, Any]], duration: float, fps: float = 30.0) -> Dict[str, Any]:
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
