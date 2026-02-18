/**
 * Sync Status Store (T87)
 *
 * Tracks whether the backend's database sync to R2 has failed.
 * The backend sets X-Sync-Status: failed header on all responses
 * when the user's local DB is out of sync with R2.
 *
 * Uses a global fetch interceptor installed at import time so every API
 * response is automatically checked — no per-call-site instrumentation needed.
 */

import { create } from 'zustand';
import { API_BASE } from '../config';

export const useSyncStore = create((set) => ({
  syncFailed: false,
  isRetrying: false,

  setSyncFailed: (failed) => set({ syncFailed: failed }),

  retrySyncToR2: async () => {
    set({ isRetrying: true });
    try {
      const response = await _originalFetch(`${API_BASE}/api/retry-sync`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        set({ syncFailed: false });
      }
      return data.success;
    } catch {
      return false;
    } finally {
      set({ isRetrying: false });
    }
  },
}));

/**
 * Check the X-Sync-Status header on a fetch Response and update the sync store.
 *
 * @param {Response} response - The fetch Response object
 */
export function checkSyncStatus(response) {
  if (!response || !response.headers) return;

  const syncStatus = response.headers.get('X-Sync-Status');
  const store = useSyncStore.getState();

  if (syncStatus === 'failed') {
    if (!store.syncFailed) {
      store.setSyncFailed(true);
    }
  } else {
    if (store.syncFailed) {
      store.setSyncFailed(false);
    }
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
