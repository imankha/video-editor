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
 * Interpolate a single property using cubic spline
 * @param {Array} keyframes - Array of keyframes
 * @param {Object} indices - Result from findSplineIndices
 * @param {string} property - Property name to interpolate
 * @returns {number} Interpolated value
 */
function interpolateProperty(keyframes, indices, property) {
  const { p0Index, p1Index, p2Index, p3Index, progress } = indices;

  const p0 = keyframes[p0Index][property];
  const p1 = keyframes[p1Index][property];
  const p2 = keyframes[p2Index][property];
  const p3 = keyframes[p3Index][property];

  return catmullRom(p0, p1, p2, p3, progress);
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
 * Cubic spline interpolation for crop keyframes
 * @param {Array} keyframes - Sorted array of crop keyframes
 * @param {number} frame - Frame to interpolate at
 * @param {number} time - Time value to include in result
 * @returns {Object|null} Interpolated crop {time, frame, x, y, width, height}
 */
export function interpolateCropSpline(keyframes, frame, time) {
  if (keyframes.length === 0) {
    return null;
  }

  // Single keyframe - return it
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

  // Find spline indices
  const indices = findSplineIndices(keyframes, frame);

  if (!indices) {
    // Fallback to returning the nearest keyframe
    const nearest = keyframes.reduce((prev, curr) =>
      Math.abs(curr.frame - frame) < Math.abs(prev.frame - frame) ? curr : prev
    );
    return { ...nearest, time };
  }

  // Interpolate all properties using cubic spline
  return {
    time,
    frame,
    x: round3(interpolateProperty(keyframes, indices, 'x')),
    y: round3(interpolateProperty(keyframes, indices, 'y')),
    width: round3(interpolateProperty(keyframes, indices, 'width')),
    height: round3(interpolateProperty(keyframes, indices, 'height'))
  };
}

/**
 * Cubic spline interpolation for highlight keyframes
 * @param {Array} keyframes - Sorted array of highlight keyframes
 * @param {number} frame - Frame to interpolate at
 * @param {number} time - Time value to include in result
 * @returns {Object|null} Interpolated highlight {time, frame, x, y, radiusX, radiusY, opacity, color}
 */
export function interpolateHighlightSpline(keyframes, frame, time) {
  if (keyframes.length === 0) {
    return null;
  }

  // Single keyframe - return it
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

  // Find spline indices
  const indices = findSplineIndices(keyframes, frame);

  if (!indices) {
    // Fallback to returning the nearest keyframe
    const nearest = keyframes.reduce((prev, curr) =>
      Math.abs(curr.frame - frame) < Math.abs(prev.frame - frame) ? curr : prev
    );
    return { ...nearest, time };
  }

  // Find the keyframe before current time for color (no interpolation for color)
  const colorKeyframe = keyframes[indices.p1Index];

  // Interpolate all numeric properties using cubic spline
  return {
    time,
    frame,
    x: round3(interpolateProperty(keyframes, indices, 'x')),
    y: round3(interpolateProperty(keyframes, indices, 'y')),
    radiusX: round3(interpolateProperty(keyframes, indices, 'radiusX')),
    radiusY: round3(interpolateProperty(keyframes, indices, 'radiusY')),
    opacity: round3(Math.max(0, Math.min(1, interpolateProperty(keyframes, indices, 'opacity')))),
    color: colorKeyframe.color // Color doesn't interpolate (yet)
  };
}

/**
 * Generic cubic spline interpolation for any set of properties
 * @param {Array} keyframes - Sorted array of keyframes
 * @param {number} frame - Frame to interpolate at
 * @param {number} time - Time value to include in result
 * @param {Array<string>} properties - Array of property names to interpolate
 * @param {Object} nonInterpolatedDefaults - Properties that shouldn't be interpolated (e.g., color)
 * @returns {Object|null} Interpolated keyframe
 */
export function interpolateGenericSpline(keyframes, frame, time, properties, nonInterpolatedDefaults = {}) {
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

  const result = {
    time,
    frame,
    ...nonInterpolatedDefaults
  };

  // Interpolate each property
  for (const prop of properties) {
    result[prop] = round3(interpolateProperty(keyframes, indices, prop));
  }

  return result;
}
