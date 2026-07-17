/**
 * targetEnv — staging/deployed-target awareness for the E2E suite (T4934).
 *
 * The suite can run against EITHER local dev servers OR a deployed target (staging
 * CF Pages + Fly API) via E2E_BASE_URL / E2E_API_BASE (see playwright.config.js).
 *
 * A handful of specs depend on dev/local-ONLY backend seams under `/api/test/*`
 * (gated by `_test_seams_enabled` in src/backend/app/storage.py — the router is
 * mounted ONLY in dev/development/local/test, NEVER prod/staging). On a deployed
 * target those seam calls come back as a 404 (the Fly API returns JSON 404; the CF
 * Pages SPA returns its HTML fallback), and code that then does `res.json()` throws
 * `SyntaxError: Unexpected token '<'` or waits on a UI state that never arrives —
 * which used to hang the whole spec until the 5-minute Playwright timeout.
 *
 * This module makes that gap VISIBLE and FAST instead of papering over it
 * (CLAUDE.md: no silent fallback that hides a real staging regression):
 *   - `skipOnDeployedTarget()` — explicit, logged skip for seam-dependent specs.
 *   - `assertSeamAvailable()`  — fail-fast guard that throws instantly (with a
 *     self-documenting message) when a seam is not mounted, instead of hanging.
 *   - `LOCAL_ONLY_SPECS`       — the authoritative inventory global-setup prints so
 *     a staging run's skips are self-explaining.
 */

// A deployed target is any run that overrides the frontend base URL. Local dev
// leaves E2E_BASE_URL unset (playwright.config.js defaults to localhost:5173).
export const IS_DEPLOYED_TARGET = !!process.env.E2E_BASE_URL;

/**
 * Skip the current test (or the enclosing describe group, when called at the top of
 * the describe callback body) when running against a deployed target, with a loud,
 * logged reason. Call it at the start of a test body, or at describe-body level.
 *
 *   test('...', () => { skipOnDeployedTarget(test, 'uses /api/test/sync-fault'); ... });
 *
 * @param {import('@playwright/test').TestType} test the Playwright `test` object from the spec
 * @param {string} reason names the seam + why it can't run on staging
 */
export function skipOnDeployedTarget(test, reason) {
  test.skip(IS_DEPLOYED_TARGET, `[T4934 staging-skip] ${reason}`);
}

/**
 * Fail-fast guard for a `/api/test/*` seam response. When the seam is not mounted on
 * the target (prod/staging), the request 404s — either a Fly API JSON 404 or the CF
 * Pages SPA HTML fallback. This throws IMMEDIATELY with a self-documenting message so
 * a mis-targeted run fails instantly instead of a downstream `res.json()` blowing up
 * or a UI wait hanging to the per-test timeout. Returns the response untouched on
 * success so it can wrap a call inline.
 *
 * NOTE: seam-dependent specs should ALSO gate with `skipOnDeployedTarget` so they
 * never reach here on a deployed target; this guard is the belt to that suspenders.
 *
 * @param {import('@playwright/test').APIResponse} res
 * @param {string} seamName e.g. 'sync-fault' (the path segment after /api/test/)
 * @returns {import('@playwright/test').APIResponse} res
 */
export function assertSeamAvailable(res, seamName) {
  const contentType = res.headers()['content-type'] || '';
  if (res.status() === 404 || contentType.includes('text/html')) {
    throw new Error(
      `[T4934] Test seam /api/test/${seamName} is unavailable on this target ` +
        `(status ${res.status()}, content-type "${contentType || 'none'}"). ` +
        `The /api/test/* seams are dev/local-only (_test_seams_enabled) and are not ` +
        `mounted on staging/prod. Gate this spec with ` +
        `skipOnDeployedTarget(test, '...') so it skips on a deployed E2E_BASE_URL. ` +
        `See src/frontend/e2e/helpers/targetEnv.js.`,
    );
  }
  return res;
}

/**
 * Authoritative inventory of specs that CANNOT run against a deployed target, with the
 * reason per spec. global-setup prints this loudly when IS_DEPLOYED_TARGET so a staging
 * run's skips are self-explaining (never a silent skip). Keep in sync with the
 * `skipOnDeployedTarget()` calls in the listed specs.
 *
 * Two categories (the `depends` field names the concrete dependency):
 *
 *  - `seam`  — depends on the dev/local-only `/api/test/*` seams (T4934). These are the
 *    ONLY specs in the suite that touch `/api/test/*` (scripted grep). All OTHER auth
 *    bypasses (`test-login`, `dev-login`, the `X-User-ID` header) ARE available on
 *    staging (gated on `APP_ENV != production`, not on `_test_seams_enabled`), so those
 *    specs stay in the staging set.
 *  - `vite-module` — dynamically `import()`s a Vite-dev source path (e.g.
 *    `/src/utils/foo.js`) to unit-test a browser module in-page (T5320). Those paths
 *    exist only under the Vite dev server; on a deployed CF Pages BUILD the source is
 *    bundled/hashed, so the import 404s ("Failed to fetch dynamically imported module").
 *    This is a test-vs-deployed-bundle mismatch, NOT a staging bug and NOT a data gap —
 *    the module logic is also covered by Vitest, so these run locally only.
 */
export const LOCAL_ONLY_SPECS = [
  {
    file: 'T4120-self-verify-durability.spec.js',
    category: 'seam',
    depends: ['/api/test/sync-fault', '/api/test/simulate-machine-cycle', '/api/test/migrate-current-profile'],
    reason:
      'durability FAULT-INJECTION seams (deliberately perturb R2 sync + machine ' +
      'lifecycle) — never safe to run against real staging infra',
  },
  {
    file: 'T4850-move-reels.spec.js',
    category: 'seam',
    depends: ['/api/test/seed-final-video', '/api/test/ensure-pg-user'],
    reason:
      'dev-only data-seeding seams (seed-final-video uploads a tiny MP4 to the ' +
      'per-profile R2 prefix; ensure-pg-user registers the isolated test user) ' +
      '— not mounted on staging',
  },
  {
    file: 'keyframe-integrity.spec.js',
    category: 'vite-module',
    depends: ['/src/controllers/keyframeController.js', '/src/utils/keyframeUtils.js'],
    reason:
      'in-page unit test that import()s the keyframe controller/utils from the Vite ' +
      'dev server; those /src paths do not exist on a deployed BUILD. Logic is also ' +
      'covered by Vitest (controllers/keyframeController.test.js).',
  },
  {
    file: 'blob-url-recovery.spec.js',
    category: 'vite-module',
    depends: ['/src/utils/videoErrorClassifier.js'],
    reason:
      'in-page unit test that import()s the video-error classifier from the Vite dev ' +
      'server; that /src path does not exist on a deployed BUILD. The classifier is ' +
      'environment-independent pure JS, so a deployed run adds no coverage. (No Vitest ' +
      'exists for it yet — porting these assertions to Vitest is a worthwhile follow-up.)',
  },
];
