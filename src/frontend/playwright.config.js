import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Playwright configuration for E2E tests
 *
 * IMPORTANT: Start servers manually before running tests:
 *   Terminal 1: cd src/backend && python -m uvicorn app.main:app --port 8000
 *   Terminal 2: cd src/frontend && npm run dev
 *
 * Run tests:
 *   npx playwright test           # CLI mode
 *   npx playwright test --ui      # UI mode (recommended)
 *   npx playwright test --grep @smoke   # Fast smoke tests only
 *   npx playwright test --grep @full    # Full coverage tests
 */

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data directory - contains video and TSV files for testing
const TEST_DATA_DIR = path.resolve(__dirname, '../../formal annotations/12.6.carlsbad');

// Always use dev ports - simpler configuration
// reuseExistingServer: true means it will use your running dev servers if available
const API_PORT = 8000;
const FRONTEND_PORT = 5173;

// Target override: run against a deployed environment (e.g. staging) instead of
// local dev servers by setting E2E_BASE_URL + E2E_API_BASE. Defaults stay local.
//   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
//   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
//   npm run test:e2e
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${FRONTEND_PORT}`;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;

// Opt-in auto-start of the dev servers (E2E_AUTOSTART=1). OFF by default so the
// historical "start servers by hand" contract is unchanged and cancelled runs
// can't orphan host processes. Use it for unattended runs (sandbox/worktree),
// where the process tree dies with the container. `reuseExistingServer` means an
// already-running stack (e.g. `task.sh test`, which pre-starts it) is reused, not
// duplicated. Never auto-start when pointed at a deployed target.
const AUTOSTART = process.env.E2E_AUTOSTART === '1' && !process.env.E2E_BASE_URL;

// T4934/T5320: per-test timeout. Local video-processing tests can legitimately take
// minutes, so local stays at 5m. On a DEPLOYED target the seam-dependent hangs are
// removed by tagging (see e2e/helpers/targetEnv.js) and every data-needing spec logs
// in against the seeded fixture account (see e2e/FIXTURE-CONTRACT.md), so nothing
// should legitimately take minutes. T5320 tightens the deployed default from 120s to
// 60s: a genuine data/config miss (fixture not seeded, wrong profile) then fails fast
// (~60s) instead of hanging, so a full staging run finishes in minutes and stays a
// usable pre-deploy gate. A real regression reads as a fast, specific failure — not a
// data-less hang. Override with E2E_TIMEOUT_MS for a slower target.
const PER_TEST_TIMEOUT = process.env.E2E_TIMEOUT_MS
  ? Number(process.env.E2E_TIMEOUT_MS)
  : (process.env.E2E_BASE_URL ? 60000 : 300000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests sequentially for workflow tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential tests

  // Multiple reporters for different use cases:
  // - html: Interactive report for manual review
  // - json: Structured results for AI/automated analysis
  // - list: Console output during test runs
  reporter: [
    ['html', { outputFolder: path.join(__dirname, 'test-results/html') }],
    ['json', { outputFile: path.join(__dirname, 'test-results/results.json') }],
    ['list'],
  ],

  // Output directory for test artifacts (screenshots, traces, videos)
  outputDir: path.join(__dirname, 'test-results/artifacts'),

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure', // Keep traces for failed tests (helps debugging)
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pass test data paths and API config to tests
    testDataDir: TEST_DATA_DIR,
    apiBase: API_BASE,
    apiPort: API_PORT,
  },

  // T4930: the usability audit runs across a viewport MATRIX; every other spec
  // stays Desktop-Chrome-only. The mobile/tablet projects therefore `testMatch`
  // ONLY screen-usability.spec.js (NOT the *.selfcheck.spec.js, which pins its own
  // viewport and only needs to run once on desktop) — so the added CI cost is one
  // audit pass per device, not the whole functional suite x5.
  projects: [
    {
      // Desktop: the existing project. Runs EVERYTHING (functional specs + the
      // audit at desktop size + the synthetic self-check).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile/tablet projects run on the CHROMIUM engine with each device's
    // viewport / deviceScaleFactor / isMobile / touch / UA. WHY chromium and not
    // the descriptor's default WebKit: it keeps the matrix runnable wherever the
    // repo already installs chromium (CI installs only chromium; no extra ~300MB
    // WebKit download), and matches the established mobile-emulation pattern in
    // this suite (T4880 emulated iPhone via a chromium context). The honest limit
    // — neither engine reproduces iOS Safari's dynamic-toolbar 100vh chrome — is
    // documented in usabilityAudit.js and blocked at the source by the
    // check-viewport-units.mjs gate, so the engine choice does not weaken the
    // T4880 coverage. Each phone project also audits landscape (see sweepOrientations).
    {
      // The reporting user's device class (most-popular current iPhone).
      name: 'iphone',
      testMatch: /screen-usability\.spec\.js/,
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
    {
      // Smallest supported iPhone — tightest height, clips below-fold first.
      name: 'iphone-se',
      testMatch: /screen-usability\.spec\.js/,
      use: { ...devices['iPhone SE'], browserName: 'chromium' },
    },
    {
      // Most-popular Android class.
      name: 'android',
      testMatch: /screen-usability\.spec\.js/,
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      // Tablet.
      name: 'tablet',
      testMatch: /screen-usability\.spec\.js/,
      use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
    },
  ],

  // Web server configuration.
  // DEFAULT (AUTOSTART off): Playwright will NOT start servers -- start them by
  // hand first (prevents orphaned host processes when a run is cancelled):
  //   Terminal 1: cd src/backend && python -m uvicorn app.main:app --port 8000
  //   Terminal 2: cd src/frontend && npm run dev
  // OPT-IN (E2E_AUTOSTART=1): Playwright starts both servers itself. Intended for
  // unattended runs inside a sandbox container/worktree (the tree dies with the
  // container, so no orphans). reuseExistingServer reuses an already-running stack.
  ...(AUTOSTART ? {
    webServer: [
      {
        command: 'python -m uvicorn app.main:app --port 8000',
        cwd: path.resolve(__dirname, '../backend'),
        url: `http://localhost:${API_PORT}/api/health`,
        reuseExistingServer: true,
        timeout: 120000,
      },
      {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120000,
      },
    ],
  } : {}),

  // Increase timeout for video processing operations. Local: 5m (video uploads take
  // time). Deployed target: shorter (see PER_TEST_TIMEOUT above) — T4934.
  timeout: PER_TEST_TIMEOUT,
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
});
