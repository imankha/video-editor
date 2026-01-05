import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Playwright configuration for E2E tests
 * Run with: npx playwright test
 * Debug with: npx playwright test --ui
 *
 * Test Isolation:
 * When webServer is enabled, the backend starts with TEST_USER_ID set to a unique
 * value per test run. This creates an isolated database namespace so test data
 * doesn't pollute the manual testing database (user "a").
 *
 * Manual testing should use the normal server without TEST_USER_ID:
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
    baseURL: 'http://localhost:5173',
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
      // Backend with TEST_USER_ID for isolation
      // The env property passes TEST_USER_ID to the subprocess
      command: 'python -m uvicorn app.main:app --port 8000',
      cwd: path.resolve(__dirname, '../backend'),
      port: 8000,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        ...process.env,
        TEST_USER_ID: TEST_USER_ID,
      },
    },
    {
      // Frontend dev server
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },

  // Global setup/teardown for test data cleanup
  globalSetup: undefined,
  globalTeardown: './e2e/global-teardown.js', // Cleans up old test_* directories
});
