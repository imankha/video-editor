import { useState, useCallback, useRef } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { toast } from '../components/shared/Toast';
import { useQuestStore } from '../stores/questStore';
import { CLIP_LINK } from '../config/displayNames';

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
  // T10300: link/unlink an uploaded clip to a game (POST /clips/raw/{id}/link,
  // durable_sync-gated like the others).
  link: {
    title: 'Could not save to the cloud',
    message: "Your clip's game wasn't updated. Please try again.",
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
 * T7010: Build request headers with the frontend's ACTIVE game stamped on as
 * `X-Client-Game-Id`. The backend logs this alongside the game the clip row is
 * actually stored under, so a "clip saved under the wrong game" report is visible
 * in one log line instead of requiring req_id DB archaeology. Diagnostic only —
 * the backend never derives attribution from it (game_id in the save body remains
 * authoritative); it is omitted entirely when no active game is known.
 */
function withClientGameHeader(headers, activeGameIdRef) {
  const gid = activeGameIdRef?.current;
  return gid != null ? { ...headers, 'X-Client-Game-Id': String(gid) } : headers;
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
 *
 * @param {{current: number|null}} [activeGameIdRef] - optional ref to the screen's
 *   current active game; when supplied, stamped onto every clip request as the
 *   `X-Client-Game-Id` diagnostic header (T7010).
 */
export function useRawClipSave(activeGameIdRef = null) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Track pending saves to avoid duplicate requests
  const pendingSaves = useRef(new Set());

  /**
   * Save a new raw clip during annotation.
   * Extracts the clip from the game video and saves to library.
   * Creates a 9:16 editable-clip project only when `create_project` is set —
   * an EXPLICIT caller choice, never inferred from the rating (T9830). The
   * rating is descriptive metadata; "Create an editable clip" and "Save play"
   * are two separate Save outcomes now.
   *
   * @param {number} gameId - The game ID to extract from
   * @param {object} clipData - Clip data including start_time, end_time, etc.
   * @param {Function} [retry] - T10610: optional override for the Retry
   *   action's onClick — see updateClip's jsdoc for why.
   * @returns {object|null} - { raw_clip_id, filename, project_created, project_id }
   */
  const saveClip = useCallback(async (gameId, clipData, retry) => {
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
        headers: withClientGameHeader({ 'Content-Type': 'application/json' }, activeGameIdRef),
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
          surfaceClipSyncFailed('save', retry ?? (() => saveClip(gameId, clipData)));
          return null;
        }
        // T8180: the game was deleted out from under the user (ghost session). The
        // backend now refuses to write an orphan clip (was a silent 200). Signal the
        // caller distinctly so it can preserve the in-memory region and surface the
        // ghost — never a silent drop.
        if (response.status === 404) {
          console.warn('[useRawClipSave] saveClip: game no longer exists (404) — ghost session, clip not saved');
          return { notFound: true };
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
  }, [activeGameIdRef]);

  /**
   * Update a raw clip's metadata.
   * Clip/project creation is driven ONLY by an explicit `create_project` flag
   * in `updates` (T9830), never by the rating:
   * - create_project set, no project yet: Creates auto-project
   * - Duration changed: Re-extracts clip
   * (The old "5-star sync" that created/deleted a project as the rating crossed
   * 5 lived in a since-removed frontend default, not the backend.)
   *
   * @param {number} clipId - The raw clip ID to update
   * @param {object} updates - Partial update object
   * @param {Function} [retry] - T10610: optional override for the Retry
   *   action's onClick (defaults to re-calling this same gesture directly).
   *   The play editor's per-region write queue passes a closure that
   *   re-enqueues through the queue instead, so a Retry can't land out of
   *   order with a newer write on the same region.
   * @returns {object|null} - { success, project_created, project_id }
   */
  const updateClip = useCallback(async (clipId, updates, retry) => {
    setIsSaving(true);
    setError(null);

    try {
      if (updates.create_project) {
        console.log('[CreateReel] updateClip sending PUT /clips/raw/' + clipId, { updates });
      }
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'PUT',
        headers: withClientGameHeader({ 'Content-Type': 'application/json' }, activeGameIdRef),
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
          surfaceClipSyncFailed('update', retry ?? (() => updateClip(clipId, updates)));
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
  }, [activeGameIdRef]);

  /**
   * Delete a raw clip from the library.
   * Also deletes:
   * - The video file from disk
   * - Any auto-created project (if unmodified)
   * - Working clips that reference this clip
   *
   * @param {number} clipId - The raw clip ID to delete
   * @param {Function} [retry] - T10610: optional override for the Retry
   *   action's onClick — see updateClip's jsdoc for why.
   * @returns {boolean} - true if successful
   */
  const deleteClip = useCallback(async (clipId, retry) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/${clipId}`, {
        method: 'DELETE',
        headers: withClientGameHeader({}, activeGameIdRef)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // T5350: durable clip delete committed locally but never reached R2 (T4320).
        if (response.status === 503 && syncFailedCode(errorData) === 'sync_failed') {
          setError(CLIP_SYNC_FAILED_COPY.delete.message);
          surfaceClipSyncFailed('delete', retry ?? (() => deleteClip(clipId)));
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
  }, [activeGameIdRef]);

  /**
   * T10300: Link (or unlink) an UPLOADED raw clip to a game — a gesture-based,
   * surgical call carrying only the changed field (the game id). Mirrors
   * updateClip's shape: durable_sync-gated (POST /clips/raw/{id}/link), so a 503
   * `sync_failed` surfaces the same Retry UX; a 404 (clip or target game gone) and
   * a 409 (clip is not `source==='upload'` — a game-cut clip, which the affordance
   * never exposes) are surfaced distinctly, never swallowed.
   *
   * @param {number} clipId - The raw clip ID (project.clips[0].id)
   * @param {number|null} gameId - Target game id to link to; `null` = unlink
   * @returns {{ success: true, clip_id, game_id }|null}
   */
  const linkRawClipToGame = useCallback(async (clipId, gameId) => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await apiFetch(`${API_BASE_URL}/clips/raw/${clipId}/link`, {
        method: 'POST',
        headers: withClientGameHeader({ 'Content-Type': 'application/json' }, activeGameIdRef),
        body: JSON.stringify({ game_id: gameId ?? null }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // T5350/T4320: durable link committed locally but never reached R2.
        if (response.status === 503 && syncFailedCode(errorData) === 'sync_failed') {
          setError(CLIP_SYNC_FAILED_COPY.link.message);
          surfaceClipSyncFailed('link', () => linkRawClipToGame(clipId, gameId));
          return null;
        }
        // 409: the clip is not an upload clip (game-cut clips can never be
        // relinked). The upload-gated affordance should make this unreachable, but
        // surface it plainly rather than hiding it.
        if (response.status === 409) {
          setError(CLIP_LINK.ERROR_NOT_UPLOAD);
          toast.error(CLIP_LINK.ERROR_NOT_UPLOAD);
          return null;
        }
        setError(CLIP_LINK.ERROR_GENERIC);
        toast.error(errorData.detail || CLIP_LINK.ERROR_GENERIC);
        return null;
      }

      const result = await response.json();
      refreshQuestProgress();
      return result;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClipSave] linkRawClipToGame error:', err);
      toast.error(CLIP_LINK.ERROR_GENERIC);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [activeGameIdRef]);

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
    linkRawClipToGame,
    clearError
  };
}

export default useRawClipSave;
