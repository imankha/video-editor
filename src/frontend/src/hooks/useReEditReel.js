import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

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
    if (!reel?.project_id || reel.project_id === 0) return;
    setRestoringId(reel.id);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/${reel.id}/restore-project`, {
        method: 'POST',
      });
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
