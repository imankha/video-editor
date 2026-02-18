/**
 * Framing Actions API Client
 *
 * Provides gesture-based API for framing modifications instead of full-blob saves.
 * Each user action (add keyframe, set speed, etc.) is sent as an atomic operation.
 *
 * Benefits:
 * - No overwrites from concurrent edits
 * - Efficient (only sends what changed)
 * - Handles version creation for exported clips automatically
 */

import { API_BASE } from '../config';
import { checkSyncStatus } from '../stores/syncStore';

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
    const payload = { action };
    if (target) payload.target = target;
    if (data) payload.data = data;

    const response = await fetch(`${API_BASE}/api/clips/projects/${projectId}/clips/${clipId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    checkSyncStatus(response);
    const result = await response.json();

    if (!response.ok) {
      console.error('[framingActions] Action failed:', result.error);
      return { success: false, error: result.error };
    }

    return result;
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
};
