import { useState, useCallback } from 'react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * useProjectClips - Manages working clips for a project
 *
 * Handles:
 * - Fetching clips from server
 * - Adding clips (from library or upload)
 * - Removing clips
 * - Reordering clips
 * - Saving framing edits
 */
export function useProjectClips(projectId) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all clips for the project
   * @param {number} overrideProjectId - Optional project ID to use instead of hook's projectId
   *                                     (useful when calling immediately after selectProject before React re-renders)
   */
  const fetchClips = useCallback(async (overrideProjectId = null) => {
    const effectiveProjectId = overrideProjectId ?? projectId;
    console.log('[useProjectClips v2] fetchClips called with overrideProjectId:', overrideProjectId, 'hook projectId:', projectId, 'effective:', effectiveProjectId);

    if (!effectiveProjectId) {
      console.log('[useProjectClips] No effective projectId, returning empty array');
      return [];
    }

    const url = `${API_BASE_URL}/clips/projects/${effectiveProjectId}/clips`;
    console.log('[useProjectClips] Fetching from URL:', url);

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      console.log('[useProjectClips] Response status:', response.status, response.ok);
      if (!response.ok) throw new Error('Failed to fetch clips');
      const data = await response.json();
      console.log('[useProjectClips] Fetched data:', data.length, 'clips');
      setClips(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] fetchClips error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /**
   * Add a clip from the raw clips library
   */
  const addClipFromLibrary = useCallback(async (rawClipId) => {
    if (!projectId) return null;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('raw_clip_id', rawClipId.toString());

      const response = await fetch(`${API_BASE_URL}/clips/projects/${projectId}/clips`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to add clip');
      const clip = await response.json();

      // Refresh clips list
      await fetchClips();

      return clip;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] addClipFromLibrary error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Upload a new clip file to the project
   */
  const uploadClip = useCallback(async (file) => {
    if (!projectId) return null;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/clips/projects/${projectId}/clips`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to upload clip');
      const clip = await response.json();

      // Refresh clips list
      await fetchClips();

      return clip;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] uploadClip error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Upload a new clip file with metadata (name, rating, tags, notes)
   * @param {Object} uploadData - { file, name, rating, tags, notes }
   */
  const uploadClipWithMetadata = useCallback(async (uploadData) => {
    if (!projectId) return null;

    const { file, name, rating, tags, notes } = uploadData;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name || '');
      formData.append('rating', (rating || 3).toString());
      formData.append('tags', JSON.stringify(tags || []));
      formData.append('notes', notes || '');

      const response = await fetch(`${API_BASE_URL}/clips/projects/${projectId}/clips/upload-with-metadata`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to upload clip');
      const clip = await response.json();

      // Refresh clips list
      await fetchClips();

      return clip;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] uploadClipWithMetadata error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Remove a clip from the project
   */
  const removeClip = useCallback(async (clipId) => {
    if (!projectId) return false;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}`,
        { method: 'DELETE' }
      );
      if (!response.ok) throw new Error('Failed to remove clip');

      // Refresh clips list
      await fetchClips();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] removeClip error:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchClips]);

  /**
   * Reorder clips
   */
  const reorderClips = useCallback(async (clipIds) => {
    if (!projectId) return false;

    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/reorder`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clipIds)
        }
      );
      if (!response.ok) throw new Error('Failed to reorder clips');

      // Refresh clips list
      await fetchClips();

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] reorderClips error:', err);
      return false;
    }
  }, [projectId, fetchClips]);

  /**
   * Save framing edits for a clip
   * @param {number} clipId - Working clip ID
   * @param {Object} framingData - Framing edit data
   * @param {Array} framingData.cropKeyframes - Crop keyframes array
   * @param {Object} framingData.segments - Segment data (boundaries, speeds, etc.)
   * @param {Object} framingData.trimRange - Trim range data
   * @returns {Object} Result object with success boolean
   */
  const saveFramingEdits = useCallback(async (clipId, framingData) => {
    if (!projectId) return { success: false };

    setError(null);
    try {
      const updatePayload = {};

      // Serialize crop keyframes
      if (framingData.cropKeyframes !== undefined) {
        updatePayload.crop_data = JSON.stringify(framingData.cropKeyframes);
      }

      // Serialize segments data
      if (framingData.segments !== undefined) {
        updatePayload.segments_data = JSON.stringify(framingData.segments);
      }

      // Serialize timing data (includes trim range)
      if (framingData.trimRange !== undefined) {
        updatePayload.timing_data = JSON.stringify({
          trimRange: framingData.trimRange
        });
      }

      // Only make request if there's something to update
      if (Object.keys(updatePayload).length === 0) {
        return { success: true };
      }

      console.log('[useProjectClips] Saving framing edits for clip:', clipId, updatePayload);

      const response = await fetch(
        `${API_BASE_URL}/clips/projects/${projectId}/clips/${clipId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload)
        }
      );
      if (!response.ok) throw new Error('Failed to save framing edits');

      const result = await response.json();

      // Backend tells us if we need to refresh (e.g., new data was created server-side)
      if (result.refresh_required) {
        console.log('[useProjectClips] Server indicated refresh required, new clip ID:', result.new_clip_id);
        await fetchClips();
        // Return the new clip ID so caller can update selection
        return {
          success: true,
          newClipId: result.new_clip_id,
          newVersion: result.new_version
        };
      } else {
        // No refresh needed - update local state with data we just sent
        setClips(prev => prev.map(c =>
          c.id === clipId ? { ...c, ...updatePayload } : c
        ));
      }

      return { success: true };
    } catch (err) {
      setError(err.message);
      console.error('[useProjectClips] saveFramingEdits error:', err);
      return { success: false };
    }
  }, [projectId, fetchClips]);

  /**
   * Get clip file URL
   * @param {number} clipId - Clip ID
   * @param {number} overrideProjectId - Optional project ID to use instead of hook's projectId
   */
  const getClipFileUrl = useCallback((clipId, overrideProjectId = null) => {
    const effectiveProjectId = overrideProjectId ?? projectId;
    if (!effectiveProjectId) return null;
    return `${API_BASE_URL}/clips/projects/${effectiveProjectId}/clips/${clipId}/file`;
  }, [projectId]);

  return {
    clips,
    loading,
    error,
    hasClips: clips.length > 0,

    fetchClips,
    addClipFromLibrary,
    uploadClip,
    uploadClipWithMetadata,
    removeClip,
    reorderClips,
    saveFramingEdits,
    getClipFileUrl
  };
}

export default useProjectClips;
