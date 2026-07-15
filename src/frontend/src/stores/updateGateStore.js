import { create } from 'zustand';
import { flushDurableState } from '../utils/updateFlush';

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
   */
  runUpdate: async () => {
    if (get().phase === 'flushing') return;
    set({ phase: 'flushing', error: null });
    try {
      await flushDurableState();
    } catch (e) {
      set({ phase: 'error', error: e?.message || 'Could not save your latest changes.' });
      return;
    }

    const updateSW = get()._updateSW;
    if (updateSW) {
      // Triggers skipWaiting on the waiting SW; its own 'controlling' listener
      // reloads the page. No waiting SW (version-mismatch-only case) -> no-op.
      await updateSW(true);
    }
    // Always force the reload as the terminal step -- covers version-mismatch
    // (no waiting SW, so updateSW(true) alone never reloads) and is a safe
    // no-op if the SW's own reload already fired first.
    window.location.reload();
  },
}));
