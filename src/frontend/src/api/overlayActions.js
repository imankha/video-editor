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
 * T6630 round 4: a text REGION is a time span containing N ELEMENTS that all
 * render simultaneously during it. This ONE call creates EITHER kind of
 * thing, matching the backend's add_text branch split:
 *   - regionId omitted/null: creates a NEW REGION. `id` becomes the
 *     REGION's id (startTime/endTime required).
 *   - regionId set to an EXISTING region's id: appends a new ELEMENT into
 *     that region; `id` is the ELEMENT's id (startTime/endTime ignored --
 *     adding an element never changes the region's timing).
 * @param {number} projectId
 * @param {string} id - Client-generated id (region id, or element id when regionId is set)
 * @param {Object} spec - The full TextSpec
 * @param {number} [startTime] - Required when creating a new region
 * @param {number} [endTime] - Required when creating a new region
 * @param {string|null} [regionId] - Existing region to append an element into
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function createText(projectId, id, spec, startTime, endTime, regionId = null) {
  const data = { id, spec };
  if (startTime !== undefined) data.start_time = startTime;
  if (endTime !== undefined) data.end_time = endTime;
  if (regionId) data.region_id = regionId;
  return sendAction(projectId, 'add_text', null, data);
}

/**
 * T6630 round 4: move a text REGION's start and/or end edge (lever drag /
 * body drag). Targets the region, not an element -- every element inside
 * keeps its own spec untouched.
 * @param {number} projectId
 * @param {string} regionId
 * @param {number|null} startTime
 * @param {number|null} endTime
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function moveTextEdge(projectId, regionId, startTime = null, endTime = null) {
  const data = {};
  if (startTime !== null) data.start_time = startTime;
  if (endTime !== null) data.end_time = endTime;
  return sendAction(projectId, 'move_text_edge', { id: regionId }, data);
}

/**
 * T6630 round 4: replace one text ELEMENT's WHOLE TextSpec (design O4 --
 * entity-surgical, debounced by the caller, never per-keystroke). Searched
 * across every region server-side.
 * @param {number} projectId
 * @param {string} elementId
 * @param {Object} spec - The full, updated TextSpec
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function updateTextSpec(projectId, elementId, spec) {
  return sendAction(projectId, 'update_text_spec', { id: elementId }, { spec });
}

/**
 * T6630 round 4: enable/disable one text ELEMENT without deleting it.
 * @param {number} projectId
 * @param {string} elementId
 * @param {boolean} enabled
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function toggleText(projectId, elementId, enabled) {
  return sendAction(projectId, 'toggle_text', { id: elementId }, { enabled });
}

/**
 * T6630 round 4: delete one text ELEMENT by id. Idempotent server-side if
 * already absent. Deletes the parent REGION too if this was its last
 * element (a region always has >=1 element in the UI's model).
 * @param {number} projectId
 * @param {string} elementId
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function deleteText(projectId, elementId) {
  return sendAction(projectId, 'delete_text', { id: elementId });
}

/**
 * T6630 round 4: delete a text REGION and every element inside it in ONE
 * surgical write (the timeline lane's keyboard delete on the focused
 * region-block uses this, not N per-element deletes).
 * @param {number} projectId
 * @param {string} regionId
 * @returns {Promise<{success: boolean, version: number}>}
 */
export async function deleteTextRegion(projectId, regionId) {
  return sendAction(projectId, 'delete_text_region', { id: regionId });
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
