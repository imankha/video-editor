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

  // Set once by pwaUpdate.js right after registerSW() returns. updateSW(true)
  // messages a WAITING service worker to skipWaiting; workbox guards it as a
  // no-op when nothing is waiting (verified: Workbox.messageSkipWaiting checks
  // registration.waiting) -- but a no-op ALSO does not reload, so runUpdate must
  // know whether a SW is actually waiting before choosing skipWaiting vs reload.
  _updateSW: null,
  setUpdateSW: (fn) => set({ _updateSW: fn }),

  // A live probe (set by pwaUpdate.js) that asks the ServiceWorkerRegistration
  // directly whether a new bundle is waiting to activate -- reuses the same
  // registration?.waiting signal pwaUpdate's onReturnToApp already trusts. This
  // is the race-free replacement for inferring "is a SW waiting?" from `reason`
  // (T5930): the version-mismatch poll can latch the gate BEFORE onNeedRefresh
  // fires, leaving reason='version-mismatch' while a bundle is in fact waiting.
  _waitingProbe: null,
  setWaitingProbe: (fn) => set({ _waitingProbe: fn }),

  requireUpdate: (reason) => {
    const { isUpdateRequired, reason: current } = get();
    // Normally idempotent — the first reason to fire wins. The ONE exception:
    // a waiting service worker ('sw') supersedes a bare 'version-mismatch', so
    // the modal's reason reflects the strongest signal seen. bug39 symptom 2
    // ("do it twice"): the aggressive version-mismatch check (first API response)
    // can beat the freshly-installing SW's onNeedRefresh, latching reason
    // 'version-mismatch' even though a new bundle is waiting.
    //
    // T5930: this reason upgrade is NO LONGER the thing that makes runUpdate
    // skipWaiting — that decision now reads the live waiting probe
    // (registration?.waiting), so a click BEFORE onNeedRefresh fires (the race
    // this upgrade used to depend on) still activates the waiting bundle in one
    // step. The upgrade is kept only so `reason` is accurate; it is not
    // load-bearing for landing the update.
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

    // Decide by the ACTUAL waiting SW, not by which requireUpdate reason won the
    // race (T5930). If a bundle is waiting, skipWaiting lands it in ONE step;
    // reason='sw' is the already-confirmed-waiting case, and the waiting probe
    // catches a gate that latched 'version-mismatch' before onNeedRefresh fired
    // yet nonetheless has a bundle waiting. A bare reload in that raced case
    // leaves the old SW in control re-serving the old bundle -- the stranded SW
    // then fires onNeedRefresh and a SECOND gate. Ask the registration directly.
    const { reason, _updateSW: updateSW, _waitingProbe: waitingProbe } = get();
    if (updateSW && (reason === 'sw' || waitingProbe?.())) {
      // A real waiting SW exists; skipWaiting's 'controlling' listener
      // (workbox-window) performs the reload itself -- don't also force one
      // here, which would race a double reload.
      await updateSW(true);
      return;
    }
    // No waiting SW (a backend-only deploy) -- nothing else will reload on its own.
    window.location.reload();
  },
}));
