import { useEffect, useState } from 'react';
import { WifiOff, CloudOff, AlertTriangle } from 'lucide-react';
import { useSyncStore } from '../stores/syncStore';

// Delay before surfacing so momentary sync states (a sub-second upload-lock
// defer, automatic re-drains, races between an in-flight write and a concurrent
// read) don't flash the UI. If the state clears within this window, nothing
// appears. T5870: alarming on a 500ms defer IS the bug, so this grace guards
// even the 'failed' state (which only arrives after the backend re-drain gives
// up, ~3s later anyway).
const SHOW_DELAY_MS = 3000;

/**
 * SyncStatusIndicator - Shows connection/sync status to the user.
 *
 * Fixed position bottom-right indicator. T5870: three honest states.
 *   - 'pending'  -> quiet "backup pending", no button (backend is still saving).
 *   - 'failed'   -> alarm + Retry (a real failure the re-drain could not heal).
 *   - 'conflict' -> alarm + Retry (backend restores the newer copy; never loops).
 * Auto-hides when sync recovers. Offline auto-retries on reconnect (see syncStore).
 */
export function SyncStatusIndicator() {
  const syncState = useSyncStore(state => state.syncState);
  const isRetrying = useSyncStore(state => state.isRetrying);
  const isOffline = useSyncStore(state => state.isOffline);
  const retrySyncToR2 = useSyncStore(state => state.retrySyncToR2);

  const [visible, setVisible] = useState(false);

  const isAlarm = syncState === 'failed' || syncState === 'conflict';
  const shouldShow = isOffline || syncState !== 'ok';

  useEffect(() => {
    if (!shouldShow) {
      setVisible(false);
      return;
    }
    // Re-arm the grace on every phase change — including a pending -> alarm
    // escalation (isAlarm in the deps). Hiding first means an escalation waits out
    // the delay instead of flashing red under an already-visible quiet banner
    // (round 2 MAJOR-3 defense-in-depth; the backend _SYNC_IN_PROGRESS refcount
    // removes the spurious escalation at its source).
    setVisible(false);
    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shouldShow, isAlarm]);

  if (!visible) return null;

  if (isOffline) {
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg shadow-lg border border-gray-700">
        <WifiOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span>Offline -- your work is saved locally</span>
      </div>
    );
  }

  if (isAlarm) {
    const message =
      syncState === 'conflict'
        ? 'A newer version of your work exists. Retry to load it.'
        : "Some changes didn't reach the cloud.";
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 px-4 py-2 bg-gray-800 text-gray-200 text-sm rounded-lg shadow-lg border border-red-700/60">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
        <div className="flex flex-col">
          <span className="font-medium">Could not save to the cloud</span>
          <span className="text-gray-400 text-xs">{message}</span>
        </div>
        <button
          onClick={retrySyncToR2}
          disabled={isRetrying}
          className="ml-1 px-3 py-1 text-xs font-medium rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex-shrink-0"
        >
          {isRetrying ? 'Retrying...' : 'Retry'}
        </button>
      </div>
    );
  }

  // syncState === 'pending' — quiet, non-alarming, no button.
  return (
    <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg shadow-lg border border-gray-700">
      <CloudOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <span>Cloud backup pending -- your work is saved locally</span>
    </div>
  );
}

export default SyncStatusIndicator;
