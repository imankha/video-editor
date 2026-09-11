import { Loader2, CloudOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { useUploadStore, useUploadForGame } from '../stores/uploadStore';
import { UPLOAD_STATE } from '../config/displayNames';
import {
  uploadUiState,
  uploadStateLabel,
  isLocalPreviewUnsaved,
  UPLOAD_UI_STATE,
} from '../utils/uploadPresentation';

/**
 * T9430: honest upload-state banner shown NEXT TO the local preview during
 * annotate-during-upload. The reported bug: a parent watched their video play while
 * the game had actually failed to upload - a visible local preview reads as "it
 * worked". This banner tells the truth for the game on screen:
 *
 *   Preparing / Uploading -> "Local preview - not saved online yet" + the real state
 *   Upload failed          -> the failure + a Retry upload action (file+metadata are
 *                             retained in the entry's retryContext)
 *   Saved (server ack)     -> the entry retires in uploadStore.onEntryComplete (the
 *                             upload gesture's OWN promise resolving, never a useEffect),
 *                             so this banner disappears and the real saved game shows.
 *
 * This component OWNS the ticking subscription (useUploadForGame re-renders each
 * progress tick) so AnnotateScreen never subscribes to it - the T7280 landmine
 * (a background tick must not re-run AnnotateScreen's redirect/restore effects).
 * It reads store state and dispatches a named gesture (Retry); it never persists.
 */
export function UploadPreviewNotice({ gameId }) {
  const entry = useUploadForGame(gameId);
  const retryUpload = useUploadStore(state => state.retryUpload);

  if (!entry) return null;
  const state = uploadUiState(entry);
  // Saved is not a banner: the entry retires on server ack, so we only ever render the
  // in-flight ("not saved yet") and failed states here.
  if (state === UPLOAD_UI_STATE.SAVED) return null;

  if (state === UPLOAD_UI_STATE.FAILED) {
    return (
      <div
        data-testid="upload-preview-notice"
        data-upload-state={state}
        role="alert"
        className="flex items-center justify-between gap-3 px-3 py-2 mb-2 rounded-lg bg-rose-900/30 border border-rose-700/50 text-sm"
      >
        <span className="flex items-center gap-2 text-rose-200 min-w-0">
          <AlertTriangle size={16} className="flex-shrink-0" />
          <span className="truncate">
            <span className="font-medium">{UPLOAD_STATE.FAILED}.</span>{' '}
            {entry.message || "This game didn't save online. Your file and details are kept."}
          </span>
        </span>
        <button
          type="button"
          onClick={() => retryUpload(entry.id)}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <RefreshCw size={13} className="flex-shrink-0" />
          {UPLOAD_STATE.RETRY_UPLOAD}
        </button>
      </div>
    );
  }

  // Preparing / Uploading: label the on-screen preview as not-yet-saved.
  const unsaved = isLocalPreviewUnsaved(state);
  return (
    <div
      data-testid="upload-preview-notice"
      data-upload-state={state}
      className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-amber-900/25 border border-amber-700/40 text-sm text-amber-100"
    >
      {unsaved ? <CloudOff size={16} className="flex-shrink-0" /> : <Loader2 size={16} className="flex-shrink-0 animate-spin" />}
      <span className="truncate">
        <span className="font-medium">{UPLOAD_STATE.LOCAL_PREVIEW_NOTICE}.</span>{' '}
        <span className="inline-flex items-center gap-1 text-amber-200/90">
          <Loader2 size={12} className="flex-shrink-0 animate-spin" aria-hidden />
          {uploadStateLabel(state)}
          {typeof entry.progress === 'number' && state === UPLOAD_UI_STATE.UPLOADING ? ` ${entry.progress}%` : ''}
        </span>
      </span>
    </div>
  );
}

export default UploadPreviewNotice;
