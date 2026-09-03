import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * Tbug40p — truth-based version gate. Replaces the old sha-mismatch heuristic
 * (bootVersion latch + 2-observation debounce + sessionStorage "acknowledged
 * version") entirely.
 *
 * THE RULE (amended by Tbug41s): gate iff the deployed server's build number is
 * STRICTLY GREATER than this running client's baked-in build number AND a newer
 * client bundle is actually obtainable.
 *
 * Tbug41s — why the second half is required. `serverBuild > clientBuild` proves the
 * SERVER moved; it does NOT prove a newer CLIENT bundle exists. The two deploy
 * independently (path-filtered workflows: deploy-backend.yml fires on
 * `src/backend/**`, deploy-frontend.yml on `src/frontend/**`), so a backend-only
 * commit raises the server's number with no matching bundle. The gate then demands
 * an update that can never arrive: "Update now" reloads onto the SAME bundle, the
 * comparison re-fires, forever. Observed on staging 2026-07-30 (server 3165 vs
 * bundle 3163; commits 3164-3165 touched zero frontend files) and latent on prod
 * for any `deploy_production.sh --backend-only`. Requiring a real waiting bundle
 * makes the gate's PRECONDITION match its EXIT CONDITION, so the loop is
 * structurally impossible rather than merely unlikely.
 *
 *   clientBuild  = __APP_BUILD__            (git rev-list --count HEAD, baked at
 *                                            build time — immutable for the life
 *                                            of this loaded page; it is TRUTH,
 *                                            not a latched observation)
 *   serverBuild  = X-App-Build header / GET /api/version `build`
 *
 * Why this kills the bug (40p) and its whole class:
 *   - A running build can never re-detect ITSELF as an update: after a reload
 *     onto build N, clientBuild === N, so serverBuild(N) > N is false. No ack
 *     needed — the loaded bundle IS the acknowledgement. (bug40: Safari discards
 *     the page and full-reloads on every wake; the old design re-latched a boot
 *     version and re-gated. A baked constant cannot drift across reloads.)
 *   - Mixed fleet is safe with NO debounce: a straggler backend machine still on
 *     build N-1 advertises a LOWER number, and N-1 > N is false, so it never
 *     gates. Only a strictly-newer server (a real deploy) fires the gate, exactly
 *     once, until the client reloads onto it.
 *
 * Observed by both places that already see server responses, zero extra requests:
 *   - sessionInit.js's fetch interceptor (reads X-App-Build off every API response)
 *   - pwaUpdate.js's on-load + resume poll (GET /api/version for an idle PWA)
 */

// The client's own build, baked in by vite `define` (see vite.config.js). Read
// through a mutable binding so tests can inject a deterministic value without
// depending on vite's compile-time replacement. typeof-guarded so a non-bundled
// context (unit test without the define, SSR) degrades to 0 instead of a
// ReferenceError — and clientBuild 0 only ever UNDER-gates (never a false gate).
let clientBuild = typeof __APP_BUILD__ !== 'undefined' ? Number(__APP_BUILD__) : 0;

/** Test-only seam: set the running client's build number. Named loudly so it is
 *  obviously not production API. */
export function __setClientBuildForTest(n) {
  clientBuild = Number(n);
}

// Tbug41s: set once by pwaUpdate.js (which owns the ServiceWorkerRegistration) to
// an async () => boolean resolving true iff a NEWER client bundle is actually
// waiting to be activated. Same seam shape as updateGateStore's _swReloader: all
// ServiceWorker mechanics stay in pwaUpdate.js, this module just asks the question.
let bundleProbe = null;

// Probing costs a registration.update() network round trip, and checkServerVersion
// runs on EVERY api response. Without a cooldown the staging case (server
// permanently ahead, no bundle to find) would fire an update() per response.
const PROBE_MIN_GAP_MS = 5 * 60 * 1000;
let lastProbeAt = 0;
let probeInFlight = null;

export function setBundleProbe(fn) {
  bundleProbe = fn;
}

/** Test-only seam: clear probe registration + throttle state between tests. */
export function __resetProbeStateForTest() {
  bundleProbe = null;
  lastProbeAt = 0;
  probeInFlight = null;
}

/**
 * Compare the deployed server's build against this client's and raise the gate
 * iff the client is strictly behind. A missing/non-numeric header (very old
 * server, or a deploy that forgot the build-arg → "0") is inert: it can never
 * be > clientBuild for a real deployed client, so it never gates.
 *
 * @param {string|number|null} serverBuild  value of X-App-Build (or /api/version build)
 */
export async function checkServerVersion(serverBuild) {
  const server = Number(serverBuild);
  if (!Number.isFinite(server)) return; // header absent / unparseable → ignore
  if (server <= clientBuild) return; // up-to-date, or an older straggler → NEVER gate

  // Already gated — the first fire won, so skip the probe rather than re-running
  // a network check. T8460: still re-test quiescence on every subsequent call
  // (this fires on the existing re-check cadence: API responses,
  // visibilitychange) — requireUpdate() is a no-op on the flag but auto-runs
  // once the app clears an export/upload/open modal. Without this, a gate
  // raised while non-quiescent would never retry (checkServerVersion is the
  // only caller of requireUpdate) and the client would sit un-updated
  // indefinitely.
  if (useUpdateGateStore.getState().isUpdateRequired) {
    useUpdateGateStore.getState().requireUpdate({ needsMigration: false });
    return;
  }

  // Tbug41s: the server moved, but is there actually a newer bundle to load?
  if (!(await hasNewerBundle())) return;

  // Strictly newer server build AND a bundle waiting → a genuine, ESCAPABLE update.
  //
  // Data-schema axis (Tbug40p decision #3 — seam only): a future deploy that also
  // advances the DB schema (PRAGMA user_version) would set needsMigration:true to
  // route runUpdate through the heavier sync→lock→migrate→reboot path. Today every
  // app-code bump routes to a clean reload, so we always pass false. When the first
  // real schema-advancing deploy lands, compare an X-Data-Schema header here.
  useUpdateGateStore.getState().requireUpdate({ needsMigration: false });
}

/**
 * Tbug41s — is a newer client bundle actually obtainable right now?
 *
 * Throttled and de-duplicated: the staging failure mode leaves the server
 * permanently ahead, so an unthrottled probe would fire a registration.update()
 * on every single API response. Within PROBE_MIN_GAP_MS a repeat call reuses the
 * in-flight promise, or answers "no" outright.
 *
 * NO PROBE REGISTERED → NO GATE, deliberately. pwaUpdate.js registers this during
 * setup; if it hasn't (no ServiceWorker support, private mode, a failed
 * registration, a dev server) we cannot PROVE a newer bundle exists, and gating on
 * an unprovable claim is exactly what strands a user in the loop. Such clients also
 * self-heal: with no SW there is no stale precache, so any ordinary reload already
 * fetches the newest index.html from the CDN. Loud, not silent, per the
 * no-silent-fallbacks rule.
 */
async function hasNewerBundle() {
  if (!bundleProbe) {
    console.warn(
      '[appVersion] Server build is ahead but no bundle probe is registered ' +
      '(no ServiceWorker?) - not gating, since a newer bundle cannot be confirmed.'
    );
    return false;
  }

  if (probeInFlight) return probeInFlight;

  const now = Date.now();
  if (now - lastProbeAt < PROBE_MIN_GAP_MS) return false;
  lastProbeAt = now;

  probeInFlight = (async () => {
    try {
      return await bundleProbe();
    } catch {
      // Offline/flaky: cannot confirm a newer bundle, so do not gate. The next
      // response after the cooldown retries.
      return false;
    } finally {
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}
