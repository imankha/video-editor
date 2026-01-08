import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Playwright configuration for E2E tests
 *
 * Simple setup:
 * - Uses dev ports (8000/5173) with reuseExistingServer: true
 * - If your dev servers are running, tests use them (fast, no zombie issues)
 * - If not running, Playwright starts them automatically
 *
 * Run tests:
 *   npx playwright test           # CLI mode
 *   npx playwright test --ui      # UI mode (uses your running dev servers)
 *
 * Best practice:
 *   1. Start your dev servers: npm run dev (frontend) + uvicorn (backend)
 *   2. Run tests in UI mode: npx playwright test --ui
 *   3. No zombie processes, no port conflicts!
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
    ['html', { outputFolder: 'test-results/html' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],

  // Output directory for test artifacts (screenshots, traces, videos)
  outputDir: 'test-results/artifacts',

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

  // Web server configuration
  // reuseExistingServer: true = use running servers if available, start if not
  // This eliminates zombie process issues!
  webServer: [
    {
      // Backend - use venv Python on Windows, system python elsewhere
      command: process.platform === 'win32'
        ? `.venv\\Scripts\\python.exe -m uvicorn app.main:app --port ${API_PORT}`
        : `python -m uvicorn app.main:app --port ${API_PORT}`,
      cwd: path.resolve(__dirname, '../backend'),
      port: API_PORT,
      reuseExistingServer: true, // Use running server if available
      timeout: 120000,
    },
    {
      // Frontend dev server
      // Set VITE_API_PORT so Vite's proxy targets the correct backend port
      command: process.platform === 'win32'
        ? `set VITE_API_PORT=${API_PORT}&& npm run dev -- --port ${FRONTEND_PORT}`
        : `VITE_API_PORT=${API_PORT} npm run dev -- --port ${FRONTEND_PORT}`,
      port: FRONTEND_PORT,
      reuseExistingServer: true, // Use running server if available
      timeout: 60000,
    },
  ],

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
});
