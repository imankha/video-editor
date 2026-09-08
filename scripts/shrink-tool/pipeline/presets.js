/**
 * T8840 pipeline/presets.js -- pure math, no DOM/hardware. Design doc §2.2.
 *
 * `estimateShrinkSeconds` is one function with one code path: called with
 * `REFERENCE_ENCODE_PIXELS_PER_SEC` before the runtime probe exists, and with the
 * probe's measured `pixelsPerSecond` afterward. Same formula either way -- only the
 * UI decides whether to label the result "estimated on a reference machine".
 */

// Two tiers only (EPIC decision 5, amended 2026-09-08): the middle "Recommended" tier
// was cut after a real side-by-side showed it visibly softer than Sharp on player
// detail, at close to Sharp's own bits-per-pixel -- it was strictly worse, never
// meaningfully smaller. Sharp is the default; Small is the deliberate small/fast choice.
export const PRESETS = {
  sharp: { id: 'sharp', label: 'Sharp', maxWidth: 3840, bitrate: 24_000_000 },
  small: { id: 'small', label: 'Small', maxWidth: 1920, bitrate: 7_000_000 },
};

// T8830 Chrome, 8K source -> 2688x1512 @ 12 Mbps at 45.63 fps = 4,064,256 px x 45.63.
// The conservative (8K-source) number, not the 1080p-source one. Output pixels per
// second of WALL-CLOCK time -- see design §2.2 presets.js and the pre-probe table.
export const REFERENCE_ENCODE_PIXELS_PER_SEC = 185_000_000;

export const SHRINK_OFFER_MIN_BYTES = 3e9; // EPIC decision 4
export const SHRINK_OFFER_MIN_BITRATE = 10_000_000; // EPIC decision 4

const MUX_OVERHEAD_FACTOR = 1.02; // 2% mux overhead

/**
 * Output size for a preset applied to a (possibly cropped) source region. Never
 * upscales: width = min(preset.maxWidth, cropPixelWidth). Height follows the crop's
 * aspect ratio. Both dimensions floored to even numbers (encoder requirement).
 */
export function resolveOutputSize(preset, cropPixelWidth, cropPixelHeight) {
  const width = Math.floor(Math.min(preset.maxWidth, cropPixelWidth) / 2) * 2;
  const height = Math.floor(((cropPixelHeight * width) / cropPixelWidth) / 2) * 2;
  return { width, height };
}

/** bitrate * duration / 8, plus 2% mux overhead, in bytes. */
export function estimateOutputBytes(preset, durationSec) {
  return (preset.bitrate * durationSec / 8) * MUX_OVERHEAD_FACTOR;
}

/**
 * Wall-clock seconds to shrink `durationSec` of content at `fps` into
 * `outWidth`x`outHeight`, given an encoder throughput of `pixelsPerSecond` output
 * pixels per wall-clock second. Pre-probe: pass REFERENCE_ENCODE_PIXELS_PER_SEC.
 * Post-probe: pass the measured value. Same formula, no branch.
 */
export function estimateShrinkSeconds({ outWidth, outHeight, durationSec, fps, pixelsPerSecond }) {
  const totalOutputPixels = outWidth * outHeight * fps * durationSec;
  return totalOutputPixels / pixelsPerSecond;
}

/** EPIC decision 4: only offer the shrink when the file is both big AND dense. */
export function shouldOfferShrink({ totalBytes, sourceBitrateBps }) {
  return totalBytes >= SHRINK_OFFER_MIN_BYTES && sourceBitrateBps >= SHRINK_OFFER_MIN_BITRATE;
}
