import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for E2E tests
 * Run with: npx playwright test
 * Debug with: npx playwright test --ui
 */

// Test data directory - contains video and TSV files for testing
const TEST_DATA_DIR = path.resolve(__dirname, '../../formal annotations/12.6.carlsbad');

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

  // Expect frontend and backend to be running
  // Start them manually before running tests:
  //   Terminal 1: cd src/backend && uvicorn app.main:app --port 8000
  //   Terminal 2: cd src/frontend && npm run dev
  webServer: undefined, // Manual server start for now

  // Increase timeout for video processing operations
  timeout: 300000, // 5 minutes per test (video uploads take time)
  expect: {
    timeout: 60000, // 60 seconds for assertions
  },
});
