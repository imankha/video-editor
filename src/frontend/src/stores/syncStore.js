/**
 * Sync Status Store (T87, T5870)
 *
 * Tracks the backend's R2 sync state, surfaced via the `X-Sync-Status` response
 * header. A global fetch interceptor (installed at import time) checks every
 * response, so no per-call-site instrumentation is needed.
 *
 * T5870: THREE honest states, not the old "any pending == failed" boolean:
 *   'ok'       — nothing to show.
 *   'pending'  — a write is queued/deferred and the backend is still delivering
 *                it (bounded re-drain). QUIET "backup pending", NEVER "not saving".
 *   'failed'   — a real R2 failure the re-drain could not heal. Alarm + Retry.
 *   'conflict' — a CAS refusal (T4310). Alarm + Retry-that-restores (the backend
 *                pulls the newer R2 copy; a blind retry would loop forever).
 */

import { create } from 'zustand';
import { API_BASE } from '../config';

export const useSyncStore = create((set, get) => ({
  syncState: 'ok', // 'ok' | 'pending' | 'failed' | 'conflict'
  isRetrying: false,
  isOffline: !navigator.onLine,

  setSyncState: (state) => set({ syncState: state }),
  setOffline: (offline) => set({ isOffline: offline }),

  retrySyncToR2: async () => {
    if (get().isRetrying) return false;
    set({ isRetrying: true });
    try {
      const response = await _originalFetch(`${API_BASE}/api/retry-sync`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        // Cleared on the backend (a plain success or a conflict resolved via
        // restore-if-newer). The next response's header confirms 'ok' too.
        set({ syncState: 'ok' });
      }
      return data.success;
    } catch {
      return false;
    } finally {
      set({ isRetrying: false });
    }
  },
}));

// Listen for browser online/offline events. Coming back online with a genuine
// failure (failed/conflict) auto-retries. 'pending' is left to the backend
// re-drain — it is not a failure and needs no client action.
window.addEventListener('offline', () => {
  useSyncStore.getState().setOffline(true);
});

window.addEventListener('online', () => {
  const store = useSyncStore.getState();
  store.setOffline(false);
  if (store.syncState === 'failed' || store.syncState === 'conflict') {
    store.retrySyncToR2();
  }
});

/**
 * Map the X-Sync-Status header onto the store's syncState.
 *
 * @param {Response} response - The fetch Response object
 */
export function checkSyncStatus(response) {
  if (!response || !response.headers) return;

  const header = response.headers.get('X-Sync-Status');
  const next =
    header === 'pending' || header === 'failed' || header === 'conflict'
      ? header
      : 'ok';

  const store = useSyncStore.getState();
  if (store.syncState !== next) {
    store.setSyncState(next);
  }
}

// --- Global fetch interceptor ---
// Wraps window.fetch so every response is automatically checked for the
// X-Sync-Status header. This is infrastructure-level: no individual API
// call sites need to know about sync status.

const _originalFetch = window.fetch.bind(window);

window.fetch = async function (...args) {
  const response = await _originalFetch(...args);
  checkSyncStatus(response);
  return response;
};
