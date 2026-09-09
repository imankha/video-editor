import { registerSW } from 'virtual:pwa-register';
import { API_BASE } from '../config';
import { setBundleProbe } from './appVersion';
import { useUpdateGateStore } from '../stores/updateGateStore';

// Long-lived installed PWAs never hit a "next load", and browsers throttle or
// freeze background timers, so the re-check rides visibilitychange (returning to
// the app is exactly the moment to check, T4150) AND a low-frequency scheduled
// poll while the tab is visible (T9360 candidate 1 — the visible-but-idle tab that
// makes no API calls and never tab-switches otherwise has NO time-based trigger and
// notices a deploy effectively never; T9340 measured this as the dominant latency
// leg).
//
// T9360 candidate 2: this gap was 5 minutes, which stranded the mobile-PWA case —
// a quick background/resume within 5 min of the last check got NO version check at
// all. Lowered to a short storm guard: it is still a gap (a burst of alt-tabs, or a
// scheduled tick landing right after a resume check, coalesces to one cheap GET
// /api/version), but a genuine resume now almost always re-checks. The expensive
// half — registration.update() inside the bundle probe — keeps its own independent
// PROBE_MIN_GAP_MS storm guard (appVersion.js), and checkServerVersion only reaches
// the probe when serverBuild > clientBuild, so a check that finds nothing new is a
// bare header read.
const UPDATE_CHECK_MIN_GAP_MS = 30 * 1000;

// T9360 candidate 1: how often a VISIBLE tab re-checks the server build with no
// other trigger. A scheduled poll (setInterval), not a reactive effect watching
// state — same shape as updateGateStore's Gap B quiescence timer, so it does not
// violate the gesture/scheduled-only persistence rule. The interval only ever fires
// a cheap GET /api/version; UPDATE_CHECK_MIN_GAP_MS coalesces it with resume checks.
const VISIBLE_POLL_INTERVAL_MS = 30 * 1000;

// Tbug40p: after asking a waiting SW to skipWaiting, workbox-window reloads the
// page itself on 'controllerchange'. On Safari that reload is flaky and can fail
// to fire; if it hasn't within this window we escalate to a manual bust+reload so
// the user still lands on the new bundle instead of stranding on a spinner.
const SW_ACTIVATE_TIMEOUT_MS = 3500;

// Tbug41s: an update() that finds new bytes leaves an `installing` worker that only
// becomes `waiting` once its precache finishes downloading. Bound the wait so a
// slow install answers "no bundle yet" (retried after the probe cooldown) instead of
// hanging the gate decision forever.
const SW_INSTALL_TIMEOUT_MS = 10 * 1000;

// T9360: the visible-tab poll timer (candidate 1). Module-level so a test can stop
// it between cases and it never leaks across the suite. setupPwaUpdatePrompt runs
// exactly once in production (main.jsx), so the interval lives for the app's
// lifetime by design — the app's update heartbeat, not a leak.
let visiblePollTimer = null;

/** Test-only seam: stop the visible-tab poll so it can't leak across cases. */
export function __stopVisiblePollForTest() {
  if (visiblePollTimer !== null) {
    clearInterval(visiblePollTimer);
    visiblePollTimer = null;
  }
}

/**
 * T6630 round 4: DEV must never run under a service worker, and must
 * ACTIVELY EVICT any SW already controlling this origin.
 *
 * vite-plugin-pwa's dev-mode registration is already a no-op today
 * (`devOptions` is unset in vite.config.js, so `virtual:pwa-register`'s
 * `registerSW` in dev resolves to an empty async function that never calls
 * `navigator.serviceWorker.register` -- confirmed by inspecting the served
 * dev virtual module). So the CURRENT dev server never installs a SW itself.
 *
 * The actual bug: a REAL service worker from a past `vite build && vite
 * preview` (or any prior production-like session) on this SAME origin/port
 * persists in the browser's storage indefinitely and keeps CONTROLLING this
 * page even after switching back to `vite dev` -- a controlling SW
 * intercepts EVERY fetch a page under its scope makes, cross-origin included
 * (Cloudflare R2 presigned URLs), with whatever stale cached logic it shipped
 * with. That is the mechanism behind "head fetch threw: Failed to fetch" on
 * an otherwise-healthy single dev server, and behind "I don't see any of your
 * changes" (a controlling SW can serve a stale cached bundle instead of the
 * dev server's live one). `setupPwaUpdatePrompt` is PROD-ONLY (see
 * `main.jsx`'s `import.meta.env.DEV` gate); this is dev's counterpart --
 * called unconditionally on every dev load so a stale SW never survives a
 * reload once this fix has shipped.
 */
export async function evictStaleDevServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (registrations.length > 0) {
      console.info(`[DevSW] evicted ${registrations.length} stale service worker registration(s)`);
    }
  } catch (e) {
    console.warn('[DevSW] failed to evict service worker registrations:', e);
  }
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {
      console.warn('[DevSW] failed to clear caches:', e);
    }
  }
}

