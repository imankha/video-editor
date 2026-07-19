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
 * Categories (the `depends` field names the concrete dependency):
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
 *  - `capture` (T5420) — a developer screen-RECORDING script that records to a host-local
 *    directory (QUEST_DIR) to produce tutorial footage; not a functional test and cannot
 *    run without the host recording assets.
 *  - `local-fixture` (T5420) — needs a local-only DB/data fixture the staging seed does
 *    not provide (e.g. a game flipped `storage_expires_at` into the past), OR drives a
 *    full local upload/extract/export pipeline (X-User-ID empty user + local media) that
 *    is a dev-run flow, not a deployed-target guardrail. Some entries gate only PART of a
 *    file (noted in `reason`); the rest of that file still runs on staging.
 *
 * NOTE: specs that only made RELATIVE `/api/...` calls (which 404 to the CF Pages SPA on a
 * deployed target) were MIGRATED to `E2E_API_BASE` instead of gated (T5420: T3980, T4190,
 * annotate-game-clock) and KEEP running on staging — they are deliberately NOT listed here.
 */
/**
 * The curated `@staging-gate` subset (T5400) — the reliable, fast specs that ARE
 * the pre-deploy gate. Run them with `npm run test:e2e:staging-gate` (which greps
 * the `@staging-gate` tag in the test titles); this inventory is the human-readable
 * companion global-setup prints so a gate run announces exactly what it covers.
 *
 * MUST stay in sync with the `@staging-gate` tags in the listed spec titles. The
 * set is deliberately small: specs that key on the seeded fixture account and give
 * real signal on changed surfaces, and are reliable on a deployed target. It
 * EXCLUDES the `LOCAL_ONLY_SPECS` (seam / vite-module) and the `screen-usability`
 * viewport-emulation audit (its iOS-Safari dynamic-toolbar blind spot is documented
 * in usabilityAudit.js + gated at source by check-viewport-units.mjs — it is not a
 * staging-gate signal). Target wall-clock: well under ~15 min against staging.
 *
 * Data-dependent gate specs SKIP LOUDLY (never a silent green pass) when the fixture
 * lacks the required data, so a real regression and a missing fixture never look
 * alike. See e2e/STAGING-GATE.md.
 */
