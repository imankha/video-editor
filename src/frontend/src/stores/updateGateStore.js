import { create } from 'zustand';
import { flushDurableState } from '../utils/updateFlush';
import { useAuthStore } from './authStore';

/**
 * T5070 — owns the blocking update-gate's state. UpdateGateModal is a pure
 * View reading this store; pwaUpdate.js (onNeedRefresh + version-mismatch
 * poll) is the only caller of requireUpdate/setUpdateSW.
 *
 * The gate never auto-closes once required -- the only exit is a successful
 * reload onto the new version (a fresh bundle boots with isUpdateRequired
 * false again).
 */
export const useUpdateGateStore = create((set, get) => ({
  isUpdateRequired: false,
  reason: null, // 'sw' | 'version-mismatch'
  phase: 'idle', // 'idle' | 'flushing' | 'error'
  error: null,

  // Set once by pwaUpdate.js right after registerSW() returns. Idempotent
  // no-op when nothing is waiting (see runUpdate) -- the version-mismatch
  // case has no waiting SW, so this may remain null.
  _updateSW: null,
  setUpdateSW: (fn) => set({ _updateSW: fn }),

  requireUpdate: (reason) => {
    if (get().isUpdateRequired) return;
    set({ isUpdateRequired: true, reason });
  },

  /**
   * The "Update now" gesture. Barriered: the destructive cache flush + reload
   * only run after flushDurableState() resolves. On failure the gate stays up
   * with an error, never skipWaiting/reloads with unsynced state.
   *
   * A logged-out user (gate firing on the login screen, or a session that
   * expired) has no per-user durable state to flush at all -- skip the
   * barrier entirely rather than let flush-verify's 401 read as a failure
   * and strand the gate with no way forward (every deploy would otherwise
   * permanently lock out anyone not authenticated).
   */
  runUpdate: async () => {
    if (get().phase === 'flushing') return;
    set({ phase: 'flushing', error: null });

    if (useAuthStore.getState().isAuthenticated) {
      try {
        await flushDurableState();
      } catch (e) {
        set({ phase: 'error', error: e?.message || 'Could not save your latest changes.' });
        return;
      }
    }

    const { reason, _updateSW: updateSW } = get();
    if (reason === 'sw' && updateSW) {
      // A real waiting SW exists; skipWaiting's 'controlling' listener
      // (workbox-window) performs the reload itself -- don't also force one
      // here, which would race a double reload.
      await updateSW(true);
      return;
    }
    // version-mismatch (no waiting SW) -- nothing else will reload on its own.
    window.location.reload();
  },
}));
