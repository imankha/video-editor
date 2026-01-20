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
  return keyframes.findIndex(kf => Math.abs(kf.frame - frame) <= tolerance);
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
 * Based on analysis of real keyframe data:
 * - Minimum gap between user keyframes: 6-10 frames
 * - 5 frames is small enough to avoid false snaps
 * - Large enough to make keyframe selection easy
 */
export const FRAME_TOLERANCE = 5;
