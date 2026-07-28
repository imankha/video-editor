import { registerSW } from 'virtual:pwa-register';
import { API_BASE } from '../config';
import { useUpdateGateStore } from '../stores/updateGateStore';

// Long-lived installed PWAs never hit a "next load", and browsers throttle or
// freeze background timers, so the re-check rides visibilitychange instead of
// an interval: returning to the app is exactly the moment to check (T4150).
const UPDATE_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

// Tbug40p: after asking a waiting SW to skipWaiting, workbox-window reloads the
// page itself on 'controllerchange'. On Safari that reload is flaky and can fail
// to fire; if it hasn't within this window we escalate to a manual bust+reload so
// the user still lands on the new bundle instead of stranding on a spinner.
const SW_ACTIVATE_TIMEOUT_MS = 3500;

/**
 * Tbug40p: the update gate is now driven SOLELY by the truth comparison
 * (appVersion.checkServerVersion: serverBuild > clientBuild). This module no
 * longer raises the gate off `registration.waiting` — a waiting service worker,
 * by itself, never blocks the user (that was 40p: a perpetually-waiting SW on
 * Safari re-nagged on every resume). The SW stays purely the MECHANISM that swaps
 * the bundle when the truth gate does fire and the user clicks "Update now".
 *
 * vite.config.js uses registerType 'prompt', so a new build sits in the waiting
 * SW until updateGateStore.runUpdate() drives activation via the reloader below.
 */
export function setupPwaUpdatePrompt() {
  let lastCheckAt = 0;
  // Populated by onRegisteredSW IF/WHEN it fires. The version check below must
  // not depend on it — a dev server (no real SW build) or a slow/failed
  // registration must not silently disable the backend build-number handshake.
  let registration = null;

  const updateSW = registerSW({
    // Tbug40p: a newly-installed waiting bundle no longer auto-raises the gate.
    // The truth poll below decides when to gate; this SW is only the swap
    // mechanism. Intentionally a no-op.
    onNeedRefresh() {},
    onRegisteredSW(_swUrl, reg) {
      registration = reg || null;
    },
  });

  // Give updateGateStore the SW-swap mechanism as a single reloader it can await
  // after the durable-state flush. This module owns the ServiceWorkerRegistration,
  // so the ordered "actually land the new bundle" escalation lives here (Objective
  // 2), not in the store.
  useUpdateGateStore.getState().setSwReloader(() => landLatestBundle(updateSW, () => registration));

  // Returning to the app is the moment to re-check. Shared by visibilitychange
  // (tab switch / wake from sleep) and pageshow (Safari bfcache restore).
  function onReturnToApp() {
    // Let the SW discover/stage a newer bundle (mechanism, not a gate trigger).
    registration?.update().catch(() => {});
    const now = Date.now();
    if (now - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
    lastCheckAt = now;
    // Rejection here just means the check couldn't reach the server
    // (offline/flaky network) — the next return to the app retries.
    checkBackendVersion();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    onReturnToApp();
  });

  // Safari (the bug39/40 reporter's browser) restores a backgrounded page from
  // bfcache on back/forward WITHOUT a fresh load and, for a bfcache restore, may
  // fire ONLY pageshow(persisted=true) — not visibilitychange. Run the same
  // return-to-app check so a resume re-verifies the server build number. A
  // non-persisted pageshow is a normal fresh load, already handled on-load below.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) onReturnToApp();
  });

  // On-load check: the passive header check (sessionInit.js) only fires once SOME
  // API request resolves, which may be a while for an idle/pre-login screen.
  // Firing one here promptly establishes the server build number.
  checkBackendVersion();

  function checkBackendVersion() {
    // A plain fetch() to an /api path already goes through the sessionInit.js
    // interceptor, whose response handler reads X-App-Build → checkServerVersion.
    fetch(`${API_BASE}/api/version`).catch(() => {});
  }
}

/**
 * Tbug40p Objective 2 — reliably land the LATEST bundle, service worker included.
 * A plain location.reload() while an old Workbox SW controls the page is served
 * the STALE precached index.html (old bundle) → the client stays behind → the
 * truth gate correctly re-fires but a bare reload can never escape it. So the
 * reload is an ordered, time-boxed escalation that busts a stale controller:
 *   1. registration.update() — stage the newest SW so a bundle is waiting.
 *   2. If one is waiting: updateSW(true) → skipWaiting; workbox-window reloads on
 *      'controllerchange' (the new SW's fresh precache serves the new bundle).
 *   3. If 'controllerchange' doesn't fire within a timeout (Safari quirk): don't
 *      settle for a plain reload — postMessage SKIP_WAITING, then unregister() the
 *      controlling SW so the next navigation bypasses its cache, then reload. A
 *      post-unregister load fetches index.html fresh from the network/CDN and
 *      re-registers the new SW.
 * After any path, boot re-reads __APP_BUILD__: if it now equals/exceeds the
 * server build the gate stays down; if a CDN lag still serves old code the gate
 * reappears (visible, correct) but the unregister makes the NEXT reload land it.
 */
async function landLatestBundle(updateSW, getRegistration) {
  const registration = getRegistration?.();

  // 1. Stage the newest SW (so there's actually something to activate).
  try {
    await registration?.update();
  } catch {
    // update() can reject offline/flaky — fall through; the reload paths below
    // still make progress.
  }

  // 2. If a bundle is waiting, ask it to activate; workbox reloads on controlling.
  // Arm the controllerchange listener BEFORE calling updateSW(true) so a fast
  // activation can't slip through the gap between the call and the await.
  if (updateSW && registration?.waiting) {
    const activation = waitForControllerChange(SW_ACTIVATE_TIMEOUT_MS);
    updateSW(true).catch(() => {});
    if (await activation) return; // workbox-window is reloading the page now.
  }

  // 3. Activation didn't land (or there was no waiting SW): bust any stale
  // controller so the reload can't be served old precache, then reload.
  try {
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    // postMessage can throw if the worker is gone — the unregister below covers it.
  }
  try {
    await registration?.unregister();
  } catch {
    // unregister best-effort; a plain reload still usually lands a backend-only bump.
  }
  window.location.reload();
}

/**
 * Resolve true if the SW controller changes within `timeoutMs` (workbox-window is
 * about to reload the page), false on timeout. If the page reloads, this promise
 * simply never settles — the navigation tears everything down.
 */
function waitForControllerChange(timeoutMs) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      sw.removeEventListener('controllerchange', onChange);
      clearTimeout(timer);
      resolve(result);
    };
    const onChange = () => finish(true);
    sw.addEventListener('controllerchange', onChange);
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}
