/**
 * spotlightReveal - the shared exit "fade-out" envelope for the spotlight highlight
 * (T5250).
 *
 * The spotlight is at FULL opacity + full size immediately at a region's start and stays
 * full through the region; the ONLY animation is the fade-OUT over the last EXIT_SEC at the
 * region end. There is NO entrance animation (no bloom, no contract-in) for any shape. It is
 * a DERIVED, render-time visual layer — it never writes keyframes, so it can't corrupt saved
 * data or violate the gesture-persistence rule (T350 class).
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
 *   - radiusScale:  multiplies radiusX / radiusY about the ellipse center (always 1 now — the
 *                   exit fade does not scale)
 *
 * ALWAYS-ON: the fade-out is standard behavior for every spotlight — there is no setting or
 * gate. Preview and export apply it unconditionally, so they can't drift on whether it's on.
 */

// Timing/easing constants. Mirror in spotlight_reveal.py + video_processing.py.
export const SPOTLIGHT_REVEAL = {
  EXIT_SEC: 0.25, // exit fade length
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Compute the exit-fade multipliers for a spotlight at `currentTime` within a region
 * spanning [startTime, endTime] (seconds). Full (1, 1) everywhere except the exit window.
 *
 * @param {number} currentTime
 * @param {number} startTime
 * @param {number} endTime
 * @returns {{opacityFactor: number, radiusScale: number}}
 */
export function computeSpotlightReveal(currentTime, startTime, endTime) {
  const NONE = { opacityFactor: 1, radiusScale: 1 };
  if (startTime == null || endTime == null) return NONE;

  const dur = endTime - startTime;
  if (!(dur > 0)) return NONE;

  // Cap the exit ramp at half the region so a very short region still fades cleanly.
  const exit = Math.min(SPOTLIGHT_REVEAL.EXIT_SEC, dur / 2);

  // Exit: ease-IN fade-out (slow start, accelerate to gone). No scale change — the
  // spotlight stays full-size and just dissolves. `q` is the fraction of the exit ramp
  // still remaining (1 at the exit start, 0 at the region end).
  if (exit > 0 && currentTime > endTime - exit) {
    const q = clamp01((endTime - currentTime) / exit);
    return { opacityFactor: q * q, radiusScale: 1 }; // ease-in quad
  }

  return NONE;
}
