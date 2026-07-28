import { create } from 'zustand';
import { flushDurableState } from '../utils/updateFlush';
import { useAuthStore } from './authStore';

/**
 * T5070 / Tbug40p — owns the blocking update-gate's state. UpdateGateModal is a
 * pure View reading this store; the gate is now raised SOLELY by the truth
 * comparison (appVersion.checkServerVersion: serverBuild > clientBuild), observed
 * via sessionInit.js's header check and pwaUpdate.js's resume poll.
 *
 * The gate never auto-closes once required -- the only exit is a successful
 * reload onto the new bundle (a fresh bundle boots with a higher __APP_BUILD__,
 * so checkServerVersion no longer fires).
 */
export const useUpdateGateStore = create((set, get) => ({
  isUpdateRequired: false,
  // Tbug40p decision #3 (seam only): true would route runUpdate through the heavy
  // data-schema sync→lock→migrate→reboot path. Today every app-code bump is a
  // clean reload, so this stays false until a real schema-advancing deploy wires
  // the X-Data-Schema comparison in checkServerVersion.
  needsMigration: false,
  phase: 'idle', // 'idle' | 'flushing' | 'error'
  error: null,

  // Set once by pwaUpdate.js: an async () => Promise that lands the newest bundle
  // (registration.update → skipWaiting-if-waiting → bust stale SW + reload). All
  // ServiceWorker mechanics live in pwaUpdate.js (which owns the registration);
  // the store just awaits this after the durable-state flush. Objective 2.
  _swReloader: null,
  setSwReloader: (fn) => set({ _swReloader: fn }),

  requireUpdate: ({ needsMigration = false } = {}) => {
    const { isUpdateRequired, needsMigration: current } = get();
    if (isUpdateRequired) {
      // The gate is a blocking modal; the first fire wins. Only escalate if a
      // later signal upgrades an app-code reload into a data migration.
      if (needsMigration && !current) set({ needsMigration: true });
      return;
    }
    set({ isUpdateRequired: true, needsMigration });
  },

  /**
   * The "Update now" gesture. Barriered: the reload only runs after
   * flushDurableState() resolves. On failure the gate stays up with an error,
   * never reloads with unsynced state.
   *
   * A logged-out user (gate firing on the login screen, or a session that
   * expired) has no per-user durable state to flush -- skip the barrier entirely
   * rather than let flush-verify's 401 read as a failure and strand the gate.
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

    // Tbug40p decision #1 & #3: "log in cleanly on the new version" = a clean
    // in-memory reboot (session cookie preserved) — the reload re-runs session-init
    // from R2 and rebuilds all store/hook state from the canonical server copy. The
    // heavy data-schema path (needsMigration) is a seam that today routes to the
    // same clean reload; a future schema-advancing deploy wires sync→lock→migrate
    // here before the reload.
    const reloader = get()._swReloader;
    if (reloader) {
      await reloader();
    } else {
      // No SW reloader wired (e.g. setup hasn't run) — a plain reload still lands a
      // backend-only bump; there is no waiting bundle to strand.
      window.location.reload();
    }
  },
}));
