import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { recordWrite } from '../utils/syncTrace';
import { canReEditReel } from '../utils/reelReEditable';
import { ERROR_COPY } from '../config/displayNames';
import { toast } from '../components/shared/Toast';
import { serverError, userErrorMessage } from '../utils/userError';

/**
 * useReEditReel - single open-then-navigate path for "Edit highlight" (T3940).
 *
 * The Highlights tile menu, the in-player Re-edit button and the ranker replay all
 * share THIS one code path:
 *   POST /api/downloads/{id}/open-for-redo  (re-materializes an old-style archive)
 *   -> navigateToProject(result.project_id) (caller-supplied navigation)
 *
 * T17140: opening never unpublishes. The highlight stays in Highlights, finished and
 * shared as before, until a new sharpen replaces it (the old restore-project path
 * moved it to Plays as a private in-progress draft just for opening it), so no
 * Highlights/Plays holder changes and no change events fire here.
 *
 * Pure navigation off a user gesture. `navigateToProject` is the caller's
 * editor-navigation (e.g. onOpenProject + close the story player).
 *
 * @param {(projectId:number)=>void} navigateToProject
 * @returns {{ openReelAsProject: (reel:{id:number, project_id?:number})=>Promise<{navigated:boolean}>, restoringId: number|null }}
 */
export function useReEditReel(navigateToProject) {
  // Download/final-video id currently being restored — drives per-reel loading UI.
  const [restoringId, setRestoringId] = useState(null);

  const openReelAsProject = useCallback(async (reel) => {
    const outcome = { navigated: false };
    // Gated by the button (only shown when the reel has an editable project), but
    // mirror the card's guard so a programmatic call can't fire a bad open.
    // T11220: also refuse a legacy multi-clip reel (clip_count > 1); the backend's
    // 400 is the backstop and surfaces through the error path below.
    if (!canReEditReel(reel)) return outcome;
    setRestoringId(reel.id);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/${reel.id}/open-for-redo`, {
        method: 'POST',
      });
      recordWrite('downloads.openForRedo', 'open-for-redo', response, { downloadId: reel.id, projectId: reel.project_id });
      // T4050: durable sync failure (only an old-style archive restore writes here).
      // Do NOT navigate; the sync-failed Retry UX owns the push.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[useReEditReel] sync_failed (503) for reel=${reel.id} - local DB changed, cloud sync pending`);
          toast.error(ERROR_COPY.CHANGES_NOT_SYNCED);
          return outcome;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        throw serverError(response, error, ERROR_COPY.OPEN_HIGHLIGHT);
      }
      const result = await response.json();
      navigateToProject(result.project_id);
      outcome.navigated = true;
    } catch (error) {
      toast.error(userErrorMessage(error, ERROR_COPY.OPEN_HIGHLIGHT));
    } finally {
      setRestoringId(null);
    }
    return outcome;
  }, [navigateToProject]);

  return { openReelAsProject, restoringId };
}

export default useReEditReel;
