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
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure', // Keep traces for failed tests (helps debugging)
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pass test data paths and API config to tests
    testDataDir: TEST_DATA_DIR,
    apiBase: `http://localhost:${API_PORT}/api`,
    apiPort: API_PORT,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Web server configuration - DISABLED
  // Playwright will NOT start servers automatically.
  // You must start them manually before running tests:
  //   Terminal 1: cd src/backend && python -m uvicorn app.main:app --port 8000
  //   Terminal 2: cd src/frontend && npm run dev
  // This prevents zombie processes when tests are cancelled.

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
});
