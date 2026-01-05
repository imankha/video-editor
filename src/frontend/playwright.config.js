import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Playwright configuration for E2E tests
 * Run with: npx playwright test
 * Debug with: npx playwright test --ui
 *
 * Test Isolation:
 * 1. Backend runs on port 8001 (not 8000) to avoid conflicts with manual dev server
 * 2. TEST_USER_ID is set to a unique value per test run for database isolation
 * 3. Frontend uses VITE_API_PORT=8001 to connect to the test backend
 *
 * You can keep your manual dev server running on port 8000 while running E2E tests.
 *
 * Manual testing uses the normal server:
 *   cd src/backend && uvicorn app.main:app --port 8000
 */

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data directory - contains video and TSV files for testing
const TEST_DATA_DIR = path.resolve(__dirname, '../../formal annotations/12.6.carlsbad');

// Generate unique test user ID for this test run
// Format: test_YYYYMMDD_HHMMSS_random
const now = new Date();
const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const randomSuffix = Math.random().toString(36).substring(2, 8);
const TEST_USER_ID = `test_${dateStr}_${randomSuffix}`;

// E2E test ports - different from dev server ports for isolation
const E2E_API_PORT = 8001;      // Backend port (dev uses 8000)
const E2E_FRONTEND_PORT = 5174; // Frontend port (dev uses 5173)

// Check if we should use automatic server startup
// Set MANUAL_SERVERS=1 to skip automatic startup (for debugging)
const useManualServers = process.env.MANUAL_SERVERS === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests sequentially for workflow tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for sequential tests
  reporter: 'html',

  use: {
    baseURL: `http://localhost:${E2E_FRONTEND_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pass test data paths to tests
    testDataDir: TEST_DATA_DIR,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Web server configuration
  // Starts both backend and frontend with test isolation
  webServer: useManualServers ? undefined : [
    {
      // Backend on port 8001 (not 8000) for isolation from manual dev server
      // TEST_USER_ID creates isolated database namespace
      // Use venv Python on Windows, system python elsewhere
      command: process.platform === 'win32'
        ? `.venv\\Scripts\\python.exe -m uvicorn app.main:app --port ${E2E_API_PORT}`
        : `python -m uvicorn app.main:app --port ${E2E_API_PORT}`,
      cwd: path.resolve(__dirname, '../backend'),
      port: E2E_API_PORT,
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ...process.env,
        TEST_USER_ID: TEST_USER_ID,
      },
    },
    {
      // Frontend dev server on different port, configured to use test backend
      // Uses port 5174 (not 5173) to avoid conflicts with manual dev server
      command: `npm run dev -- --port ${E2E_FRONTEND_PORT}`,
      port: E2E_FRONTEND_PORT,
      reuseExistingServer: false, // Must start fresh with test API port
      timeout: 60000,
      env: {
        ...process.env,
        VITE_API_PORT: String(E2E_API_PORT),
      },
    },
  ],

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown
  globalSetup: './e2e/global-setup.js',    // Checks port availability, displays test info
  globalTeardown: './e2e/global-teardown.js', // Cleans up old test_* directories
});
