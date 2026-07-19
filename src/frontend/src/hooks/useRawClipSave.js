import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { toast } from '../components/shared/Toast';
import { useQuestStore } from '../stores/questStore';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * T5350: clip-gesture-appropriate copy for a durable sync failure (503
 * `{code:'sync_failed'}`, from T4320's `Depends(durable_sync)` on the clip routes).
 *
 * The backend reuses the shared `DURABLE_SYNC_FAILED_RESPONSE`, whose `detail` reads
 * "Your reel was not moved" — nonsensical for a clip save/update/delete. So we key the
 * user-facing copy on the GESTURE here instead of surfacing the backend `detail`. Same
 * title as the publish/move durable-fail UX (`useMoveReels`), clip-specific body.
 */
export const CLIP_SYNC_FAILED_COPY = {
  save: {
    title: 'Could not save to the cloud',
    message: "Your clip wasn't saved. Please try again.",
  },
  update: {
    title: 'Could not save to the cloud',
    message: "Your clip changes weren't saved. Please try again.",
  },
  delete: {
    title: 'Could not save to the cloud',
    message: "Your clip wasn't deleted. Please try again.",
  },
};

/**
 * Extract the durable-sync-failure code from a non-ok response body. The middleware
 * returns the payload at the top level (`{detail, code, retryable}`), but tolerate an
 * HTTPException-wrapped `{detail: {code}}` too so any route shape is handled.
 */
function syncFailedCode(body) {
  return body?.code || body?.detail?.code || null;
}

/**
 * Surface the clip-not-saved state for a durable sync failure: a persistent toast
 * (mirrors the overlay/publish durable-fail UX) carrying a Retry that re-runs the
 * SAME gesture. The retry is a user click — NOT a reactive re-send. `dedupKey` keeps
 * repeated failures of one gesture to a single toast instead of stacking.
 */
export function surfaceClipSyncFailed(gesture, retry) {
  const copy = CLIP_SYNC_FAILED_COPY[gesture];
  console.warn(`[useRawClipSave] ${gesture} sync_failed (503) — clip not saved, offering Retry`);
  toast.error(copy.title, {
    message: copy.message,
    duration: 0, // persistent until retried/dismissed
    dedupKey: `clip-sync-failed-${gesture}`,
    action: { label: 'Retry', onClick: retry },
  });
}

/**
 * T540: Refresh quest progress after any clip mutation.
 *
 * All rating-based quest steps (annotate_brilliant, annotate_4_star,
 * annotate_brilliant_2, create_mixed_project) are derived
 * from raw_clips data — no flags, just DB queries. This function tells the
 * quest store to re-derive progress after any clip change.
 *
 * Called from saveClip, updateClip, and deleteClip so that any current or
 * future rating-based quest step auto-detects completion.
 */
function refreshQuestProgress() {
  useQuestStore.getState().fetchProgress({ force: true });
}

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
      if (clipData.create_project) {
        console.warn('[CreateReel] BLOCKED by pendingSaves dedup guard, saveKey:', saveKey);
      }
      return null;
    }

    pendingSaves.current.add(saveKey);
    setIsSaving(true);
    setError(null);

    try {
      const payload = {
        game_id: gameId,
        start_time: clipData.start_time,
        end_time: clipData.end_time,
        name: clipData.name || '',
        rating: clipData.rating || 3,
        tags: clipData.tags || [],
        notes: clipData.notes || '',
        ...(clipData.video_sequence != null && { video_sequence: clipData.video_sequence }),
        ...(clipData.create_project != null && { create_project: clipData.create_project }),
        ...(clipData.tagged_teammates != null && { tagged_teammates: clipData.tagged_teammates }),
        ...(clipData.my_athlete != null && { my_athlete: clipData.my_athlete }),
      };
      if (clipData.create_project) {
        console.log('[CreateReel] saveClip sending POST /clips/raw/save', { create_project: payload.create_project, game_id: payload.game_id });
      }
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (clipData.create_project) {
          console.error('[CreateReel] saveClip got HTTP error:', response.status, errorData);
        }
        // T5350: durable clip save committed locally but never reached R2 (T4320).
        // Surface a clip-appropriate not-saved state + Retry — never a silent success.
        if (response.status === 503 && syncFailedCode(errorData) === 'sync_failed') {
          setError(CLIP_SYNC_FAILED_COPY.save.message);
          surfaceClipSyncFailed('save', () => saveClip(gameId, clipData));
          return null;
        }
        throw new Error(errorData.detail || 'Failed to save clip');
      }

      const result = await response.json();
      console.log('[useRawClipSave] Saved clip:', result.raw_clip_id);

      if (result.project_created) {
        console.log('[useRawClipSave] Auto-created project:', result.project_id);
      }

      refreshQuestProgress();
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
      if (updates.create_project) {
        console.log('[CreateReel] updateClip sending PUT /clips/raw/' + clipId, { updates });
      }
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (updates.create_project) {
          console.error('[CreateReel] updateClip got HTTP error:', response.status, errorData);
        }
        // T5350: durable clip update committed locally but never reached R2 (T4320).
        if (response.status === 503 && syncFailedCode(errorData) === 'sync_failed') {
          setError(CLIP_SYNC_FAILED_COPY.update.message);
          surfaceClipSyncFailed('update', () => updateClip(clipId, updates));
          return null;
        }
        throw new Error(errorData.detail || 'Failed to update clip');
      }

      const result = await response.json();
      console.log('[useRawClipSave] Updated clip:', clipId);
      if (updates.create_project) {
        console.log('[CreateReel] updateClip response:', { project_created: result.project_created, project_id: result.project_id });
      }

      if (result.project_created) {
        console.log('[useRawClipSave] Auto-created project:', result.project_id);
      }

      refreshQuestProgress();
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
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // T5350: durable clip delete committed locally but never reached R2 (T4320).
        if (response.status === 503 && syncFailedCode(errorData) === 'sync_failed') {
          setError(CLIP_SYNC_FAILED_COPY.delete.message);
          surfaceClipSyncFailed('delete', () => deleteClip(clipId));
          return false;
        }
        throw new Error(errorData.detail || 'Failed to delete clip');
      }

      console.log('[useRawClipSave] Deleted clip:', clipId);
      refreshQuestProgress();
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
