"""Shared entrance/exit "reveal" envelope for the spotlight highlight (T5250).

The spotlight used to POP on/off at a region's ``[start, end]`` bounds. This envelope
gives it a premium entrance bloom (fade + slight scale-up, ease-out) and an exit fade
(ease-in), computed PURELY from the region bounds and the current time. It is a DERIVED,
render-time visual layer -- it never writes keyframes, so it can't corrupt saved data or
violate the gesture-persistence rule (T350 class).

SHARED SPEC -- the timing/easing here MUST stay in sync with the two mirrors (the
crop/default-shape mirroring pattern):
    - Frontend canonical: src/frontend/src/utils/spotlightReveal.js
    - Modal inline copy:  src/backend/app/modal_functions/video_processing.py (_render_highlight)
This module is the backend canonical, imported by the Fly render paths
(``keyframe_interpolator.render_highlight_on_frame`` via ``overlay._process_frames_to_ffmpeg``).
``video_processing.py`` inlines a copy because the Modal image does not mount ``app``.

The envelope returns two multipliers the renderer applies on TOP of whatever the keyframe
interpolator yields:
    - opacity_factor: multiplies stroke / fill / dim / outline opacity (0 invisible, 1 full)
    - radius_scale:   multiplies radiusX / radiusY about the ellipse center (bloom-in)
"""

# Timing/easing constants. Mirror in spotlightReveal.js + video_processing.py.
ENTRANCE_SEC = 0.35  # entrance ramp length (fade + scale-up)
EXIT_SEC = 0.25  # exit fade length
ENTRANCE_START_SCALE = 0.85  # radii start at 85% and bloom to 100% over the entrance


def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def compute_spotlight_reveal(current_time, start_time, end_time):
    """Return ``(opacity_factor, radius_scale)`` for a spotlight at ``current_time``
    within a region spanning ``[start_time, end_time]`` (seconds)."""
    if start_time is None or end_time is None:
        return 1.0, 1.0

    dur = end_time - start_time
    if not dur > 0:
        return 1.0, 1.0

    # Cap each ramp at half the region so a short region still gets a symmetric in/out
    # without the entrance and exit ramps overlapping.
    entrance = min(ENTRANCE_SEC, dur / 2)
    exit_ = min(EXIT_SEC, dur / 2)

    # Entrance: ease-OUT fade (fast start, decelerate to full) + scale-up from
    # ENTRANCE_START_SCALE to 1.0 on the same eased curve, so the spotlight blooms on.
    if entrance > 0 and current_time < start_time + entrance:
        p = _clamp01((current_time - start_time) / entrance)
        e = 1 - (1 - p) * (1 - p)  # ease-out quad
        return e, ENTRANCE_START_SCALE + (1 - ENTRANCE_START_SCALE) * e

    # Exit: ease-IN fade-out (slow start, accelerate to gone). No scale change. `q` is
    # the fraction of the exit ramp still remaining (1 at exit start, 0 at region end).
    if exit_ > 0 and current_time > end_time - exit_:
        q = _clamp01((end_time - current_time) / exit_)
        return q * q, 1.0  # ease-in quad

    return 1.0, 1.0
