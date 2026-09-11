import { UPLOAD_PHASE } from '../services/uploadManager';
import { UPLOAD_STATE } from '../config/displayNames';

/**
 * T9430: derive the honest four-state upload UI from the real uploadManager phase
 * machine. One place maps phase/status -> {Preparing, Uploading, Saved, Upload failed}
 * so every surface (the annotate local-preview banner, the app-level indicator) agrees.
 *
 *   Preparing  <- HASHING | PREPARING | QUEUED | IDLE  (local work: probe, hash, queue;
 *                 the bytes are NOT on the server yet)
 *   Uploading  <- UPLOADING | FINALIZING              (transferring / server finishing)
 *   Saved      <- COMPLETE                            (server acknowledged: activate_game
 *                 returned; the gesture's own promise resolved - never a useEffect)
 *   Upload failed <- ERROR                            (retained with file+metadata for Retry)
 *
 * Pure and side-effect-free so it can be unit-tested and called from any render.
 */
export const UPLOAD_UI_STATE = {
  PREPARING: 'preparing',
  UPLOADING: 'uploading',
  SAVED: 'saved',
  FAILED: 'failed',
};

export function uploadUiState(entry) {
  if (!entry) return null;
  // A failed entry always carries phase ERROR (uploadStore.onEntryError sets phase and
  // status together). Keying on phase keeps this helper dependency-free of the store.
  if (entry.phase === UPLOAD_PHASE.ERROR) return UPLOAD_UI_STATE.FAILED;
  if (entry.phase === UPLOAD_PHASE.COMPLETE) return UPLOAD_UI_STATE.SAVED;
  if (entry.phase === UPLOAD_PHASE.UPLOADING || entry.phase === UPLOAD_PHASE.FINALIZING) {
    return UPLOAD_UI_STATE.UPLOADING;
  }
  // HASHING, PREPARING, QUEUED, IDLE: local/pre-transfer work, not yet on the server.
  return UPLOAD_UI_STATE.PREPARING;
}

export function uploadStateLabel(uiState) {
  switch (uiState) {
    case UPLOAD_UI_STATE.PREPARING: return UPLOAD_STATE.PREPARING;
    case UPLOAD_UI_STATE.UPLOADING: return UPLOAD_STATE.UPLOADING;
    case UPLOAD_UI_STATE.SAVED: return UPLOAD_STATE.SAVED;
    case UPLOAD_UI_STATE.FAILED: return UPLOAD_STATE.FAILED;
    default: return '';
  }
}

// True while the upload has NOT been acknowledged by the server, i.e. a local preview
// shown now would be lying if it implied "saved online".
export function isLocalPreviewUnsaved(uiState) {
  return uiState === UPLOAD_UI_STATE.PREPARING || uiState === UPLOAD_UI_STATE.UPLOADING;
}
