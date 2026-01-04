import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 * Run with: npx playwright test
 * Debug with: npx playwright test --ui
 */
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
  timeout: 120000, // 2 minutes per test
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },
});
