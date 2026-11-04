import { Clock } from 'lucide-react';
import { useEditorStore } from '../stores';
import { STORAGE_COPY } from '../config/displayNames';

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
 * Presentational except for the Extend affordance, which navigates to the Games
 * tab (where StorageExtensionModal lives) via the editor store — this app has no
 * react-router; the active home tab is URL state read on mount, so we set both
 * the mode and the `/home/games` path.
 *
 * @param {boolean} canExtend  Source is still within grace / has a live ref.
 * @param {string} [className]  Layout classes from the mounting video area.
 */
export function SourceExpiredPanel({ canExtend = false, className = '' }) {
  const goToGamesToExtend = () => {
    // Navigate home as one atomic transition, then pin the Games tab. The tab is
    // URL state (/home/games), read by ProjectManager on mount — replaceState
    // runs before React re-renders the home screen, so the Games tab is active.
    useEditorStore.getState().goToProjectManager();
    window.history.replaceState({ mode: 'project-manager' }, '', '/home/games');
  };
  return (
    <div
      className={`flex items-center justify-center bg-yellow-950/20 ${className}`}
      data-testid="source-expired-panel"
    >
      <div className="text-center max-w-md px-6">
        <Clock size={40} className="mx-auto mb-3 text-yellow-500" />
        <p className="text-yellow-400 font-semibold mb-2">{STORAGE_COPY.GAME_VIDEO_EXPIRED}</p>
        <p className="text-gray-400 text-sm">
          {STORAGE_COPY.EXPIRED_BODY}
          {canExtend ? STORAGE_COPY.EXPIRED_CAN_EXTEND : STORAGE_COPY.EXPIRED_FOR_GOOD}
        </p>
        <p className="text-gray-500 text-xs mt-2">{STORAGE_COPY.EXPIRED_NOTE}</p>
        {canExtend && (
          <button
            type="button"
            onClick={goToGamesToExtend}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-yellow-600 hover:bg-yellow-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            data-testid="source-expired-extend"
          >
            {STORAGE_COPY.EXTEND}
          </button>
        )}
      </div>
    </div>
  );
}