export const STAGING_GATE_SPECS = [
  {
    file: 'staging-smoke.spec.js',
    covers: 'API /health 200 + dev-login session + app shell renders (fastest signal)',
  },
  {
    file: 'T5290-recap-mobile-redesign.spec.js',
    covers: 'recap player responsive layout (portrait/landscape/narrow/desktop), no overflow',
  },
  {
    file: 'T4550-overlay-transform.qa.spec.js',
    covers: 'framing crop-overlay placement + drag round-trip; overlay/detection layer (rAF-leak free)',
  },
  {
    file: 'derisk-staging-export.qa.spec.js',
    covers: 'export pipeline (framing -> overlay -> final) + publish, on a DISCOVERED draft',
  },
  {
    file: 'derisk-staging-endcard-copylink.qa.spec.js',
    covers: 'branded end card on shared reel + collection; copy-link POST/toast dedup',
  },
];

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
  // --- T5420: in-page store/module unit tests (import()s a Vite-dev /src path) --------
  {
    file: 'T5070-blocking-update-gate.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/updateGateStore.js'],
    reason: 'drives the blocking update gate by import()ing the updateGateStore in-page; the /src path 404s on a deployed BUILD (gate logic also Vitest-covered).',
  },
  {
    file: 'T4900-overlay-action-failure-visibility.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/overlayActionStore.js'],
    reason: 'injects overlay-action failures via dispatchOverlayAction/useOverlayActionStore import()ed in-page; the /src path 404s on a deployed BUILD.',
  },
  {
    file: 'T4100-dedup-honest-message.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/uploadStore.js'],
    reason: 'inspects upload-dedup state by import()ing the uploadStore in-page; the /src path 404s on a deployed BUILD.',
  },
  {
    file: 'collections.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/authStore.js'],
    reason: 'bypasses the auth gate via an in-page authStore import for an EMPTY test-login session; the /src path 404s on a deployed BUILD and the empty-session premise cannot use the real seeded account.',
  },
  {
    file: 'clip-selection-state-machine.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/authStore.js'],
    reason: 'bypasses the auth gate via an in-page authStore import for an EMPTY test-login session; the /src path 404s on a deployed BUILD.',
  },
  {
    file: 'sidebar-scrub-debug.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/authStore.js'],
    reason: 'bypasses the auth gate via an in-page authStore import for an EMPTY test-login session; the /src path 404s on a deployed BUILD.',
  },
  {
    file: 'cache-warming-console.spec.js',
    category: 'vite-module',
    depends: ['/src/utils/cacheWarming.js'],
    reason: 'in-page unit test that import()s cacheWarming.js from the Vite dev server; the /src path 404s on a deployed BUILD.',
  },
  {
    file: 'new-user-flow.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/questStore.js', 'local test-data video', 'execSync'],
    reason: 'EMPTY new-user flow: seeds quest state via an in-page /src/stores import and uploads a local test video / shells out; the /src paths 404 on a deployed BUILD.',
  },
  {
    file: 'T4780-tutorial-quest-steps.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/questStore.js', '/src/config/questDefinitions.jsx', '/src/config/tutorialVideos.js'],
    reason: 'asserts quest-step definitions via in-page /src imports on an EMPTY test-login session; the /src paths 404 on a deployed BUILD.',
  },
  {
    file: 'T4860-admin-bulk-actions.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/authStore.js'],
    reason: 'surfaces the admin header by import()ing authStore.checkAdmin() in-page; the /src path 404s on a deployed BUILD (and admin rights are env-specific).',
  },
  // --- T5420: developer screen-recording capture scripts (record to a host QUEST_DIR) --
  {
    file: 'tutorial-capture-annotate.spec.js',
    category: 'capture',
    depends: ['host QUEST_DIR (Windows Captures dir) + reconstitute_clip.json'],
    reason: 'tutorial-footage RECORDING script (records video to a host-local dir) — not a functional test; cannot run without the host capture assets.',
  },
  {
    file: 'tutorial-capture-framing.spec.js',
    category: 'capture',
    depends: ['host QUEST_DIR (Windows Captures dir)'],
    reason: 'tutorial-footage RECORDING script (records video to a host-local dir) — not a functional test.',
  },
  {
    file: 'tutorial-capture-overlay.spec.js',
    category: 'capture',
    depends: ['host QUEST_DIR (Windows Captures dir)'],
    reason: 'tutorial-footage RECORDING script (records video to a host-local dir) — not a functional test.',
  },
  {
    file: 'tutorial-capture-publish.spec.js',
    category: 'capture',
    depends: ['host QUEST_DIR (Windows Captures dir)'],
    reason: 'tutorial-footage RECORDING script (records video to a host-local dir) — not a functional test.',
  },
  // --- T5420: local-only fixtures / dev-run pipelines ---------------------------------
  {
    file: 'bug27p-expired-annotations.spec.js',
    category: 'local-fixture',
    depends: ['QA-harness expired-game DB fixture (game_storage.storage_expires_at flipped past)'],
    reason: 'beforeAll requires a game flipped to storage_status "expired" (+ a healthy game) by the local QA harness; the staging seed does not flip an expired game. Expired-render path is unit-covered (AnnotateModeView.expired.test.jsx).',
  },
  {
    file: 'T4110-reedit-reel-persistence.spec.js',
    category: 'local-fixture',
    depends: ['dev machine-cycle repro + overlay-export pipeline'],
    reason: 'DEV INVESTIGATION spec (its own header documents the dev-vs-prod limitation): drives a full re-edit->overlay-export->publish pipeline whose overlay-export panel does not mount on staging.',
  },
  {
    file: 'full-workflow.spec.js',
    category: 'local-fixture',
    depends: ['local test video (formal annotations/test.short) + full upload/extract/export pipeline'],
    reason: 'uploads a local test video and drives the full upload/extract/annotate/export pipeline (X-User-ID empty user) — a local-dev flow that would hit staging media infra + Modal; not a deployed-target guardrail.',
  },
  {
    file: 'profile-switch-isolation.spec.js',
    category: 'local-fixture',
    depends: ['browser-side relative fetch(/api) + X-User-ID same-origin isolation (ONE test only)'],
    reason: 'PARTIAL: only the "browser shows correct games after profile switch" test is gated (browser-side relative /api + X-User-ID same-origin premise is a local-dev construct). The API-level isolation test still runs on staging.',
  },
  {
    file: 'regression-tests.spec.js',
    category: 'local-fixture',
    depends: ['local test video (formal annotations/test.short) + full upload/extract/export pipeline'],
    reason: 'both @smoke and @full describes upload a LOCAL test video and drive the full upload/extract/annotate/export pipeline — a local-dev flow that needs host media and would hit staging infra + Modal.',
  },
  {
    file: 'request-storm-regression.spec.js',
    category: 'local-fixture',
    depends: ['local test video (formal annotations/test.short)'],
    reason: 'beforeAll uploads a LOCAL test video + TSV to create a game, then drives the request-storm scenario — a local-dev flow needing host media.',
  },
  {
    file: 't4800-orphan-drafts.qa.spec.js',
    category: 'vite-module',
    depends: ['/src/stores/authStore.js', 'local draft fixtures'],
    reason: 'authenticates via an in-page authStore import and SEEDS local draft fixtures; the /src path 404s on a deployed BUILD and the seeding is a local-dev construct.',
  },
];
