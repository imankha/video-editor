import { create } from 'zustand';
import { flushDurableState } from '../utils/updateFlush';
import { acknowledgeAppVersion } from '../utils/appVersion';
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
    const { isUpdateRequired, reason: current } = get();
    // Normally idempotent — the first reason to fire wins. The ONE exception:
    // a waiting service worker ('sw') supersedes a bare 'version-mismatch'.
    // bug39 symptom 2 ("do it twice"): the aggressive version-mismatch check
    // (first API response) beats the freshly-installing SW's onNeedRefresh, so
    // the gate latched reason 'version-mismatch' even though a new bundle was
    // waiting. runUpdate's version-mismatch branch does window.location.reload(),
    // which does NOT skipWaiting the waiting SW — so the old SW re-serves the
    // old bundle and the update only lands on the SECOND try. Letting 'sw'
    // upgrade the reason routes runUpdate through updateSW(true) (skipWaiting)
    // so a SINGLE update activates the new bundle. By the time the user reads
    // the modal and clicks, onNeedRefresh has fired, so the upgrade is in place.
    if (isUpdateRequired && !(reason === 'sw' && current === 'version-mismatch')) {
      return;
    }
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

    // Record the build we are reloading onto BEFORE the reload/activation, so a
    // post-reload boot that latches an older mixed-fleet sha does not re-gate
    // for this already-accepted version (bug39 symptoms 1 & 3). This write is
    // part of the "Update now" gesture, not a reactive effect.
    acknowledgeAppVersion();

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
