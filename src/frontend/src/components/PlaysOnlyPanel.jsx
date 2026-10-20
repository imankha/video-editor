import { ListVideo } from 'lucide-react';
import { PLAYS_ONLY, LIBRARY_ACTIONS } from '../config/displayNames';

/**
 * PlaysOnlyPanel (T12930)
 *
 * Annotate's state for a game kept for its marked plays only: shown INSTEAD of the
 * player so a deep link or stale breadcrumb cannot start marking against a game the
 * user chose to trim. Same structure as the source-expired panel, different copy/icon.
 * The panel IS the state (no redirect); Restore is the way back.
 */
export function PlaysOnlyPanel({ onRestore, className = '' }) {
  return (
    <div className={`flex items-center justify-center bg-yellow-950/20 ${className}`} data-testid="plays-only-panel">
      <div className="text-center max-w-md px-6">
        <ListVideo size={40} className="mx-auto mb-3 text-yellow-500" />
        <p className="text-yellow-400 font-semibold mb-2">{PLAYS_ONLY.PANEL_TITLE}</p>
        <p className="text-gray-400 text-sm">{PLAYS_ONLY.PANEL_BODY}</p>
        {onRestore && (
          <button
            type="button"
            onClick={onRestore}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-yellow-600 hover:bg-yellow-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            {LIBRARY_ACTIONS.RESTORE_FULL_VIDEO}
          </button>
        )}
      </div>
    </div>
  );
}
