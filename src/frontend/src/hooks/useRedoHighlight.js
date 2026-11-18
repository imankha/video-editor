import { useState, useCallback } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { recordWrite } from '../utils/syncTrace';
import { allowEnterFraming } from '../utils/reelReEditable';
import { clearAnnotateOrigin } from '../utils/pendingNavigation';
import { useProjectsStore } from '../stores/projectsStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { ERROR_COPY } from '../config/displayNames';
import { toast } from '../components/shared/Toast';
import { serverError, userErrorMessage } from '../utils/userError';

/**
 * useRedoHighlight (T16530) - redo a finished highlight from the Finished screen.
 *
 * Unlike useReEditReel ("open as draft", which unpublishes), opening for a redo keeps
 * the highlight in Highlights, playable and shareable; the redo's render replaces it.
 *
 *   loadRedoInfo()   GET  /api/downloads/{id}/redo-info  (read-only, on the Edit zoom
 *                    tap): { project_id, reframe_credits, game_video_available }
 *   openForRedo(mode[, videoId]) POST /api/downloads/{id}/open-for-redo, then select the project
 *                    and switch to Spotlight (OVERLAY) or Frame (FRAMING).
 *
 * Both run only inside a button's click chain (gesture-based; no effect fires them).
 *
 * @param {number=} finalVideoId - the finished highlight's final video id (omit when every
 *                                  openForRedo call passes its own videoId)
 */
export function useRedoHighlight(finalVideoId) {
  // The mode being opened (drives the button spinner), null when idle.
  const [openingMode, setOpeningMode] = useState(null);

  const loadRedoInfo = useCallback(async () => {
    const response = await apiFetch(`${API_BASE}/api/downloads/${finalVideoId}/redo-info`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw serverError(response, body, ERROR_COPY.OPEN_HIGHLIGHT);
    }
    return response.json();
  }, [finalVideoId]);

  // T17180: `videoId` lets a player of many highlights (the Highlights story player) open the
  // one on screen; the Finished screen omits it and opens its own.
  const openForRedo = useCallback(async (mode, videoId = finalVideoId) => {
    setOpeningMode(mode);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/${videoId}/open-for-redo`, {
        method: 'POST',
      });
      recordWrite('downloads.openForRedo', 'open-for-redo', response, { downloadId: videoId });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw serverError(response, body, ERROR_COPY.OPEN_HIGHLIGHT);
      }
      const { project_id: projectId } = await response.json();
      const project = await useProjectsStore.getState().selectProject(projectId);
      if (!project) {
        toast.error(ERROR_COPY.OPEN_HIGHLIGHT);
        return false;
      }
      if (mode === EDITOR_MODES.FRAMING && !allowEnterFraming(project)) return false;
      clearAnnotateOrigin();
      useEditorStore.getState().setEditorMode(mode);
      return true;
    } catch (err) {
      toast.error(userErrorMessage(err, ERROR_COPY.OPEN_HIGHLIGHT));
      return false;
    } finally {
      setOpeningMode(null);
    }
  }, [finalVideoId]);

  return { loadRedoInfo, openForRedo, openingMode };
}

export default useRedoHighlight;
