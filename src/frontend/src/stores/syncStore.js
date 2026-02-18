/**
 * Sync Status Store (T87)
 *
 * Tracks whether the backend's database sync to R2 has failed.
 * The backend sets X-Sync-Status: failed header on all responses
 * when the user's local DB is out of sync with R2.
 *
 * This store is updated by checkSyncStatus() which should be called
 * after fetch responses in API action modules.
 */

import { create } from 'zustand';
import { API_BASE } from '../config';

export const useSyncStore = create((set, get) => ({
  syncFailed: false,
  isRetrying: false,

  setSyncFailed: (failed) => set({ syncFailed: failed }),

  retrySyncToR2: async () => {
    set({ isRetrying: true });
    try {
      const response = await fetch(`${API_BASE}/api/retry-sync`, {
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
 * Call this after any fetch() to keep the indicator in sync.
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
