import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../stores/syncStore';

// Delay before surfacing so momentary sync-failed states
// (automatic retries, races between an in-flight write and a concurrent
// read) don't flash the UI. If the flag clears within this window, the
// indicator never appears.
const SHOW_DELAY_MS = 3000;

/**
 * SyncStatusIndicator - Shows connection/sync status to the user.
 *
 * Fixed position bottom-right indicator. Informational only — no button.
 * Sync retries automatically when internet comes back online (see syncStore).
 * Auto-hides when sync succeeds.
 */
export function SyncStatusIndicator() {
  const syncFailed = useSyncStore(state => state.syncFailed);
  const isRetrying = useSyncStore(state => state.isRetrying);
  const isOffline = useSyncStore(state => state.isOffline);

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!syncFailed && !isOffline) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [syncFailed, isOffline]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg shadow-lg">
      {isRetrying ? (
        <>
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Syncing...</span>
        </>
      ) : isOffline ? (
        <>
          <WifiOff className="w-4 h-4" />
          <span>No internet connection</span>
        </>
      ) : (
        <>
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Reconnecting...</span>
        </>
      )}
    </div>
  );
}

export default SyncStatusIndicator;
