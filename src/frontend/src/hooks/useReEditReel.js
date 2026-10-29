import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { recordWrite } from '../utils/syncTrace';
import { canReEditReel } from '../utils/reelReEditable';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useGamesDataStore } from '../stores/gamesDataStore';

// Change events for "reel restored to draft" (the DB unpublished it). Gesture-scoped
// from openReelAsProject; not reactive persistence.
function applyRestoreChange(reel) {
  // T13800: the restore unpublished the project's final videos and put the draft
  // back in Clips -- the exact inverse of publish (usePublishProject). Refresh the
  // published-reels model (reads only) so the Finished badge/list and Clips tab
  // aren't stale. Gesture-scoped; not reactive persistence.
  useGalleryStore.getState().fetchCount({ force: true, reason: 'restore' });
  useGalleryStore.getState().notifyCollectionsChanged('restore');
  // T13850: change event -- the reel left Finished, so its game card loses one.
  useGamesDataStore.getState().applyReelCountDelta(reel, -1, 'restore');
  useProjectsStore.getState().fetchProjects({ force: true, reason: 'restore' });
}

/**
 * useReEditReel - single restore-then-navigate path for "Re-edit this reel" (T3940).
 *
 * The My Reels card folder button, the in-player Re-edit button (single + collection
 * players), and the ranker replay all share THIS one code path so restore-then-navigate
 * isn't duplicated. Mirrors the original DownloadsPanel.handleOpenProject flow:
 *   POST /api/downloads/{id}/restore-project  (re-materializes an archived project)
 *   -> navigateToProject(result.project_id)   (caller-supplied navigation)
 *
 * Pure navigation off a user gesture — NO new persistence (the restore POST already
 * existed for the card path). `navigateToProject` is the caller's editor-navigation
 * (e.g. onOpenProject + close gallery + close player).
 *
 * Resolves to `{ restored, navigated }` so a caller holding component state (the
 * Finished list's member cache) can apply its own change events when the DB changed
 * but nothing navigated away (the 503 sync_failed case, T13870).
 *
 * @param {(projectId:number)=>void} navigateToProject
 * @returns {{ openReelAsProject: (reel:{id:number, project_id?:number})=>Promise<{restored:boolean, navigated:boolean}>, restoringId: number|null }}
 */
export function useReEditReel(navigateToProject) {
  // Download/final-video id currently being restored — drives per-reel loading UI.
  const [restoringId, setRestoringId] = useState(null);

  const openReelAsProject = useCallback(async (reel) => {
    const outcome = { restored: false, navigated: false };
    // Gated by the button (only shown when the reel has an editable project), but
    // mirror the card's guard so a programmatic call can't fire a bad restore.
    // T11220: also refuse a legacy multi-clip reel (clip_count > 1) — the button
    // is hidden for these; this mirror-guard keeps a programmatic call from firing
    // a doomed restore. If a clip_count > 1 reel somehow reaches here, the backend
    // restore-project 400 is surfaced by the existing error path below — no
    // separate hardcoded copy needed (T11220 review).
    if (!canReEditReel(reel)) return outcome;
    setRestoringId(reel.id);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/${reel.id}/restore-project`, {
        method: 'POST',
      });
      recordWrite('downloads.restore', 'restore', response, { downloadId: reel.id, projectId: reel.project_id });
      // T4050/T13870: durable sync failure -- the unpublish ALREADY committed to the
      // local DB (only the R2 push failed), so the holders follow the DB with the same
      // change events as a successful restore. Do NOT navigate (the edit didn't reach
      // the cloud); the sync-failed Retry UX owns the push.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[useReEditReel] sync_failed (503) for reel=${reel.id} - local DB changed, cloud sync pending`);
          applyRestoreChange(reel);
          outcome.restored = true;
          alert('Could not save to the cloud yet. Your highlight moved to drafts on this device and will sync when you retry.');
          return outcome;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to restore highlight');
      }
      const result = await response.json();
      applyRestoreChange(reel);
      outcome.restored = true;
      // project_id from the response (may differ from reel.project_id if restored).
      navigateToProject(result.project_id);
      outcome.navigated = true;
    } catch (error) {
      console.error('[useReEditReel] Restore project error:', error);
      alert(`Failed to open highlight as draft: ${error.message}`);
    } finally {
      setRestoringId(null);
    }
    return outcome;
  }, [navigateToProject]);

  return { openReelAsProject, restoringId };
}

export default useReEditReel;
