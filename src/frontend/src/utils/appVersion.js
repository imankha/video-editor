import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * Tbug40p — truth-based version gate. Replaces the old sha-mismatch heuristic
 * (bootVersion latch + 2-observation debounce + sessionStorage "acknowledged
 * version") entirely.
 *
 * THE ONE RULE: gate iff the deployed server's build number is STRICTLY GREATER
 * than this running client's baked-in build number.
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

/**
 * Compare the deployed server's build against this client's and raise the gate
 * iff the client is strictly behind. A missing/non-numeric header (very old
 * server, or a deploy that forgot the build-arg → "0") is inert: it can never
 * be > clientBuild for a real deployed client, so it never gates.
 *
 * @param {string|number|null} serverBuild  value of X-App-Build (or /api/version build)
 */
export function checkServerVersion(serverBuild) {
  const server = Number(serverBuild);
  if (!Number.isFinite(server)) return; // header absent / unparseable → ignore
  if (server <= clientBuild) return; // up-to-date, or an older straggler → NEVER gate

  // Strictly newer server build exists → a genuine new deploy.
  //
  // Data-schema axis (Tbug40p decision #3 — seam only): a future deploy that also
  // advances the DB schema (PRAGMA user_version) would set needsMigration:true to
  // route runUpdate through the heavier sync→lock→migrate→reboot path. Today every
  // app-code bump routes to a clean reload, so we always pass false. When the first
  // real schema-advancing deploy lands, compare an X-Data-Schema header here.
  useUpdateGateStore.getState().requireUpdate({ needsMigration: false });
}
