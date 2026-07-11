/**
 * Cubic Spline Interpolation for Keyframe Animation
 *
 * Uses Catmull-Rom splines for smooth interpolation between keyframes.
 * This provides natural, smooth curves that pass through all control points.
 */

/**
 * Catmull-Rom spline interpolation between four points
 * @param {number} p0 - Point before start
 * @param {number} p1 - Start point
 * @param {number} p2 - End point
 * @param {number} p3 - Point after end
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  // Catmull-Rom basis functions
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Find the surrounding keyframes for cubic spline interpolation
 * Returns 4 keyframes: p0 (before previous), p1 (previous), p2 (next), p3 (after next)
 * If boundary keyframes don't exist, they are extrapolated
 *
 * @param {Array} keyframes - Sorted array of keyframes with 'frame' property
 * @param {number} frame - Current frame to interpolate at
 * @returns {Object} { p0Index, p1Index, p2Index, p3Index, progress }
 */
function findSplineIndices(keyframes, frame) {
  if (keyframes.length < 2) {
    return null;
  }

  // Find p1 (keyframe before or at current frame) and p2 (keyframe after current frame)
  let p1Index = -1;
  let p2Index = -1;

  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= frame) {
      p1Index = i;
    }
    if (keyframes[i].frame > frame && p2Index === -1) {
      p2Index = i;
      break;
    }
  }

  // If before first keyframe or after last keyframe, return null for linear fallback
  if (p1Index === -1 || p2Index === -1) {
    return null;
  }

  // Calculate progress between p1 and p2
  const p1Frame = keyframes[p1Index].frame;
  const p2Frame = keyframes[p2Index].frame;
  const progress = (frame - p1Frame) / (p2Frame - p1Frame);

  // Determine p0 (before p1) and p3 (after p2)
  // Use clamped indices if at boundaries
  const p0Index = Math.max(0, p1Index - 1);
  const p3Index = Math.min(keyframes.length - 1, p2Index + 1);

  return {
    p0Index,
    p1Index,
    p2Index,
    p3Index,
    progress
  };
}

/**
 * Interpolate a single property using cubic spline, guarding property presence.
 *
 * Returns `undefined` when the property is absent on either bracketing keyframe
 * (p1/p2) so the consumer's `?? default` applies instead of producing NaN. This
 * matters for mixed-era keyframes: old ones may carry `opacity` but not
 * `strokeOpacity`, new ones the reverse. When only the extrapolation neighbours
 * (p0/p3) are missing, they fall back to p1/p2 (the existing boundary behavior),
 * so fully-populated keyframes (e.g. crop x/y/width/height) interpolate exactly as
 * before.
 *
 * @param {Array} keyframes - Array of keyframes
 * @param {Object} indices - Result from findSplineIndices
 * @param {string} property - Property name to interpolate
 * @returns {number|undefined} Interpolated value, or undefined if absent
 */
