import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { canReEditReel } from '../utils/reelReEditable';

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
 * @param {(projectId:number)=>void} navigateToProject
 * @returns {{ openReelAsProject: (reel:{id:number, project_id?:number})=>Promise<void>, restoringId: number|null }}
 */
export function useReEditReel(navigateToProject) {
  // Download/final-video id currently being restored — drives per-reel loading UI.
  const [restoringId, setRestoringId] = useState(null);

  const openReelAsProject = useCallback(async (reel) => {
    // Gated by the button (only shown when the reel has an editable project), but
    // mirror the card's guard so a programmatic call can't fire a bad restore.
    // T11220: also refuse a legacy multi-clip reel (clip_count > 1) — the button
    // is hidden for these, and restore-project 400s them, so a stray call here
    // (e.g. the ranker replay path) tells the user why instead of alerting a raw
    // backend error.
    if (!canReEditReel(reel)) {
      if (reel?.clip_count > 1) {
        alert('This reel was made from multiple clips and can no longer be re-edited. You can still view, download, and share it.');
      }
      return;
    }
    setRestoringId(reel.id);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/${reel.id}/restore-project`, {
        method: 'POST',
      });
      // T4050: durable sync failure — the unpublish committed locally but never
      // reached R2. Do NOT navigate (which would imply the edit stuck); the reel
      // stays in My Reels and the user can retry by clicking Edit again.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[useReEditReel] sync_failed (503) for reel=${reel.id} - reel kept, ask user to retry`);
          alert('Could not save to the cloud. Your reel was not moved. Please try again.');
          return;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to restore reel');
      }
      const result = await response.json();
      // project_id from the response (may differ from reel.project_id if restored).
      navigateToProject(result.project_id);
    } catch (error) {
      console.error('[useReEditReel] Restore project error:', error);
      alert(`Failed to open reel as draft: ${error.message}`);
    } finally {
      setRestoringId(null);
    }
  }, [navigateToProject]);

  return { openReelAsProject, restoringId };
}

export default useReEditReel;
