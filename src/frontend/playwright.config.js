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

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
});
