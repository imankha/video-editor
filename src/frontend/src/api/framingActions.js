/**
 * Framing Actions API Client
 *
 * Provides gesture-based API for framing modifications instead of full-blob saves.
 * Each user action (add keyframe, set speed, etc.) is sent as an atomic operation.
 *
 * Gesture actions always update in-place (never create new versions).
 * Version creation for exported clips is handled by the PUT endpoint
 * (saveCurrentClipState), which sends complete state.
 */

import { API_BASE } from '../config';
import { createActionClient } from './actionClient';
import { surfaceConflictPrompt } from '../utils/actionConflictPrompt';

/**
 * Framing's actionClient instance (T4330). Preserves today's return shape
 * exactly -- `{success, refresh_required?, new_clip_id?, error?}` -- via
 * mapResult, so no caller changes. FIFO + version threading + 409 routing
 * are owned by the shared client; entity granularity is one chain per clip.
 */
const client = createActionClient({
  url: (ids) => `${API_BASE}/api/clips/projects/${ids.projectId}/clips/${ids.clipId}/actions`,
  entityKey: (ids) => `${ids.projectId}:${ids.clipId}`,
  tag: 'framingActions',
  mapResult: (raw, status, ok) => {
    if (!ok) return { success: false, error: raw.error };
    return raw;
  },
  onConflict: surfaceConflictPrompt,
});

/**
 * Send a framing action to the backend
 * @param {number} projectId - Project ID
 * @param {number} clipId - Clip ID
 * @param {string} action - Action type
 * @param {Object} target - Target specifier (frame, segment_index)
 * @param {Object} data - Action data
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number, error?: string}>}
 */
async function sendAction(projectId, clipId, action, target = null, data = null) {
  try {
    return await client.post({ projectId, clipId }, action, target, data);
  } catch (err) {
    console.error('[framingActions] Network error:', err);
    return { success: false, error: err.message };
  }
}

// =============================================================================
// Crop Keyframe Actions
// =============================================================================

/**
 * Add a crop keyframe
 * @param {number} projectId
 * @param {number} clipId
 * @param {Object} keyframe - { frame, x, y, width, height, origin }
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function addCropKeyframe(projectId, clipId, keyframe) {
  return sendAction(projectId, clipId, 'add_crop_keyframe', null, keyframe);
}

/**
 * Update an existing crop keyframe
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} frame - Frame number of keyframe to update
 * @param {Object} updates - Partial keyframe data { x?, y?, width?, height?, origin? }
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function updateCropKeyframe(projectId, clipId, frame, updates) {
  return sendAction(projectId, clipId, 'update_crop_keyframe', { frame }, updates);
}

/**
 * Delete a crop keyframe
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} frame - Frame number of keyframe to delete
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function deleteCropKeyframe(projectId, clipId, frame) {
  return sendAction(projectId, clipId, 'delete_crop_keyframe', { frame });
}

/**
 * Move a crop keyframe to a new frame
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} oldFrame - Current frame number
 * @param {number} newFrame - New frame number
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function moveCropKeyframe(projectId, clipId, oldFrame, newFrame) {
  return sendAction(projectId, clipId, 'move_crop_keyframe', { frame: oldFrame }, { frame: newFrame });
}

// =============================================================================
// Segment Actions
// =============================================================================

/**
 * Split a segment at a specific time
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} time - Time in seconds to split at
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function splitSegment(projectId, clipId, time) {
  return sendAction(projectId, clipId, 'split_segment', null, { time });
}

/**
 * Remove a segment split (merge segments)
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} time - Time of boundary to remove
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function removeSegmentSplit(projectId, clipId, time) {
  return sendAction(projectId, clipId, 'remove_segment_split', null, { time });
}

/**
 * Set the speed for a segment
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} segmentIndex - Index of segment (0-based)
 * @param {number} speed - Speed multiplier (0.5 = half speed, 2.0 = double speed)
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function setSegmentSpeed(projectId, clipId, segmentIndex, speed) {
  return sendAction(projectId, clipId, 'set_segment_speed', { segment_index: segmentIndex }, { speed });
}

// =============================================================================
// Trim Actions
// =============================================================================

/**
 * Set the trim range
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} start - Trim start time in seconds
 * @param {number} end - Trim end time in seconds
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function setTrimRange(projectId, clipId, start, end) {
  return sendAction(projectId, clipId, 'set_trim_range', null, { start, end });
}

/**
 * Clear the trim range
 * @param {number} projectId
 * @param {number} clipId
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function clearTrimRange(projectId, clipId) {
  return sendAction(projectId, clipId, 'clear_trim_range');
}

// =============================================================================
// Rotation Action (T5640)
// =============================================================================

/**
 * Set the per-clip horizon-straighten angle (surgical, clip-scalar).
 * @param {number} projectId
 * @param {number} clipId
 * @param {number} degrees - Content-correction angle in degrees (positive = CCW)
 * @returns {Promise<{success: boolean, refresh_required?: boolean, new_clip_id?: number}>}
 */
export async function setRotation(projectId, clipId, degrees) {
  return sendAction(projectId, clipId, 'set_rotation', null, { rotation: degrees });
}

export default {
  addCropKeyframe,
  updateCropKeyframe,
  deleteCropKeyframe,
  moveCropKeyframe,
  splitSegment,
  removeSegmentSplit,
  setSegmentSpeed,
  setTrimRange,
  clearTrimRange,
  setRotation,
};
