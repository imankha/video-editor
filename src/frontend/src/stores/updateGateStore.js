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

// T9310 Gap A: an auto-reload must never land mid-interaction (e.g. scrubbing the
// Focus timeline -- keyframes survive the flush, but playhead/zoom/selection/undo
// are lost across the reload). isQuiescent requires "no pointer or key input for
// ~5s" on top of the export/upload/modal checks. This is gesture-driven tracking,
// NOT a reactive effect: passive capture-phase listeners record only a timestamp,
// touch no store, and persist nothing (CLAUDE.md gesture-based-persistence rule).
// pointermove/touchmove are included so an in-progress drag (a scrub is one long
// pointerdown+move) keeps registering as active, not just its opening pointerdown.
const INPUT_IDLE_MS = 5_000;
let lastInputAt = 0;
if (typeof window !== 'undefined') {
  const markInput = () => { lastInputAt = Date.now(); };
  for (const evt of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove']) {
    window.addEventListener(evt, markInput, { passive: true, capture: true });
  }
}

/** Test-only seam: reset the input-idle timestamp so a case starts genuinely idle. */
export function __resetInputActivityForTest() {
  lastInputAt = 0;
}

// T9310 Gap B: once the gate is up but the app is non-quiescent, nothing in the
// existing cadence re-tests quiescence -- a closed modal, a finished upload, the
// cold-boot guard lapsing, and the input-idle timer (Gap A) crossing 5s are all
// SILENT. Only checkServerVersion re-invokes requireUpdate, and that needs a new
// API response or a tab-switch. So poll quiescence on a short timer while the
// update is pending, resuming the reload the moment the app clears WITHOUT any new
// network traffic. A scheduled check (setInterval), never a reactive effect
// watching state (CLAUDE.md gesture/scheduled-only persistence rule).
const QUIESCENCE_RETRY_MS = 2_000;
let quiescenceRetryTimer = null;
function stopQuiescenceRetry() {
  if (quiescenceRetryTimer !== null) {
    clearInterval(quiescenceRetryTimer);
    quiescenceRetryTimer = null;
  }
}

/** Test-only seam: clear the Gap B retry timer so it can't leak across cases. */
export function __stopQuiescenceRetryForTest() {
  stopQuiescenceRetry();
}

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
    // T9310 Gap A: not quiescent while the user is actively interacting.
    const inputActive = (Date.now() - lastInputAt) < INPUT_IDLE_MS;
    return !exporting && !uploading && !modalOpen && !coldBoot && !inputActive;
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
      if (phase === 'idle') get()._runOrScheduleRetry();
      return;
    }
    set({ isUpdateRequired: true, needsMigration });
    get()._runOrScheduleRetry();
  },

  // T8460/T9310: run the update now if quiescent, otherwise keep the Gap B poll
  // alive so it resumes on the next quiescent tick. Single place that decides
  // "run vs wait", so requireUpdate and the retry timer stay in agreement.
  _runOrScheduleRetry: () => {
    if (get().isQuiescent()) {
      stopQuiescenceRetry();
      get().runUpdate();
    } else {
      get()._scheduleQuiescenceRetry();
    }
  },

  _scheduleQuiescenceRetry: () => {
    if (quiescenceRetryTimer !== null) return; // already polling
    quiescenceRetryTimer = setInterval(() => {
      const { isUpdateRequired, phase } = get();
      // Gate cleared, or already flushing/errored -> stop polling. (A flush error
      // parks on the Retry gesture; Gap B does not auto-retry a failed flush.)
      if (!isUpdateRequired || phase !== 'idle') {
        stopQuiescenceRetry();
        return;
      }
      if (get().isQuiescent()) {
        stopQuiescenceRetry();
        get().runUpdate();
      }
    }, QUIESCENCE_RETRY_MS);
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
