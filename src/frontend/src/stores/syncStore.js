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
import { toast } from '../components/shared/Toast';

// A conflict Retry that RESTORES R2's newer copy has replaced the user's local
// edit on disk. We must tell them and reload (so the in-memory UI matches the
// restored DB) — but the reload wipes any live toast, so the notice is stashed
// here and surfaced on the next load (surfaceRestoredNoticeIfPending, below).
const RESTORED_NOTICE_KEY = 't5870_restored_notice';

function stashRestoredNotice() {
  try {
    sessionStorage.setItem(RESTORED_NOTICE_KEY, '1');
  } catch {
    /* sessionStorage unavailable — the toast still fires if we reach it live */
  }
}

// Indirected so tests can assert the reload without navigating jsdom.
export function reloadPage() {
  window.location.reload();
}

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
      if (data.restored) {
        // BLOCKING (round 2): the conflict was resolved by REPLACING the local
        // edit with a newer copy from R2 — the user's unsynced change is gone from
        // disk. NEVER silently flip to 'ok' (the browser still renders the discarded
        // edit, and the next gesture would write into a DB that no longer has it).
        // Tell the user and reload so in-memory state matches the restored DB.
        stashRestoredNotice();
        reloadPage();
        return true;
      }
      if (data.success) {
        // A plain transient recovery. The next response's header confirms 'ok' too.
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

/**
 * Surface the "your local changes were replaced" notice if a conflict-restore
 * reload just happened. Called once at module load (post-reload). Persistent
 * (duration 0) so the user cannot miss that work was superseded.
 */
export function surfaceRestoredNoticeIfPending() {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    if (!sessionStorage.getItem(RESTORED_NOTICE_KEY)) return false;
    sessionStorage.removeItem(RESTORED_NOTICE_KEY);
  } catch {
    return false;
  }
  toast.error('Your local changes were replaced', {
    message:
      'A newer version of your work, saved on another device, replaced your unsynced edits.',
    duration: 0,
    dedupKey: 'sync-conflict-restored',
  });
  return true;
}

surfaceRestoredNoticeIfPending();

// Listen for browser online/offline events. Coming back online with a genuine
// failure (failed/conflict) auto-retries. 'pending' is left to the backend
// re-drain — it is not a failure and needs no client action.
// round 2 MINOR-2 (intended): a DURABLE-path failure surfaces via its own 503
// gesture UX (overlay/clip/publish toasts with their own Retry) and leaves only
// .sync_pending on surface A (quiet 'pending'), so it is deliberately NOT part of
// this reconnect auto-retry — the owning gesture is the single retry trigger.
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
