import { AlertTriangle, Gamepad2 } from 'lucide-react';
import { Button } from './shared/Button';
import { CLIP_UPLOAD } from '../config/displayNames';

/**
 * T10250: the over-cap pre-flight dialog. A clip picked above the server cap
 * (configStore.maxClipUploadBytes) never enters the hash/upload pipeline — this
 * dialog is shown INSTEAD, before any hashing or network call. It is a
 * non-retryable condition (the file will always be too large), so there is no
 * Retry: the single primary action carries the same file(s) into the Add Game
 * flow, which has no clip size cap.
 *
 * `maxBytes` comes from the server (no `500` literal); the body sentence mirrors
 * the backend refusal in games_upload.py so the two never drift. Reuses
 * ClipUploadNoticeModal's caution shell (yellow AlertTriangle header).
 */
export function ClipSizeLimitModal({ isOpen, files = [], maxBytes, onAddGame, onCancel }) {
  if (!isOpen) return null;

  const mb = maxBytes ? Math.round(maxBytes / (1024 * 1024)) : null;
  const names = files.map((f) => f.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clip-size-limit-title"
        data-testid="clip-size-limit-modal"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700"
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-700">
          <div className="p-2 bg-yellow-600/20 rounded-lg shrink-0">
            <AlertTriangle size={20} className="text-yellow-400" />
          </div>
          <h2 id="clip-size-limit-title" className="text-lg font-semibold text-white mt-1">
            {CLIP_UPLOAD.SIZE_LIMIT_TITLE}
          </h2>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-300 leading-relaxed" data-testid="clip-size-limit-body">
            {mb ? CLIP_UPLOAD.sizeLimitBody(mb) : CLIP_UPLOAD.SIZE_LIMIT_TITLE}
          </p>
          {names.length > 0 && (
            <ul className="text-xs text-gray-400 space-y-1">
              {names.map((name) => (
                <li key={name} className="truncate">{name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {CLIP_UPLOAD.SIZE_LIMIT_CANCEL}
          </Button>
          <Button variant="success" size="md" icon={Gamepad2} onClick={onAddGame}>
            {CLIP_UPLOAD.SIZE_LIMIT_ADD_GAME}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ClipSizeLimitModal;
