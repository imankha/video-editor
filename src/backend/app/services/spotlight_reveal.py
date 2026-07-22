"""Shared exit "fade-out" envelope for the spotlight highlight (T5250).

The spotlight is at FULL opacity + full size immediately at a region's start and stays full
through the region; the ONLY animation is the fade-OUT over the last ``EXIT_SEC`` at the
region end. There is NO entrance animation (no bloom, no contract-in) for any shape. It is a
DERIVED, render-time visual layer -- it never writes keyframes, so it can't corrupt saved
data or violate the gesture-persistence rule (T350 class).

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
    - radius_scale:   multiplies radiusX / radiusY about the ellipse center (always 1 now --
                      the exit fade does not scale)

ALWAYS-ON: the fade-out is standard behavior for every spotlight -- there is no setting or
gate. Preview and export apply it unconditionally, so they can't drift on whether it's on.
"""

# Timing/easing constants. Mirror in spotlightReveal.js + video_processing.py.
EXIT_SEC = 0.25  # exit fade length


def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def compute_spotlight_reveal(current_time, start_time, end_time):
    """Return ``(opacity_factor, radius_scale)`` for a spotlight at ``current_time``
    within a region spanning ``[start_time, end_time]`` (seconds). Full ``(1, 1)``
    everywhere except the exit window; the only animation is the exit fade-out."""
    if start_time is None or end_time is None:
        return 1.0, 1.0

    dur = end_time - start_time
    if not dur > 0:
        return 1.0, 1.0

    # Cap the exit ramp at half the region so a very short region still fades cleanly.
    exit_ = min(EXIT_SEC, dur / 2)

    # Exit: ease-IN fade-out (slow start, accelerate to gone). No scale change. `q` is
    # the fraction of the exit ramp still remaining (1 at exit start, 0 at region end).
    if exit_ > 0 and current_time > end_time - exit_:
        q = _clamp01((end_time - current_time) / exit_)
        return q * q, 1.0  # ease-in quad

    return 1.0, 1.0
