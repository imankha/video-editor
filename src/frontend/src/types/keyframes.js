/**
 * Keyframe Type Definitions and Utilities
 *
 * IMPORTANT: Internal state uses FRAME-BASED keyframes for precision.
 * Time-based format is ONLY used when sending to FFmpeg for processing.
 *
 * DO NOT store time-based keyframes in the database.
 * DO NOT restore time-based keyframes to internal state.
 */

/**
 * Frame-based keyframe (internal format)
 * Used for: internal state, database storage, clip switching
 * @typedef {Object} FrameKeyframe
 * @property {number} frame - Frame number (integer)
 * @property {number} x - X position
 * @property {number} y - Y position
 * @property {number} width - Crop width
 * @property {number} height - Crop height
 * @property {string} [origin] - 'permanent' | 'user' | 'trim'
 */

/**
 * Time-based keyframe (FFmpeg export format)
 * Used for: FFmpeg processing ONLY
 * @typedef {Object} TimeKeyframe
 * @property {number} time - Time in seconds (float)
 * @property {number} x - X position
 * @property {number} y - Y position
 * @property {number} width - Crop width
 * @property {number} height - Crop height
 */

/**
 * Validate that a keyframe is frame-based (has 'frame', not 'time')
 * @param {Object} keyframe
 * @returns {keyframe is FrameKeyframe}
 */
export function isFrameKeyframe(keyframe) {
  return keyframe && typeof keyframe.frame === 'number' && !('time' in keyframe);
}

/**
 * Validate that a keyframe is time-based (has 'time', not 'frame')
 * @param {Object} keyframe
 * @returns {keyframe is TimeKeyframe}
 */
export function isTimeKeyframe(keyframe) {
  return keyframe && typeof keyframe.time === 'number' && !('frame' in keyframe);
}

/**
 * Validate an array of keyframes are all frame-based
 * @param {Array} keyframes
 * @returns {boolean}
 */
export function validateFrameKeyframes(keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return false;
  }
  return keyframes.every(isFrameKeyframe);
}

/**
 * Convert frame-based keyframes to time-based FOR FFMPEG EXPORT ONLY
 * @param {FrameKeyframe[]} frameKeyframes - Frame-based keyframes
 * @param {number} framerate - Video framerate
 * @returns {TimeKeyframe[]} Time-based keyframes for FFmpeg
 */
export function frameKeyframesToTimeKeyframes(frameKeyframes, framerate = 30) {
  if (!validateFrameKeyframes(frameKeyframes)) {
    console.error('[keyframes] Invalid frame keyframes passed to conversion:', frameKeyframes);
    throw new Error('Cannot convert non-frame-based keyframes to time format');
  }

  return frameKeyframes.map(kf => ({
    time: kf.frame / framerate,
    x: kf.x,
    y: kf.y,
    width: kf.width,
    height: kf.height,
  }));
}

/**
 * Convert time-based keyframes back to frame-based
 * NOTE: This should only be used for backwards compatibility with old data
 *
 * Origin assignment:
 * - First keyframe (time ~0) gets 'permanent' origin (start boundary)
 * - Last keyframe gets 'permanent' origin (end boundary)
 * - Middle keyframes get 'user' origin
 *
 * @param {TimeKeyframe[]} timeKeyframes - Time-based keyframes
 * @param {number} framerate - Video framerate
 * @returns {FrameKeyframe[]} Frame-based keyframes
 */
export function timeKeyframesToFrameKeyframes(timeKeyframes, framerate = 30) {
  if (!Array.isArray(timeKeyframes) || timeKeyframes.length === 0) {
    return [];
  }

  // Validate they are time-based
  if (!timeKeyframes.every(isTimeKeyframe)) {
    console.warn('[keyframes] Keyframes are not in time format, returning as-is');
    return timeKeyframes;
  }

  return timeKeyframes.map((kf, index) => {
    // Determine origin: first and last keyframes are 'permanent' (boundaries)
    // This preserves the invariant that boundary keyframes always exist
    const isFirst = index === 0;
    const isLast = index === timeKeyframes.length - 1;
    const origin = (isFirst || isLast) ? 'permanent' : 'user';

    return {
      frame: Math.round(kf.time * framerate),
      x: kf.x,
      y: kf.y,
      width: kf.width,
      height: kf.height,
      origin,
    };
  });
}

/**
 * Normalize keyframes to frame-based format
 * Handles both formats for backwards compatibility
 * @param {Array} keyframes - Keyframes in either format
 * @param {number} framerate - Video framerate
 * @returns {FrameKeyframe[]} Frame-based keyframes
 */
export function normalizeToFrameKeyframes(keyframes, framerate = 30) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    return [];
  }

  const firstKf = keyframes[0];

  // Already frame-based
  if (isFrameKeyframe(firstKf)) {
    return keyframes;
  }

  // Time-based - convert
  if (isTimeKeyframe(firstKf)) {
    console.warn('[keyframes] Converting time-based keyframes to frame-based (backwards compatibility)');
    return timeKeyframesToFrameKeyframes(keyframes, framerate);
  }

  // Unknown format
  console.error('[keyframes] Unknown keyframe format:', firstKf);
  return keyframes;
}
