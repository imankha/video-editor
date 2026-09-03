import { Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * SourceExpiredPanel (T8310)
 *
 * Deliberate "source video expired" state for the reel editors (Focus/Overlay),
 * shown INSTEAD of a broken/hanging <video> when the source game's storage was
 * reclaimed (backend returns a structured 410 `source_expired`). Mirrors the
 * Annotate expired state's visual language (yellow + Clock) so the whole app
 * tells the same truth: the file is gone because storage expired, NOT because the
 * format is unsupported (bug 50p).
 *
 * Presentational: the only side effect is navigating to the storage-management
 * surface when the source is still extendable.
 *
 * @param {boolean} canExtend  Source is still within grace / has a live ref.
 * @param {string} [className]  Layout classes from the mounting video area.
 */
export function SourceExpiredPanel({ canExtend = false, className = '' }) {
  const navigate = useNavigate();
  return (
    <div
      className={`flex items-center justify-center bg-yellow-950/20 ${className}`}
      data-testid="source-expired-panel"
    >
      <div className="text-center max-w-md px-6">
        <Clock size={40} className="mx-auto mb-3 text-yellow-500" />
        <p className="text-yellow-400 font-semibold mb-2">Source video expired</p>
        <p className="text-gray-400 text-sm">
          This game&apos;s source video is no longer available (storage expired),
          so this clip can&apos;t be edited.
          {canExtend
            ? ' Extend its storage to keep editing.'
            : ' Its storage window has passed and it can no longer be recovered.'}
        </p>
        {canExtend && (
          <button
            type="button"
            onClick={() => navigate('/home/games')}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-yellow-600 hover:bg-yellow-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            data-testid="source-expired-extend"
          >
            Extend storage
          </button>
        )}
      </div>
    </div>
  );
}
