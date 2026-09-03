import { create } from 'zustand';
import { flushDurableState } from '../utils/updateFlush';
import { useAuthStore } from './authStore';
import { isAnyModalOpen } from '../utils/modalOcclusion';

// T8460: exportStore/uploadStore are resolved via dynamic import, NOT a static
// top-level one. updateGateStore.js is reached very early in the app's load
// order (appVersion.js pulls it in at session-init, before the rest of the app
// boots), while exportStore/uploadStore sit at the head of a much heavier,
// later-loading module graph (uploadManager -> gamesDataStore -> projectsStore
// -> authStore, per Vite's own dynamic/static import-split warnings on that
// chain). A static import here folds that whole graph into the early path and
// produces a circular-init crash in the PRODUCTION bundle only ("Cannot access
// 'x' before initialization" -- a Rollup module-eval-order TDZ the dev
// server's on-demand ESM loading never exposes; found via T6230's real-build
// fixture). Kicked off once; isQuiescent() stays a synchronous plain-state
// read -- if the modules haven't resolved yet, those subsystems can't
// possibly be mid-export/mid-upload either, so "not yet loaded" correctly
// reads as "not confirmed clear" (non-quiescent).
let exportStoreModule = null;
let uploadStoreModule = null;
import('./exportStore').then((m) => { exportStoreModule = m; });
import('./uploadStore').then((m) => { uploadStoreModule = m; });

/**
 * T5070 / Tbug40p / Tbug41s / T8460 — owns the update-gate's state.
 * UpdateGateModal is a pure View reading this store (a passive progress card,
 * not a blocking gate as of T8460); the gate is raised by
 * appVersion.checkServerVersion, observed via sessionInit.js's header check and
 * pwaUpdate.js's resume poll. Tbug41s: that check now requires BOTH
 * serverBuild > clientBuild AND a confirmed waiting bundle — a newer server alone
 * can be true forever when the backend deploys without the frontend, which made
 * the old "never auto-closes" modal unescapable.
 *
 * The update itself never auto-cancels once required -- the only exit is a
 * successful reload onto the new bundle (a fresh bundle boots with a higher
 * __APP_BUILD__, so checkServerVersion no longer fires).
 */

// T8460 first-session guard: never auto-run within the first 30s of a cold,
// unauthenticated boot. The dangerous window (Add Game modal about to open,
// an upload about to start) is otherwise already covered by isQuiescent's
// modalOpen/uploading checks below -- this is a deliberately dumb extra
// margin for the brand-new-user moment, not a general debounce.
const COLD_BOOT_AT = Date.now();
const FIRST_SESSION_GUARD_MS = 30_000;

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

  // T8460: an update may only auto-run while the app is quiescent. Checked at
  // trigger time (plain state reads, NOT a reactive effect).
  isQuiescent: () => {
    if (!exportStoreModule || !uploadStoreModule) return false;
    const exporting = Object.keys(exportStoreModule.useExportStore.getState().activeExports || {}).length > 0;
    const uploading = uploadStoreModule.useUploadStore.getState().isUploading();
    const modalOpen = isAnyModalOpen();
    const coldBoot = !useAuthStore.getState().isAuthenticated &&
      (Date.now() - COLD_BOOT_AT) < FIRST_SESSION_GUARD_MS;
    return !exporting && !uploading && !modalOpen && !coldBoot;
  },

  requireUpdate: ({ needsMigration = false } = {}) => {
    const { isUpdateRequired, needsMigration: current, phase } = get();
    if (isUpdateRequired) {
      // First fire wins the flag; only escalate if a later signal upgrades an
      // app-code reload into a data migration.
      if (needsMigration && !current) set({ needsMigration: true });
      // T8460: no click to wait on -- every subsequent requireUpdate() call
      // (fired by the existing re-check cadence: API responses, visibilitychange)
      // re-tests quiescence and runs once conditions clear.
      if (phase === 'idle' && get().isQuiescent()) {
        get().runUpdate();
      }
      return;
    }
    set({ isUpdateRequired: true, needsMigration });
    if (get().isQuiescent()) {
      get().runUpdate();
    }
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
