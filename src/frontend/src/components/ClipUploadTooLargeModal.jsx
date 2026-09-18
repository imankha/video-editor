import { AlertTriangle } from 'lucide-react';
import { Button } from './shared/Button';
import { CLIP_UPLOAD } from '../config/displayNames';

/**
 * T10310: a clip that lands as a REFUSED over-cap failure only after an upload
 * attempt (the pre-flight ClipSizeLimitModal gate is skipped while
 * configStore.maxClipUploadBytes hasn't hydrated yet). The rail still carries the
 * failed row + reason, but this popup makes the refusal impossible to miss and
 * spells out the click-path to recover (Games -> Upload game) since there is no
 * File left in hand to auto-carry into Add Game the way the pre-flight dialog does.
 *
 * `maxBytes` comes from the server, same as ClipSizeLimitModal — no `500` literal.
 */
export function ClipUploadTooLargeModal({ isOpen, names = [], maxBytes, onDismiss }) {
  if (!isOpen) return null;

  const mb = maxBytes ? Math.round(maxBytes / (1024 * 1024)) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clip-upload-too-large-title"
        data-testid="clip-upload-too-large-modal"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700"
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-700">
          <div className="p-2 bg-yellow-600/20 rounded-lg shrink-0">
            <AlertTriangle size={20} className="text-yellow-400" />
          </div>
          <h2 id="clip-upload-too-large-title" className="text-lg font-semibold text-white mt-1">
            {CLIP_UPLOAD.POST_UPLOAD_TOO_LARGE_TITLE}
          </h2>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-300 leading-relaxed" data-testid="clip-upload-too-large-body">
            {mb ? CLIP_UPLOAD.postUploadTooLargeBody(mb) : CLIP_UPLOAD.POST_UPLOAD_TOO_LARGE_TITLE}
          </p>
          {names.length > 0 && (
            <ul className="text-xs text-gray-400 space-y-1">
              {names.map((name) => (
                <li key={name} className="truncate">{name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end">
          <Button variant="secondary" size="md" onClick={onDismiss}>
            {CLIP_UPLOAD.POST_UPLOAD_TOO_LARGE_DISMISS}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ClipUploadTooLargeModal;