/**
 * Tbug40p: the update gate is driven by the truth comparison
 * (appVersion.checkServerVersion: serverBuild > clientBuild). This module does not
 * raise the gate off `registration.waiting` — a waiting service worker, by itself,
 * never blocks the user (that was 40p: a perpetually-waiting SW on Safari re-nagged
 * on every resume). The SW is the MECHANISM that swaps the bundle when the gate
 * fires and the user clicks "Update now".
 *
 * Tbug41s adds the other half: a waiting SW does not RAISE the gate, but its
 * ABSENCE now VETOES it. `serverBuild > clientBuild` alone can be true forever when
 * the backend deploys without the frontend (path-filtered workflows), which strands
 * the user in an unescapable modal. So this module also registers the bundle probe
 * appVersion consults before gating. Both directions keep all ServiceWorker
 * mechanics here and the decision there.
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

  // Tbug41s: give appVersion the "is there actually a newer bundle?" question it
  // must answer YES to before blocking the user. Registered unconditionally at
  // setup; the probe itself returns false when there is no registration yet, so a
  // slow/failed SW registration under-gates (safe) rather than looping (not safe).
  setBundleProbe(() => probeForWaitingBundle(() => registration));

  // A version check, throttled by UPDATE_CHECK_MIN_GAP_MS so the resume trigger
  // (bursty — a flurry of alt-tabs) and the scheduled visible poll coalesce onto a
  // single gap instead of storming GET /api/version. Rejection inside
  // checkBackendVersion just means the check couldn't reach the server
  // (offline/flaky) — the next trigger retries.
  function maybeCheckBackendVersion() {
    const now = Date.now();
    if (now - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
    lastCheckAt = now;
    checkBackendVersion();
  }

  // Returning to the app is the moment to re-check. Shared by visibilitychange
  // (tab switch / wake from sleep) and pageshow (Safari bfcache restore).
  function onReturnToApp() {
    // Let the SW discover/stage a newer bundle (mechanism, not a gate trigger).
    registration?.update().catch(() => {});
    maybeCheckBackendVersion();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    onReturnToApp();
  });

  // T9360 candidate 1: a visible-but-idle tab has no other trigger — no API traffic,
  // no tab-switch — so give it a time-based one. A hidden tab is skipped (its next
  // visibilitychange already re-checks on return, and background timers are throttled
  // anyway); coalesced with resume checks by the shared UPDATE_CHECK_MIN_GAP_MS.
  __stopVisiblePollForTest();
  visiblePollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') maybeCheckBackendVersion();
  }, VISIBLE_POLL_INTERVAL_MS);

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
 * Tbug41s — the bundle probe appVersion consults before raising the gate.
 * Reports whether a newer bundle is genuinely waiting to take over.
 *
 * Why `waiting` specifically, and not "an SW installed": a FIRST-EVER registration
 * installs and activates directly with nothing to supersede — that is THIS bundle
 * registering itself, not an update. Treating it as one would gate a client that is
 * already running the newest code it can get, i.e. the loop again.
 *
 * T9310 Gap C — the return type is `{ hasBundle, stillInstalling }`, not a bare
 * boolean, so `appVersion.hasNewerBundle` can tell "genuinely nothing waiting" apart
 * from "a worker is mid-install and just missed the SW_INSTALL_TIMEOUT_MS window on a
 * slow connection". The latter deserves a ~30s re-probe, not the full 5-minute
 * cooldown that would otherwise lock the client out of an update it is seconds from.
 */
export async function probeForWaitingBundle(getRegistration) {
  const registration = getRegistration?.();
  // No registration (SW unsupported, private mode, registration still pending or
  // failed) — cannot prove a newer bundle exists, so do not gate.
  if (!registration) return { hasBundle: false, stillInstalling: false };

  try {
    await registration.update();
  } catch {
    // Offline/flaky — unprovable, so "no". Retried after the probe cooldown.
    return { hasBundle: false, stillInstalling: false };
  }

  if (registration.waiting) return { hasBundle: true, stillInstalling: false };

  const installing = registration.installing;
  if (!installing) return { hasBundle: false, stillInstalling: false }; // no new bytes.

  await waitForInstalledOrTimeout(installing, SW_INSTALL_TIMEOUT_MS);
  // Re-read after settling: only `waiting` proves a supersede.
  if (registration.waiting) return { hasBundle: true, stillInstalling: false };
  // No waiting worker after the bounded wait. If OUR worker is still in the
  // 'installing' state it simply didn't finish in time (slow install) → Gap C
  // asks the caller to retry soon rather than sit out the full cooldown.
  return { hasBundle: false, stillInstalling: installing.state === 'installing' };
}

/** Resolve once `worker` leaves the 'installing' state, or on timeout. */
function waitForInstalledOrTimeout(worker, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      worker.removeEventListener('statechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (worker.state !== 'installing') finish();
    };
    worker.addEventListener('statechange', onChange);
    const timer = setTimeout(finish, timeoutMs);
  });
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
