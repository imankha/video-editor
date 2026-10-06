import { useGalleryStore } from '../stores/galleryStore';
import { EDITOR_MODES } from '../stores/editorStore';
import { FOCUS_PUBLISH_LATER_TOAST } from '../config/displayNames';
import { peekAnnotateOrigin, clearAnnotateOrigin, setPendingGame } from './pendingNavigation';

/**
 * T11800: the navigation half of Focus's "Done for now" (handleAddSpotlightLater).
 * Runs inside the gesture handler, never from an effect.
 *
 * - Started from Annotate: return to that game with the play re-selected (breadcrumb)
 *   and arm the consume-once "is framed" banner (galleryStore.justFramed).
 * - Otherwise (e.g. an uploaded clip with no game): toast, then land on Clips with the
 *   new draft scrolled into view and ringed once (clipsRingTarget).
 */
export function leaveFocusForLater(projectId, { setEditorMode, goToProjectManager, toastSuccess }) {
  const origin = peekAnnotateOrigin(projectId);
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
