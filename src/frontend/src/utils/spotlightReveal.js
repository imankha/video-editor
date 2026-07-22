/**
 * spotlightReveal - the shared entrance/exit "reveal" envelope for the spotlight
 * highlight (T5250).
 *
 * The spotlight used to POP on/off at a region's [start, end] bounds. This envelope
 * gives it a premium entrance bloom (fade + slight scale-up, ease-out) and an exit
 * fade (ease-in), computed PURELY from the region bounds and the current time. It is a
 * DERIVED, render-time visual layer — it never writes keyframes, so it can't corrupt
 * saved data or violate the gesture-persistence rule (T350 class).
 *
 * SHARED SPEC — this file is the single source of the timing/easing. It is MIRRORED, not
 * imported, on the backend render side (the crop/default-shape mirroring pattern):
 *   - Python canonical: src/backend/app/services/spotlight_reveal.py
 *   - Modal inline copy: src/backend/app/modal_functions/video_processing.py (_render_highlight)
 * Keep the constants and the math in sync across all three, or preview and export drift.
 *
 * The envelope returns two multipliers the renderer applies on TOP of whatever the
 * keyframe interpolator yields:
 *   - opacityFactor: multiplies stroke / fill / dim / outline opacity (0 = invisible, 1 = full)
 *   - radiusScale:  multiplies radiusX / radiusY about the ellipse center (bloom-in)
 *
 * SETTING-GATED (default OFF): the reveal is an opt-in per-project setting (alongside the
 * existing spotlight shape/stroke/fill/dim tuning — same panel, same gesture-based surgical
 * persistence pattern). `enabled` is the gate; when false this returns the identity (1, 1)
 * regardless of time/bounds, so the spotlight renders EXACTLY as it did before this feature
 * existed. The gate lives HERE (not scattered at call sites) so preview and export can't
 * drift on how "off" is decided — mirrored identically in the two backend copies.
 */

// Timing/easing constants. Mirror in spotlight_reveal.py + video_processing.py.
export const SPOTLIGHT_REVEAL = {
  ENTRANCE_SEC: 0.35, // entrance ramp length (fade + scale-up)
  EXIT_SEC: 0.25, // exit fade length
  ENTRANCE_START_SCALE: 0.85, // radii start at 85% and bloom to 100% over the entrance
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Compute the reveal multipliers for a spotlight at `currentTime` within a region
 * spanning [startTime, endTime] (seconds).
 *
 * @param {number} currentTime
 * @param {number} startTime
 * @param {number} endTime
 * @param {boolean} [enabled=true] - setting gate; false = identity (feature off)
 * @returns {{opacityFactor: number, radiusScale: number}}
 */
export function computeSpotlightReveal(currentTime, startTime, endTime, enabled = true) {
  const NONE = { opacityFactor: 1, radiusScale: 1 };
  if (!enabled) return NONE;
  if (startTime == null || endTime == null) return NONE;

  const dur = endTime - startTime;
  if (!(dur > 0)) return NONE;

  // Cap each ramp at half the region so a short region still gets a symmetric in/out
  // without the entrance and exit ramps overlapping.
  const entrance = Math.min(SPOTLIGHT_REVEAL.ENTRANCE_SEC, dur / 2);
  const exit = Math.min(SPOTLIGHT_REVEAL.EXIT_SEC, dur / 2);

  // Entrance: ease-OUT fade (fast start, decelerate to full) + scale-up from
  // ENTRANCE_START_SCALE to 1.0 on the same eased curve, so the spotlight blooms on.
  if (entrance > 0 && currentTime < startTime + entrance) {
    const p = clamp01((currentTime - startTime) / entrance);
    const e = 1 - (1 - p) * (1 - p); // ease-out quad
    return {
      opacityFactor: e,
      radiusScale:
        SPOTLIGHT_REVEAL.ENTRANCE_START_SCALE +
        (1 - SPOTLIGHT_REVEAL.ENTRANCE_START_SCALE) * e,
    };
  }

  // Exit: ease-IN fade-out (slow start, accelerate to gone). No scale change — the
  // circle stays full-size and just dissolves. `q` is the fraction of the exit ramp
  // still remaining (1 at the exit start, 0 at the region end).
  if (exit > 0 && currentTime > endTime - exit) {
    const q = clamp01((endTime - currentTime) / exit);
    return { opacityFactor: q * q, radiusScale: 1 }; // ease-in quad
  }

  return NONE;
}
