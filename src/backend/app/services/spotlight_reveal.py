"""Shared entrance/exit "reveal" envelope for the spotlight highlight (T5250).

The spotlight used to POP on/off at a region's ``[start, end]`` bounds. This envelope
gives it a premium entrance FOCUS-PULL (fade-in while a larger ring CONTRACTS down to the
form-fitting size, ease-out) and an exit fade (ease-in), computed PURELY from the region
bounds and the current time. It is a DERIVED, render-time visual layer -- it never writes
keyframes, so it can't corrupt saved data or violate the gesture-persistence rule (T350
class).

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
    - radius_scale:   multiplies radiusX / radiusY about the ellipse center (contract-in:
                      starts LARGER than 1 and tightens to 1.0 = form-fitting)

ALWAYS-ON: the reveal is standard behavior for every spotlight -- there is no setting or
gate. Preview and export apply it unconditionally, so they can't drift on whether it's on.
"""

# Timing/easing constants. Mirror in spotlightReveal.js + video_processing.py.
ENTRANCE_SEC = 0.35  # entrance ramp length (fade-in + contract)
EXIT_SEC = 0.25  # exit fade length
ENTRANCE_START_SCALE = 1.35  # radii start 35% LARGER and CONTRACT to 100% (focus-pull) over the entrance


def _clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def compute_spotlight_reveal(current_time, start_time, end_time):
    """Return ``(opacity_factor, radius_scale)`` for a spotlight at ``current_time``
    within a region spanning ``[start_time, end_time]`` (seconds). Always applied."""
    if start_time is None or end_time is None:
        return 1.0, 1.0

    dur = end_time - start_time
    if not dur > 0:
        return 1.0, 1.0

    # Cap each ramp at half the region so a short region still gets a symmetric in/out
    # without the entrance and exit ramps overlapping.
    entrance = min(ENTRANCE_SEC, dur / 2)
    exit_ = min(EXIT_SEC, dur / 2)

    # Entrance: a FOCUS-PULL. The ring appears ~35% LARGER (ENTRANCE_START_SCALE) and
    # CONTRACTS down to 1.0 (form-fitting), catching the eye before it tightens onto the
    # player. Opacity fades in on a FASTER ease-out (cubic) than the contraction (quad),
    # so the big ring reads clearly at near-full opacity while it's still oversized -- it
    # lands bold, then snaps in, rather than fading up faint. Since ENTRANCE_START_SCALE
    # > 1, the shared `START + (1 - START) * e` formula interpolates big -> fitting.
    if entrance > 0 and current_time < start_time + entrance:
        p = _clamp01((current_time - start_time) / entrance)
        e_fade = 1 - (1 - p) * (1 - p) * (1 - p)  # ease-out cubic (opacity leads)
        e_contract = 1 - (1 - p) * (1 - p)  # ease-out quad (radius trails)
        return e_fade, ENTRANCE_START_SCALE + (1 - ENTRANCE_START_SCALE) * e_contract

    # Exit: ease-IN fade-out (slow start, accelerate to gone). No scale change. `q` is
    # the fraction of the exit ramp still remaining (1 at exit start, 0 at region end).
    if exit_ > 0 and current_time > end_time - exit_:
        q = _clamp01((end_time - current_time) / exit_)
        return q * q, 1.0  # ease-in quad

    return 1.0, 1.0
