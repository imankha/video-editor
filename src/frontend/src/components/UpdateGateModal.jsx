import { RefreshCw } from 'lucide-react';
import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * UpdateGateModal — blocking, non-dismissible update gate (T5070).
 *
 * Reuses AuthGateModal's full-screen layout but drops every dismiss
 * affordance (no X, no backdrop-close, no ESC) per project rule: an
 * un-updated client must not be able to log in or interact until it
 * refreshes onto the latest version. Mounted ABOVE AuthGateModal in
 * main.jsx (z-[60] > z-50) so it blocks the login surface too.
 *
 * Fires via useUpdateGateStore.requireUpdate(), called from pwaUpdate.js on
 * onNeedRefresh (waiting SW) and on a detected backend-version mismatch.
 */
export function UpdateGateModal() {
  const isUpdateRequired = useUpdateGateStore((s) => s.isUpdateRequired);
  const phase = useUpdateGateStore((s) => s.phase);
  const error = useUpdateGateStore((s) => s.error);
  const runUpdate = useUpdateGateStore((s) => s.runUpdate);

  if (!isUpdateRequired) return null;

  const isFlushing = phase === 'flushing';

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-gate-title"
    >
      <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full mx-4">
        <div className="p-6 space-y-6 text-center">
          <div className="flex justify-center">
            <RefreshCw
              size={32}
              className={`text-purple-400 ${isFlushing ? 'animate-spin' : ''}`}
            />
          </div>

          <div>
            <h2 id="update-gate-title" className="text-lg font-semibold text-white">
              A new version is ready
            </h2>
            <p className="text-sm text-gray-300 mt-2">
              We need to update before you continue. Your work is saved automatically.
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={runUpdate}
            disabled={isFlushing}
            className="w-full py-2.5 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {isFlushing ? 'Saving your work...' : error ? 'Try again' : 'Update now'}
          </button>
        </div>
      </div>
    </div>
  );
}
