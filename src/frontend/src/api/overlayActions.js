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
import apiFetch from '../utils/apiFetch';

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

    const response = await apiFetch(`${API_BASE}/api/export/projects/${projectId}/overlay/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[overlayActions] Action failed:', result.error);
      // `status` lets the caller distinguish a TRANSIENT failure (offline, 5xx,
      // 429) from a DETERMINISTIC rejection (4xx: the server evaluated this
      // exact request and refused it). Re-sending the latter byte-for-byte can
      // only fail again -- see overlayActionStore's retryability rule.
      return { success: false, version: result.version || 0, error: result.error, status: response.status };
    }

    return result;
  } catch (err) {
    console.error('[overlayActions] Network error:', err);
    // No status: the request never reached the server, so it IS retryable.
    return { success: false, version: 0, error: err.message };
  }
}

/**
 * Create a new highlight region
 * @param {number} projectId
 * @param {number} startTime - Region start time in seconds
 * @param {number} endTime - Region end time in seconds
 * @param {string} regionId - Client-generated region ID (for optimistic updates)
 * @param {Array} keyframes - Seed keyframes ({time, x, y, radiusX, radiusY,
 *   strokeOpacity, fillOpacity, color}) the editor materialized for the new
 *   region. Sending them keeps the stored region equal to the one on screen --
 *   omitting them stores a keyframe-less region, which exports with no
 *   spotlight and makes the first boundary drag delete a keyframe the DB never had.
 * @returns {Promise<{success: boolean, version: number, region_id?: string}>}
 */
export async function createRegion(projectId, startTime, endTime, regionId = null, keyframes = null) {
  const data = { start_time: startTime, end_time: endTime };
  if (regionId) data.region_id = regionId;
  if (keyframes && keyframes.length > 0) data.keyframes = keyframes;
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

export async function setStrokeWidth(projectId, strokeWidth) {
  return sendAction(projectId, 'set_stroke_width', null, { stroke_width: strokeWidth });
}

export async function setFillEnabled(projectId, fillEnabled) {
  return sendAction(projectId, 'set_fill_enabled', null, { fill_enabled: fillEnabled });
}

export async function setFillOpacity(projectId, fillOpacity) {
  return sendAction(projectId, 'set_fill_opacity', null, { fill_opacity: fillOpacity });
}

export async function setDimStrength(projectId, dimStrength) {
  return sendAction(projectId, 'set_dim_strength', null, { dim_strength: dimStrength });
}

export async function setHighlightShape(projectId, highlightShape) {
  return sendAction(projectId, 'set_highlight_shape', null, { highlight_shape: highlightShape });
}

/**
 * T5225: create a new Overlay text block.
 * @param {number} projectId
 * @param {string} id - Client-generated text block id (optimistic create, mirrors createRegion's regionId)
 * @param {Object} spec - The full TextSpec
 * @param {number} startTime
 * @param {number} endTime
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function createText(projectId, id, spec, startTime, endTime) {
  return sendAction(projectId, 'add_text', null, {
    id,
    spec,
    start_time: startTime,
    end_time: endTime,
  });
}

/**
 * T5225: move a text block's start and/or end edge (lever drag).
 * @param {number} projectId
 * @param {string} id
 * @param {number|null} startTime
 * @param {number|null} endTime
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function moveTextEdge(projectId, id, startTime = null, endTime = null) {
  const data = {};
  if (startTime !== null) data.start_time = startTime;
  if (endTime !== null) data.end_time = endTime;
  return sendAction(projectId, 'move_text_edge', { id }, data);
}

/**
 * T5225: replace a text block's WHOLE TextSpec (design O4 -- entity-surgical,
 * debounced by the caller, never per-keystroke).
 * @param {number} projectId
 * @param {string} id
 * @param {Object} spec - The full, updated TextSpec
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function updateTextSpec(projectId, id, spec) {
  return sendAction(projectId, 'update_text_spec', { id }, { spec });
}

/**
 * T5225: enable/disable a text block without deleting it.
 * @param {number} projectId
 * @param {string} id
 * @param {boolean} enabled
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function toggleText(projectId, id, enabled) {
  return sendAction(projectId, 'toggle_text', { id }, { enabled });
}

/**
 * T5225: delete a text block by id. Idempotent server-side if already absent.
 * @param {number} projectId
 * @param {string} id
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function deleteText(projectId, id) {
  return sendAction(projectId, 'delete_text', { id });
}

/**
 * T5410: set the pre-export poster marker time (the frame the share link
 * unfurls to). MOVE-only -- T6560 removed the clear-to-null path: the preview
 * image is ALWAYS a frame (T6510), so `time` must be a concrete, finite,
 * non-negative number; the backend 422s a null/missing time. Reset-to-auto is a
 * separate call (revertPoster), which regenerates a real frame.
 * @param {number} projectId
 * @param {number} time - seconds on the final timeline (a concrete frame).
 * @returns {Promise<{success: boolean, time: number}>}
 */
export async function setPosterTime(projectId, time) {
  try {
    const response = await apiFetch(`${API_BASE}/api/export/projects/${projectId}/poster-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('[overlayActions] setPosterTime failed:', result.error);
      return { success: false, error: result.error, status: response.status };
    }
    return result;
  } catch (err) {
    console.error('[overlayActions] setPosterTime network error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * T6380: revert a custom cover (uploaded image or overlay marker) back to the
 * auto/marker cover. Regenerates the frame the export-time selector picks and
 * overwrites the deterministic poster key server-side (the R2 object actually
 * changes -- not a local-only reset like the shipped T5410 Remove).
 * @param {number} projectId
 * @returns {Promise<{success: boolean, poster_filename?: string, poster_source?: string, error?: string}>}
 */
export async function revertPoster(projectId) {
  try {
    const response = await apiFetch(`${API_BASE}/api/export/projects/${projectId}/poster/revert`, {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('[overlayActions] revertPoster failed:', result.detail || result.error);
      return { success: false, error: result.detail || result.error, status: response.status };
    }
    return result;
  } catch (err) {
    console.error('[overlayActions] revertPoster network error:', err);
    return { success: false, error: err.message };
  }
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
  setStrokeWidth,
  setFillEnabled,
  setFillOpacity,
  setDimStrength,
  setHighlightShape,
  setPosterTime,
  revertPoster,
};
