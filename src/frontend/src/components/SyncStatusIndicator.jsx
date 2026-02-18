import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../stores/syncStore';

/**
 * SyncStatusIndicator - Shows a warning when database sync to R2 has failed.
 *
 * Fixed position bottom-right indicator. Visible but non-blocking.
 * Clicking triggers a manual retry via POST /api/retry-sync.
 *
 * Auto-hides when sync succeeds (either from auto-retry on next write
 * or manual retry via this button).
 */
export function SyncStatusIndicator() {
  const syncFailed = useSyncStore(state => state.syncFailed);
  const isRetrying = useSyncStore(state => state.isRetrying);
  const retrySyncToR2 = useSyncStore(state => state.retrySyncToR2);

  if (!syncFailed) return null;

  return (
    <button
      onClick={retrySyncToR2}
      disabled={isRetrying}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-lg shadow-lg transition-colors disabled:opacity-60"
    >
      {isRetrying ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : (
        <AlertTriangle className="w-4 h-4" />
      )}
      {isRetrying ? 'Syncing...' : 'Sync failed \u2014 click to retry'}
    </button>
  );
}

export default SyncStatusIndicator;
