import { RefreshCw, AlertTriangle } from 'lucide-react';
import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * UpdateGateModal — passive, non-blocking update progress card (T8460).
 *
 * The update itself now runs automatically (updateGateStore.requireUpdate ->
 * isQuiescent -> runUpdate) with no click gate. This component is a pure
 * View of that store: it renders NOTHING while idle, and a small bottom-right
 * corner card (visual language borrowed from GlobalExportIndicator) only
 * while phase is 'flushing' or 'error'. It never covers the rest of the UI --
 * there is no backdrop, no fixed inset-0, no role=alertdialog. Add Game and
 * every other control stay tappable underneath it at all times.
 *
 * The error state's "Retry" button is the ONE remaining interactive surface,
 * and it re-invokes the same runUpdate() gesture -- it never blocks the app
 * behind it while waiting.
 */
export function UpdateGateModal() {
  const phase = useUpdateGateStore((s) => s.phase);
  const error = useUpdateGateStore((s) => s.error);
  const runUpdate = useUpdateGateStore((s) => s.runUpdate);

  if (phase === 'idle') return null;

  const isFlushing = phase === 'flushing';

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72" data-testid="update-progress-card">
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl px-4 py-3">
        <div className="flex items-center gap-3">
          {isFlushing ? (
            <RefreshCw size={18} className="text-purple-400 animate-spin shrink-0" />
          ) : (
            <AlertTriangle size={18} className="text-amber-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white">
              {isFlushing ? 'Updating to the latest version...' : 'Update paused'}
            </div>
            {!isFlushing && (
              <div className="text-xs text-gray-400 mt-0.5">
                Could not save your latest changes.
              </div>
            )}
          </div>
        </div>

        {error && !isFlushing && (
          <button
            onClick={runUpdate}
            className="mt-3 w-full py-1.5 px-3 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
