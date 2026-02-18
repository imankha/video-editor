/**
 * Overlay Actions API Client
 *
 * Provides gesture-based API for overlay modifications instead of full-blob saves.
 * Each user action (add region, update keyframe, etc.) is sent as an atomic operation.
 *
 * Benefits:
 * - No overwrites from concurrent edits
 * - Efficient (only sends what changed)
 * - Enables future conflict detection via version tracking
 */

import { API_BASE } from '../config';
import { checkSyncStatus } from '../stores/syncStore';

/**
 * Send an overlay action to the backend
 * @param {number} projectId - Project ID
 * @param {string} action - Action type (create_region, delete_region, etc.)
 * @param {Object} target - Target specifier (region_id, keyframe_time)
 * @param {Object} data - Action data
 * @param {number} expectedVersion - Optional version for conflict detection
 * @returns {Promise<{success: boolean, version: number, region_id?: string, error?: string}>}
 */
async function sendAction(projectId, action, target = null, data = null, expectedVersion = null) {
  try {
    const payload = { action };
    if (target) payload.target = target;
    if (data) payload.data = data;
    if (expectedVersion !== null) payload.expected_version = expectedVersion;

    const response = await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    checkSyncStatus(response);
    const result = await response.json();

    if (!response.ok) {
      console.error('[overlayActions] Action failed:', result.error);
      return { success: false, version: result.version || 0, error: result.error };
    }

    return result;
  } catch (err) {
    console.error('[overlayActions] Network error:', err);
    return { success: false, version: 0, error: err.message };
  }
}

/**
 * Create a new highlight region
 * @param {number} projectId
 * @param {number} startTime - Region start time in seconds
 * @param {number} endTime - Region end time in seconds
 * @param {string} regionId - Client-generated region ID (for optimistic updates)
 * @returns {Promise<{success: boolean, version: number, region_id?: string}>}
 */
export async function createRegion(projectId, startTime, endTime, regionId = null) {
  const data = { start_time: startTime, end_time: endTime };
  if (regionId) data.region_id = regionId;
  return sendAction(projectId, 'create_region', null, data);
}

/**
 * Delete a highlight region
 * @param {number} projectId
 * @param {string} regionId
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function deleteRegion(projectId, regionId) {
  return sendAction(projectId, 'delete_region', { region_id: regionId });
}

/**
 * Update region boundaries
 * @param {number} projectId
 * @param {string} regionId
 * @param {number} startTime - New start time (optional)
 * @param {number} endTime - New end time (optional)
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function updateRegion(projectId, regionId, startTime = null, endTime = null) {
  const data = {};
  if (startTime !== null) data.start_time = startTime;
  if (endTime !== null) data.end_time = endTime;
  return sendAction(projectId, 'update_region', { region_id: regionId }, data);
}

/**
 * Toggle region enabled/disabled
 * @param {number} projectId
 * @param {string} regionId
 * @param {boolean} enabled
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function toggleRegion(projectId, regionId, enabled) {
  return sendAction(projectId, 'toggle_region', { region_id: regionId }, { enabled });
}

/**
 * Add or update a keyframe in a region
 * @param {number} projectId
 * @param {string} regionId
 * @param {Object} keyframeData - { time, x, y, radiusX, radiusY, opacity, color, fromDetection? }
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function addKeyframe(projectId, regionId, keyframeData) {
  return sendAction(projectId, 'add_keyframe', { region_id: regionId }, keyframeData);
}

/**
 * Update an existing keyframe
 * @param {number} projectId
 * @param {string} regionId
 * @param {number} keyframeTime - Time of keyframe to update
 * @param {Object} updates - Partial keyframe data to update
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function updateKeyframe(projectId, regionId, keyframeTime, updates) {
  return sendAction(projectId, 'update_keyframe', { region_id: regionId, keyframe_time: keyframeTime }, updates);
}

/**
 * Delete a keyframe
 * @param {number} projectId
 * @param {string} regionId
 * @param {number} keyframeTime - Time of keyframe to delete
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function deleteKeyframe(projectId, regionId, keyframeTime) {
  return sendAction(projectId, 'delete_keyframe', { region_id: regionId, keyframe_time: keyframeTime });
}

/**
 * Set the highlight effect type
 * @param {number} projectId
 * @param {string} effectType - 'brightness_boost' | 'dark_overlay'
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function setEffectType(projectId, effectType) {
  return sendAction(projectId, 'set_effect_type', null, { effect_type: effectType });
}

/**
 * Set the highlight color for new highlights
 * @param {number} projectId
 * @param {string|null} highlightColor - Hex color string or null
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function setHighlightColor(projectId, highlightColor) {
  return sendAction(projectId, 'set_highlight_color', null, { highlight_color: highlightColor });
}

export default {
  createRegion,
  deleteRegion,
  updateRegion,
  toggleRegion,
  addKeyframe,
  updateKeyframe,
  deleteKeyframe,
  setEffectType,
  setHighlightColor,
};
