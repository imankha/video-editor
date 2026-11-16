import { useGalleryStore } from '../stores/galleryStore';
import { EDITOR_MODES } from '../stores/editorStore';
import { FOCUS_PUBLISH_LATER_TOAST, FINISHED_TOAST } from '../config/displayNames';
import { peekAnnotateOrigin, clearAnnotateOrigin, setPendingGame } from './pendingNavigation';

/**
 * T11800: the navigation half of Focus's "Done for now" (handleAddSpotlightLater).
 * Runs inside the gesture handler, never from an effect.
 *
 * - Started from Annotate: return to that game with the play re-selected (breadcrumb)
 *   and arm the consume-once "is framed" banner (galleryStore.justFramed).
 * - Otherwise (e.g. an uploaded clip with no game): toast, then land on Clips with the
 *   new draft scrolled into view and ringed once (clipsRingTarget).
 * - T16525 `finished` (the server already put it in Highlights, T16520): the toast says
 *   so, Annotate gets no "is framed, finish it any time" banner, and the fallback
 *   landing is the Highlights tab.
 */
export function leaveFocusForLater(projectId, { setEditorMode, goToProjectManager, toastSuccess, finished = false }) {
  const origin = peekAnnotateOrigin(projectId);
  if (finished) {
    toastSuccess(FINISHED_TOAST.title, { message: FINISHED_TOAST.message, duration: 10000 });
    if (origin) {
      clearAnnotateOrigin();
      setPendingGame(origin.gameId, null, origin.sourceClipId);
      setEditorMode(EDITOR_MODES.ANNOTATE);
      return;
    }
    sessionStorage.setItem('projectManagerTab', 'published');
    goToProjectManager();
    return;
  }
  if (origin) {
    clearAnnotateOrigin();
    setPendingGame(origin.gameId, null, origin.sourceClipId);
    useGalleryStore.getState().setJustFramed({ projectId });
    setEditorMode(EDITOR_MODES.ANNOTATE);
    return;
  }
  // T11230: every draft (incl. a legacy multi-clip draft in the Legacy reels group)
  // uses the one SINGLE_CLIP copy.
  const copy = FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP;
  toastSuccess(copy.title, { message: copy.message, duration: 10000 });
  sessionStorage.setItem('projectManagerTab', 'projects');
  useGalleryStore.getState().setClipsRingTarget(projectId);
  goToProjectManager();
}
