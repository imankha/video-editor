import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * useRawClipSave - Manages real-time clip saving during annotation
 *
 * Provides:
 * - saveClip: Save a new clip to raw_clips (extracts from game video)
 * - updateClip: Update clip metadata (with 5-star sync)
 * - deleteClip: Delete a clip from the library
 * - isSaving: Loading state for saves
 * - error: Error message if any
 */
export function useRawClipSave() {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Track pending saves to avoid duplicate requests
  const pendingSaves = useRef(new Set());

  /**
   * Save a new raw clip during annotation.
   * Extracts the clip from the game video and saves to library.
   * If rating is 5, automatically creates a 9:16 project.
   *
   * @param {number} gameId - The game ID to extract from
   * @param {object} clipData - Clip data including start_time, end_time, etc.
   * @returns {object|null} - { raw_clip_id, filename, project_created, project_id }
   */
  const saveClip = useCallback(async (gameId, clipData) => {
    // Create a unique key for this save operation
    const saveKey = `${gameId}-${clipData.start_time}-${clipData.end_time}`;

    // Skip if already saving this clip
    if (pendingSaves.current.has(saveKey)) {
      console.log('[useRawClipSave] Skipping duplicate save:', saveKey);
      return null;
    }

    pendingSaves.current.add(saveKey);
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/clips/raw/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: gameId,
          start_time: clipData.start_time,
          end_time: clipData.end_time,
          name: clipData.name || '',
          rating: clipData.rating || 3,
          tags: clipData.tags || [],
          notes: clipData.notes || '',
          ...(clipData.video_sequence != null && { video_sequence: clipData.video_sequence }),
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save clip');
      }

      const result = await response.json();
      console.log('[useRawClipSave] Saved clip:', result.raw_clip_id);

      if (result.project_created) {
        console.log('[useRawClipSave] Auto-created project:', result.project_id);
      }

      return result;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClipSave] saveClip error:', err);
      return null;
    } finally {
      pendingSaves.current.delete(saveKey);
      setIsSaving(false);
    }
  }, []);

  /**
   * Update a raw clip's metadata.
   * Handles 5-star sync automatically:
   * - Rating changed TO 5: Creates auto-project
   * - Rating changed FROM 5: Deletes auto-project (if unmodified)
   * - Duration changed: Re-extracts clip
   *
   * @param {number} clipId - The raw clip ID to update
   * @param {object} updates - Partial update object
   * @returns {object|null} - { success, project_created, project_id }
   */
  const updateClip = useCallback(async (clipId, updates) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to update clip');
      }

      const result = await response.json();
      console.log('[useRawClipSave] Updated clip:', clipId);

      if (result.project_created) {
        console.log('[useRawClipSave] Auto-created project:', result.project_id);
      }

      return result;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClipSave] updateClip error:', err);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, []);

  /**
   * Delete a raw clip from the library.
   * Also deletes:
   * - The video file from disk
   * - Any auto-created project (if unmodified)
   * - Working clips that reference this clip
   *
   * @param {number} clipId - The raw clip ID to delete
   * @returns {boolean} - true if successful
   */
  const deleteClip = useCallback(async (clipId) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete clip');
      }

      console.log('[useRawClipSave] Deleted clip:', clipId);
      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClipSave] deleteClip error:', err);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  /**
   * Clear any error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isSaving,
    error,

    // Actions
    saveClip,
    updateClip,
    deleteClip,
    clearError
  };
}

export default useRawClipSave;
