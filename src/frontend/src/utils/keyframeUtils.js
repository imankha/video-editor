/**
 * Utility functions for keyframe search operations
 * Centralizes common keyframe lookup patterns to avoid duplication
 */

/**
 * Find the index of a keyframe at an exact frame number
 * @param {Array} keyframes - Array of keyframe objects with 'frame' property
 * @param {number} frame - Exact frame number to find
 * @returns {number} Index of keyframe, or -1 if not found
 */
export function findKeyframeIndexAtFrame(keyframes, frame) {
  return keyframes.findIndex(kf => kf.frame === frame);
}

/**
 * Find a keyframe at an exact frame number
 * @param {Array} keyframes - Array of keyframe objects with 'frame' property
 * @param {number} frame - Exact frame number to find
 * @returns {Object|undefined} Keyframe object, or undefined if not found
 */
export function findKeyframeAtFrame(keyframes, frame) {
  return keyframes.find(kf => kf.frame === frame);
}

/**
 * Find the index of a keyframe within a tolerance range of a frame
 * @param {Array} keyframes - Array of keyframe objects with 'frame' property
 * @param {number} frame - Target frame number
 * @param {number} tolerance - Maximum frame difference to consider a match (default: 2)
 * @returns {number} Index of keyframe, or -1 if not found
 */
export function findKeyframeIndexNearFrame(keyframes, frame, tolerance = 2) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < keyframes.length; i++) {
    const distance = Math.abs(keyframes[i].frame - frame);
    if (distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Check if a keyframe exists at an exact frame number
 * @param {Array} keyframes - Array of keyframe objects with 'frame' property
 * @param {number} frame - Exact frame number to check
 * @returns {boolean} True if keyframe exists at frame
 */
export function hasKeyframeAtFrame(keyframes, frame) {
  return keyframes.some(kf => kf.frame === frame);
}

/**
 * Default frame tolerance for keyframe selection and snapping
 * 5 frames at 30fps = ~167ms tolerance
 *
 * Snap range: if a keyframe exists within this many frames, snap to it
 * (update it) instead of creating a new one. Also the minimum spacing
 * between keyframes — prevents overlapping diamonds on the timeline.
 * Diamond is 12px wide; on a 15s clip at 800px, each frame ≈ 1.8px.
 * 10 frames = 18px gap — enough to visually distinguish and click independently.
 * At 30fps, 10 frames = 333ms.
 */
export const FRAME_TOLERANCE = 10;
export const MIN_KEYFRAME_SPACING = FRAME_TOLERANCE;

/**
 * Resolve which keyframe an edit at `frame` actually targets.
 *
 * This is the SINGLE SOURCE OF TRUTH for keyframe identity. An edit within
 * `tolerance` of an existing keyframe targets THAT keyframe's frame (snap to
 * update); otherwise it targets `frame` (new keyframe). The reducer and every
 * persistence path (store + backend) must resolve identity through this so all
 * representations agree on which keyframe was touched. If a persist path uses
 * the raw clicked frame while the reducer snaps, the backend appends a
 * near-duplicate the reducer refused to create — the root of the overlapping
 * keyframe / lost-boundary bug.
 *
 * @param {Array} keyframes - Array of keyframe objects with 'frame' property
 * @param {number} frame - The frame the edit was made at
 * @param {number} tolerance - Snap window in frames (default: FRAME_TOLERANCE)
 * @returns {number} The frame number the edit targets
 */
export function resolveTargetFrame(keyframes, frame, tolerance = FRAME_TOLERANCE) {
  const i = findKeyframeIndexNearFrame(keyframes, frame, tolerance);
  return i >= 0 ? keyframes[i].frame : frame;
}
