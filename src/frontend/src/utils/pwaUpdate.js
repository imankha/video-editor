import { registerSW } from 'virtual:pwa-register';
import { API_BASE } from '../config';
import { useUpdateGateStore } from '../stores/updateGateStore';

// Long-lived installed PWAs never hit a "next load", and browsers throttle or
// freeze background timers, so the re-check rides visibilitychange instead of
// an interval: returning to the app is exactly the moment to check (T4150).
const UPDATE_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * T5070: In-session PWA update, now a blocking gate instead of a dismissible
 * toast (T4150). vite.config.js uses registerType 'prompt', so a new build
 * sits in the waiting SW until useUpdateGateStore.runUpdate() calls
 * updateSW(true) from the gate's "Update now" click.
 *
 * Also raises the gate on a backend-version mismatch (GET /api/version),
 * reusing this same visibilitychange throttle -- closes the gap where a
 * backend-only deploy produces no new service worker and so never fired
 * the old toast.
 */
export function setupPwaUpdatePrompt() {
  let lastCheckAt = 0;
  // Populated by onRegisteredSW IF/WHEN it fires. The version-mismatch check
  // below must not depend on it firing at all — a dev server (no real SW
  // build) or a slow/failed registration must not silently disable the
  // backend-version handshake (that was the Scenario-B bug: the poll lived
  // inside onRegisteredSW and so never wired without a real waiting SW).
  let registration = null;

  const updateSW = registerSW({
    onNeedRefresh() {
      useUpdateGateStore.getState().requireUpdate('sw');
    },
    onRegisteredSW(_swUrl, reg) {
      registration = reg || null;
    },
  });

  useUpdateGateStore.getState().setUpdateSW(updateSW);
  // Let runUpdate ask, at click time, whether a bundle is actually waiting --
  // the same registration?.waiting signal onReturnToApp trusts below. This is
  // read live (the closure captures the variable, not its value), so it sees a
  // SW that started waiting AFTER setup. Without it, a gate that fired for a
  // backend version-mismatch before onNeedRefresh landed would bare-reload and
  // strand the waiting SW into a second gate (T5930).
  useUpdateGateStore.getState().setWaitingProbe(() => !!registration?.waiting);

  // Returning to the app is the moment to re-check. Shared by visibilitychange
  // (tab switch / wake from sleep) and pageshow (Safari bfcache restore).
  function onReturnToApp() {
    if (registration?.waiting) {
      // An update is already waiting (e.g. the gate hasn't been actioned
      // yet) — re-require instead of fetching sw.js again. 'sw' upgrades a
      // prior 'version-mismatch' gate so runUpdate takes the skipWaiting path
      // (bug39 symptom 2), not a plain reload that strands the waiting SW.
      useUpdateGateStore.getState().requireUpdate('sw');
      return;
    }
    const now = Date.now();
    if (now - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
    lastCheckAt = now;
    // Rejection here just means the check couldn't reach the server
    // (offline/flaky network) — the next return to the app retries.
    registration?.update().catch(() => {});
    checkBackendVersion();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    onReturnToApp();
  });

  // Safari (the bug39 reporter's browser) restores a backgrounded page from
  // bfcache on back/forward WITHOUT a fresh load and, for a bfcache restore,
  // may fire ONLY pageshow(persisted=true) — not visibilitychange. Run the same
  // return-to-app check so a bfcache restore behaves like any other resume: it
  // re-verifies against the (persisted) boot/acknowledged version and so does
  // NOT re-gate an already-current build (bug39 symptom 3). A non-persisted
  // pageshow is a normal fresh load, already handled by the on-load check.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) onReturnToApp();
  });

  // On-load check: the passive header check (sessionInit.js) only latches a
  // boot version once SOME API request resolves, which may be a while for an
  // idle/pre-login screen. Firing one here promptly establishes the baseline
  // (and, on an already-stale reload, detects a drift immediately).
  checkBackendVersion();

  function checkBackendVersion() {
    // A plain fetch() to an /api path already goes through the sessionInit.js
    // interceptor, whose response handler reads X-App-Version — no separate
    // comparison call needed here.
    fetch(`${API_BASE}/api/version`).catch(() => {});
  }
}