function interpolateProperty(keyframes, indices, property) {
  const { p0Index, p1Index, p2Index, p3Index, progress } = indices;

  const v1 = keyframes[p1Index][property];
  const v2 = keyframes[p2Index][property];
  // The bracket must have the property; otherwise this property doesn't animate here.
  if (v1 == null || v2 == null) {
    return undefined;
  }
  const v0raw = keyframes[p0Index][property];
  const v3raw = keyframes[p3Index][property];
  const p0 = v0raw == null ? v1 : v0raw;
  const p3 = v3raw == null ? v2 : v3raw;

  return catmullRom(p0, v1, v2, p3, progress);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Round to 3 decimal places for precision
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Generic cubic spline interpolation for any set of properties.
 *
 * The single interpolator behind both crop and highlight animation. Behavior:
 * - Boundary/single-keyframe/no-bracket cases return the nearest raw keyframe
 *   spread with `time` (so any property the keyframe lacks stays absent and the
 *   consumer's `?? default` applies).
 * - Each listed property is interpolated only when present on the bracketing
 *   keyframes; otherwise it is left `undefined` (never NaN) -- this is what lets
 *   mixed-era highlight keyframes (legacy `opacity` vs new `strokeOpacity`/
 *   `fillOpacity`) render correctly.
 * - `options.carryProperties`: taken verbatim from the keyframe *before* the
 *   current frame (p1), not interpolated -- e.g. `color`.
 * - `options.clamp01Properties`: clamped to [0, 1] after interpolation -- opacity
 *   fields. Clamping lives here (not the consumer) so every call site is safe.
 *
 * @param {Array} keyframes - Sorted array of keyframes
 * @param {number} frame - Frame to interpolate at
 * @param {number} time - Time value to include in result
 * @param {Array<string>} properties - Property names to interpolate
 * @param {Object} [options]
 * @param {Array<string>} [options.carryProperties] - Props carried from the p1 keyframe
 * @param {Array<string>} [options.clamp01Properties] - Props clamped to [0,1]
 * @returns {Object|null} Interpolated keyframe
 */
export function interpolateGenericSpline(keyframes, frame, time, properties, options = {}) {
  const { carryProperties = [], clamp01Properties = [] } = options;

  if (keyframes.length === 0) {
    return null;
  }

  if (keyframes.length === 1) {
    return { ...keyframes[0], time };
  }

  // Check boundaries
  if (frame <= keyframes[0].frame) {
    return { ...keyframes[0], time };
  }
  if (frame >= keyframes[keyframes.length - 1].frame) {
    return { ...keyframes[keyframes.length - 1], time };
  }

  const indices = findSplineIndices(keyframes, frame);

  if (!indices) {
    const nearest = keyframes.reduce((prev, curr) =>
      Math.abs(curr.frame - frame) < Math.abs(prev.frame - frame) ? curr : prev
    );
    return { ...nearest, time };
  }

  const clampSet = new Set(clamp01Properties);
  const result = { time, frame };

  // Interpolate each property (skipping any absent on the bracket -> undefined).
  for (const prop of properties) {
    const value = interpolateProperty(keyframes, indices, prop);
    if (value === undefined) {
      result[prop] = undefined;
    } else {
      result[prop] = round3(clampSet.has(prop) ? clamp01(value) : value);
    }
  }

  // Carry non-interpolated properties verbatim from the preceding keyframe.
  const carryFrom = keyframes[indices.p1Index];
  for (const prop of carryProperties) {
    result[prop] = carryFrom[prop];
  }

  return result;
}

const CROP_PROPERTIES = ['x', 'y', 'width', 'height'];
const HIGHLIGHT_PROPERTIES = ['x', 'y', 'radiusX', 'radiusY', 'opacity', 'strokeOpacity', 'fillOpacity'];
const HIGHLIGHT_CLAMP01 = ['opacity', 'strokeOpacity', 'fillOpacity'];

/**
 * Cubic spline interpolation for crop keyframes. Thin wrapper over
 * interpolateGenericSpline (T4250 consolidation).
 * @returns {Object|null} Interpolated crop {time, frame, x, y, width, height}
 */
export function interpolateCropSpline(keyframes, frame, time) {
  return interpolateGenericSpline(keyframes, frame, time, CROP_PROPERTIES);
}

/**
 * Cubic spline interpolation for highlight keyframes. Thin wrapper over
 * interpolateGenericSpline (T4250 consolidation). Interpolates opacity,
 * strokeOpacity and fillOpacity (clamped to [0,1]) so keyframed opacities ramp
 * smoothly between keyframes instead of snapping to the consumer defaults; color
 * is carried from the preceding keyframe.
 * @returns {Object|null} Interpolated highlight {time, frame, x, y, radiusX, radiusY,
 *   opacity, strokeOpacity, fillOpacity, color}
 */
export function interpolateHighlightSpline(keyframes, frame, time) {
  return interpolateGenericSpline(keyframes, frame, time, HIGHLIGHT_PROPERTIES, {
    carryProperties: ['color'],
    clamp01Properties: HIGHLIGHT_CLAMP01,
  });
}
