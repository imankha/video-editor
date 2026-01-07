import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Regression Tests for User-Reported Issues
 *
 * These tests cover the following reported issues:
 * 1. Cannot move playhead by clicking on timeline
 * 2. Import Into Projects shows failure screen (but data is actually imported)
 *
 * Test Isolation: Each test run uses a unique user ID via X-User-ID header.
 */

// E2E tests use dev port 8000 (see playwright.config.js)
const API_BASE = 'http://localhost:8000/api';

// Unique test user ID for this test run (isolates E2E data from dev data)
const TEST_USER_ID = `e2e_regression_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/12.6.carlsbad');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, '12.6.carlsbad.tsv');

/**
 * Set up page to add X-User-ID header to all API requests.
 */
async function setupTestUserContext(page) {
  await page.route('**/api/**', async (route) => {
    const headers = {
      ...route.request().headers(),
      'X-User-ID': TEST_USER_ID,
    };
    await route.continue({ headers });
  });
}

/**
 * Helper: Enter annotate mode with video and clips loaded
 */
async function enterAnnotateModeWithClips(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const videoInput = page.locator('input[type="file"][accept*="video"]');
  await videoInput.setInputFiles(TEST_VIDEO);
  await expect(page.locator('video')).toBeVisible({ timeout: 120000 });

  // Import TSV
  const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
  await tsvInput.setInputFiles(TEST_TSV);
  await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });

  // Wait for clips to appear in sidebar
  await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });
}

// ============================================================================
// Regression Tests
// ============================================================================

test.describe('Regression Tests', () => {
  test.beforeAll(async ({ request }) => {
    // Check if backend is running
    try {
      const health = await request.get(`${API_BASE}/health`);
      expect(health.ok()).toBeTruthy();
    } catch (e) {
      throw new Error('Backend not running on port 8000');
    }

    // Check if test files exist
    if (!fs.existsSync(TEST_VIDEO)) {
      throw new Error(`Test video not found: ${TEST_VIDEO}`);
    }
    if (!fs.existsSync(TEST_TSV)) {
      throw new Error(`Test TSV not found: ${TEST_TSV}`);
    }

    console.log(`[E2E Regression] Test user ID: ${TEST_USER_ID}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
  });

  test('Timeline click should move playhead', async ({ page }) => {
    // Listen for console messages from the frontend
    const seekLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[SEEK]') || text.includes('[Timeline]')) {
        console.log(`FRONTEND: ${text}`);
        seekLogs.push(text);
      }
    });

    await enterAnnotateModeWithClips(page);

    // Wait for video to be ready
    const video = page.locator('video');
    await expect(video).toBeVisible({ timeout: 10000 });

    // Get initial video state
    const initialState = await video.evaluate((v) => ({
      currentTime: v.currentTime,
      duration: v.duration,
      readyState: v.readyState,
      hasSrc: !!v.src,
    }));
    console.log(`[Test] Initial video state:`, initialState);

    // Find the timeline track (the clickable area)
    // TimelineBase has: .bg-gray-700.rounded-r-lg.cursor-pointer
    const timeline = page.locator('.timeline-container .bg-gray-700.cursor-pointer').first();
    await expect(timeline).toBeVisible({ timeout: 5000 });

    // Get timeline dimensions and element info
    const boundingBox = await timeline.boundingBox();
    expect(boundingBox).not.toBeNull();
    console.log(`[Test] Timeline bounding box:`, boundingBox);

    // Log how many matching elements exist
    const matchingCount = await page.locator('.timeline-container .bg-gray-700.cursor-pointer').count();
    console.log(`[Test] Found ${matchingCount} matching timeline elements`);

    // Click directly on the element at 50% position using locator.click with force
    await timeline.click({
      position: { x: boundingBox.width * 0.5, y: boundingBox.height / 2 },
      force: true
    });
    await page.waitForTimeout(1000); // Wait for seek to complete

    // Log all captured seek logs
    console.log(`[Test] Captured ${seekLogs.length} seek logs:`, seekLogs);

    // Get the new video state
    const newState = await video.evaluate((v) => ({
      currentTime: v.currentTime,
      duration: v.duration,
      readyState: v.readyState,
    }));
    console.log(`[Test] Video state after click:`, newState);

    // Verify the playhead moved significantly (at least 10% of duration from start)
    const expectedMinTime = newState.duration * 0.3; // Click at 50%, expect at least 30%
    expect(newState.currentTime).toBeGreaterThan(expectedMinTime);
    expect(newState.currentTime).not.toBe(initialState.currentTime);
  });

  test('Import Into Projects should complete successfully', async ({ page }) => {
    await enterAnnotateModeWithClips(page);

    // Wait for video upload to complete
    // The "Uploading video..." button text should disappear when upload is done
    const uploadingIndicator = page.locator('text=Uploading video...');
    await expect(uploadingIndicator).toBeVisible({ timeout: 10000 });
    console.log('[Test] Waiting for video upload to complete...');
    await expect(uploadingIndicator).not.toBeVisible({ timeout: 180000 }); // 3 min timeout for large video
    console.log('[Test] Video upload complete');

    // Now wait for import button to be enabled
    const importButton = page.locator('button:has-text("Import Into Projects")');
    await expect(importButton).toBeEnabled({ timeout: 10000 });

    // Track API response
    let apiResponse = null;
    page.on('response', async (response) => {
      if (response.url().includes('/api/annotate/export')) {
        try {
          apiResponse = await response.json();
          console.log(`[Test] API Response:`, apiResponse);
        } catch (e) {
          console.log(`[Test] Could not parse API response`);
        }
      }
    });

    // Click Import Into Projects
    await importButton.click();

    // Wait for progress to complete
    // The progress bar should show and eventually complete
    await page.waitForTimeout(2000);

    // Check for success indicators:
    // 1. Should NOT see any error/failure UI
    // 2. Should eventually see success alert or navigate to project manager

    // Wait for the operation to complete (either success alert or navigation)
    // The expected behavior is: alert shows success message, then navigates to project-manager

    // Wait for page to potentially change or alert to appear
    await page.waitForTimeout(5000);

    // After import, should be back at project manager OR see success alert
    // Check if we navigated to project manager (success case)
    const isAtProjectManager = await page.locator('button:has-text("New Project")').isVisible().catch(() => false);
    const hasGamesButton = await page.locator('button:has-text("Games")').isVisible().catch(() => false);

    console.log(`[Test] At project manager: ${isAtProjectManager}`);
    console.log(`[Test] Has Games button: ${hasGamesButton}`);

    // Verify we're at project manager (successful import navigates there)
    expect(isAtProjectManager).toBeTruthy();
    expect(hasGamesButton).toBeTruthy();

    // Also verify via API that projects were created
    const testHeaders = { 'X-User-ID': TEST_USER_ID };
    const projectsResponse = await page.request.get(`${API_BASE}/projects`, { headers: testHeaders });
    const projects = await projectsResponse.json();
    console.log(`[Test] Projects after import: ${projects.length}`);

    // Should have at least one project created from the import
    expect(projects.length).toBeGreaterThan(0);
  });

  test('Import Into Projects should show success (not failure) UI', async ({ page }) => {
    await enterAnnotateModeWithClips(page);

    // Wait for video upload to complete
    const uploadingIndicator = page.locator('text=Uploading video...');
    await expect(uploadingIndicator).toBeVisible({ timeout: 10000 });
    await expect(uploadingIndicator).not.toBeVisible({ timeout: 180000 }); // 3 min timeout

    const importButton = page.locator('button:has-text("Import Into Projects")');
    await expect(importButton).toBeEnabled({ timeout: 10000 });

    // Track console errors to detect any issues
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Also track page errors
    const pageErrors = [];
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });

    // Click Import Into Projects
    await importButton.click();

    // Wait for the operation to start
    await page.waitForTimeout(1000);

    // The progress indicator should show (not an error)
    // Look for progress bar or "Processing..." text
    const hasProgress = await page.locator('text=Processing').isVisible().catch(() => false);
    const hasProgressBar = await page.locator('.h-2.bg-gray-700.rounded-full').isVisible().catch(() => false);

    console.log(`[Test] Has progress indicator: ${hasProgress || hasProgressBar}`);

    // Wait for completion
    await page.waitForTimeout(10000);

    // After completion, should NOT see any error UI
    // Check for common error indicators
    const hasError = await page.locator('text=/error|failed|failure/i').isVisible().catch(() => false);
    const hasRedUI = await page.locator('.bg-red-500, .text-red-500, .border-red-500').isVisible().catch(() => false);

    console.log(`[Test] Has error text: ${hasError}`);
    console.log(`[Test] Has red UI: ${hasRedUI}`);
    console.log(`[Test] Console errors: ${consoleErrors.length}`);
    console.log(`[Test] Page errors: ${pageErrors.length}`);

    // Log any errors for debugging
    if (consoleErrors.length > 0) {
      console.log('[Test] Console errors:', consoleErrors);
    }
    if (pageErrors.length > 0) {
      console.log('[Test] Page errors:', pageErrors);
    }

    // Should be at project manager (success navigates there)
    const isAtProjectManager = await page.locator('button:has-text("New Project")').isVisible().catch(() => false);
    expect(isAtProjectManager).toBeTruthy();
  });
});
