import { UploadCloud } from 'lucide-react';
import { STORAGE_COPY } from '../config/displayNames';

/**
 * SourceUploadingPanel (T15730)
 *
 * Deliberate "source game still uploading" state for the reel editors
 * (Focus/Overlay), shown INSTEAD of a broken/hanging <video> when the clip's
 * source game hasn't finished uploading yet (backend returns a structured 409
 * `source_uploading`). Mirrors SourceExpiredPanel's visual language so the app
 * tells the same truth: the file isn't there YET, not that the format is
 * unsupported (bug 50p).
 *
 * Presentational only -- there is nothing to do but wait, unlike
 * SourceExpiredPanel's Extend affordance.
 *
 * @param {string} [className]  Layout classes from the mounting video area.
 */
export function SourceUploadingPanel({ className = '' }) {
  return (
    <div
      className={`flex items-center justify-center bg-yellow-950/20 ${className}`}
      data-testid="source-uploading-panel"
    >
      <div className="text-center max-w-md px-6">
        <UploadCloud size={40} className="mx-auto mb-3 text-yellow-500" />
        <p className="text-yellow-400 font-semibold mb-2">{STORAGE_COPY.GAME_VIDEO_UPLOADING}</p>
        <p className="text-gray-400 text-sm">{STORAGE_COPY.UPLOADING_BODY}</p>
        <p className="text-gray-500 text-xs mt-2">{STORAGE_COPY.UPLOADING_NOTE}</p>
      </div>
    </div>
  );
}
