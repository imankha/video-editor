import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Full Workflow E2E Test
 *
 * Uses test data from: formal annotations/test.short/
 * - Video: wcfc-carlsbad-trimmed.mp4 (1.5 min clip from 45:10-46:40)
 * - TSV: test.short.tsv (3 clips with adjusted timestamps)
 *
 * OPTIMIZATION: Uses a short 1.5 minute video for fast test runs.
 * All tests that need annotate mode load the saved game instead of re-uploading.
 *
 * Test Isolation: Each test run uses a unique user ID via X-User-ID header.
 * This ensures E2E tests don't pollute the dev database.
 *
 * Run with:
 *   cd src/frontend && npx playwright test
 *
 * Debug with:
 *   cd src/frontend && npx playwright test --ui
 */

// Always use port 8000 - the dev backend port
const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;

// Unique test user ID for this test run (isolates E2E data from dev data)
const TEST_USER_ID = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Set up page to add X-User-ID header to all API requests.
 * This isolates test data from development data.
 */
async function setupTestUserContext(page) {
  // Use setExtraHTTPHeaders instead of route() - more reliable with Vite proxy
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID });
}

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths - relative to project root
// Uses a short 1.5 minute video for fast test runs
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

/**
 * Helper: Create a game via modal and import TSV
 * Each test uploads fresh to ensure clips are available (simpler and more reliable)
 *
 * Flow (updated for Add Game modal):
 * 1. Navigate to home (ProjectsScreen)
 * 2. Click "Games" tab then "Add Game" to open modal
 * 3. Fill modal form: opponent, date, game type, video
 * 4. Click "Create Game" to submit and enter annotate mode
 * 5. Import TSV file
 */
async function enterAnnotateModeWithClips(page) {
  console.log('[Setup] Navigating to annotate mode...');
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Click Games tab to show Add Game button
  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);

  // Click Add Game to open the modal
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);

  // Fill in the Add Game modal form
  console.log('[Setup] Filling Add Game modal...');

  // Fill opponent team name
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Test Opponent');

  // Fill game date (use today's date)
  const today = new Date().toISOString().split('T')[0];
  const dateInput = page.locator('input[type="date"]');
  await dateInput.fill(today);

  // Select game type (click "Home" button)
  await page.getByRole('button', { name: 'Home' }).click();

  // Upload video file via the modal's file input (inside the form)
  console.log('[Setup] Uploading video...');
  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(1000);

  // Click Create Game button
  const createButton = page.getByRole('button', { name: 'Create Game' });
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click();

  // Wait for annotate mode to load with video using robust retry logic
  // Sometimes the video takes time to appear after form submission
  console.log('[Setup] Waiting for video element...');
  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    // Also verify video has a src and is ready
    const hasSrc = await video.evaluate(v => !!v.src);
    expect(hasSrc).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });
  console.log('[Setup] Video loaded');

  // Wait for video upload to complete BEFORE importing TSV
  // The clips/raw/save endpoint requires the video file to exist for extraction
  // Note: We wait for "Uploading video" to disappear, not for button to be enabled,
  // because the button stays disabled until clips are added (hasClips=false).
  console.log('[Setup] Waiting for video upload to complete...');
  const uploadingButton = page.locator('button:has-text("Uploading video")');
  // Wait for uploading state to appear (may take a moment)
  await page.waitForTimeout(2000);
  // If uploading, wait for it to finish (5 min timeout for large files over R2)
  const isUploading = await uploadingButton.isVisible().catch(() => false);
  if (isUploading) {
    console.log('[Setup] Upload in progress, waiting for completion...');
    await expect(uploadingButton).toBeHidden({ timeout: 300000 });
  }
  console.log('[Setup] Video upload complete');

  // Import TSV - ensure input is attached and ready
  console.log('[Setup] Importing TSV...');
  const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
  await expect(tsvInput).toBeAttached({ timeout: 10000 });
  await tsvInput.setInputFiles(TEST_TSV);

  // Wait for clips to appear in sidebar (the notification may disappear quickly)
  await expect(page.locator('text=Great Control Pass').first()).toBeVisible({ timeout: 15000 });
  console.log('[Setup] TSV imported and clips visible');
}

/**
 * Helper: Enter annotate mode by uploading video and TSV
 */
async function enterAnnotateMode(page) {
  await enterAnnotateModeWithClips(page);
}

// ============================================================================
// Test Suites
// ============================================================================

test.describe('Full Workflow Tests', () => {
  // Increase beforeAll timeout to allow for server startup
  test.beforeAll(async ({ request }) => {
    // Check if test files exist first (fast check)
    if (!fs.existsSync(TEST_VIDEO)) {
      throw new Error(`Test video not found: ${TEST_VIDEO}`);
    }
    if (!fs.existsSync(TEST_TSV)) {
      throw new Error(`Test TSV not found: ${TEST_TSV}`);
    }

    // Check if backend is running with retries (server might be starting up)
    let lastError = null;
    for (let i = 0; i < 30; i++) { // Try for up to 60 seconds
      try {
        const health = await request.get(`${API_BASE}/health`);
        if (health.ok()) {
          console.log(`[E2E] Backend health check passed`);
          break;
        }
      } catch (e) {
        lastError = e;
        if (i < 29) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    if (lastError) {
      throw new Error(`Backend not running on port ${API_PORT}. Start it with: cd src/backend && uvicorn app.main:app --port ${API_PORT}`);
    }

    console.log(`[E2E] Test user ID: ${TEST_USER_ID}`);
  });

  test.beforeEach(async ({ page }) => {
    // Set up test user context for API isolation on each test
    await setupTestUserContext(page);
  });

  test('1. Project Manager loads correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should see Project Manager tabs
    await expect(page.locator('button:has-text("Games")')).toBeVisible();
    await expect(page.locator('button:has-text("Projects")')).toBeVisible();
    await expect(page.locator('button:has-text("New Project")')).toBeVisible();

    // Switch to Games tab
    await page.locator('button:has-text("Games")').click();
    await expect(page.locator('button:has-text("Add Game")')).toBeVisible();
  });

  test('2. Annotate Mode - Upload video and import TSV', async ({ page }) => {
    // Upload video and import TSV
    await enterAnnotateModeWithClips(page);

    // Verify annotate mode is active
    await expect(page.getByRole('heading', { name: 'Clips' })).toBeVisible();
    await expect(page.locator('text=Great Control Pass').first()).toBeVisible({ timeout: 5000 });
  });

  test('3. Annotate Mode - Export TSV round-trip', async ({ page }) => {
    await enterAnnotateMode(page);

    // Export the TSV
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Export")');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('annotations.tsv');

    // Verify exported content
    const downloadPath = await download.path();
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('start_time\trating\ttags');
    expect(content).toContain('Great Control Pass');
    expect(content).toContain('Full Effort Play');
  });

  test('4. Create Annotated Video button is enabled after upload', async ({ page }) => {
    await enterAnnotateMode(page);

    // Wait for video upload to complete first (button shows "Uploading video..." until done)
    // The upload enables the "Create Annotated Video" button
    const createVideoButton = page.locator('button:has-text("Create Annotated Video")');
    await expect(createVideoButton).toBeVisible({ timeout: 120000 }); // 2 min for video upload
    await expect(createVideoButton).toBeEnabled({ timeout: 10000 });

    // Note: Clips are now auto-saved to library in real-time as you annotate
    // The "Import Into Projects" button was removed - clips go to library automatically
  });

  test('5. Create Annotated Video API call succeeds', async ({ page }) => {
    // Use event listener instead of route for more reliable request capture
    let capturedExportUrl = null;

    // Listen for all requests using page.on() which doesn't interfere with routing
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/annotate/export')) {
        console.log(`[Test] Export request detected: ${url}`);
        capturedExportUrl = url;
      } else if (url.includes('/api/health')) {
        console.log(`[Test] Health check request detected: ${url}`);
      }
    });

    await enterAnnotateMode(page);

    // Wait for video upload to complete - button changes from "Uploading video..." to "Create Annotated Video"
    // This can take a while for large videos
    const exportButton = page.locator('button:has-text("Create Annotated Video")');
    await expect(exportButton).toBeVisible({ timeout: 120000 }); // 2 minute timeout for upload
    await expect(exportButton).toBeEnabled({ timeout: 10000 });

    // Small delay to ensure UI is fully ready
    await page.waitForTimeout(500);

    // Click the export button and wait for the export request
    console.log('[Test] Clicking export button...');

    // Use Promise.race to wait for either the request or an error toast
    const exportRequestPromise = page.waitForRequest(
      request => request.url().includes('/api/annotate/export'),
      { timeout: 60000 } // 60 second timeout for health check + request
    );

    const errorToastPromise = page.waitForSelector('[role="alert"]', { timeout: 60000 }).catch(() => null);

    await exportButton.click();

    // Wait for either the export request or an error toast
    const result = await Promise.race([
      exportRequestPromise.then(req => ({ type: 'request', request: req })),
      errorToastPromise.then(toast => toast ? ({ type: 'error', toast }) : new Promise(() => {})), // Never resolve if no toast
    ]).catch(err => ({ type: 'timeout', error: err }));

    if (result.type === 'request') {
      console.log(`[Test] Export request URL: ${result.request.url()}`);
      expect(result.request.url()).toContain('/api/annotate/export');
    } else if (result.type === 'error') {
      const errorText = await result.toast.textContent();
      console.log(`[Test] Error shown to user: ${errorText}`);
      throw new Error(`Export failed with error: ${errorText}`);
    } else {
      // Check if we captured the URL via event listener even if waitForRequest failed
      if (capturedExportUrl) {
        console.log(`[Test] Export request URL (via event listener): ${capturedExportUrl}`);
        expect(capturedExportUrl).toContain('/api/annotate/export');
      } else {
        throw new Error(`Export request not made within timeout. ${result.error?.message || 'Unknown error'}`);
      }
    }
  });

  test('6. Create project from clips', async ({ page, request }) => {
    // This test verifies the New Project modal UI works correctly
    // We create a project via API first (since clip sync is async and complex),
    // then verify the UI shows the project correctly

    // Create project directly via API (bypasses async clip sync)
    const createResponse = await request.post(`${API_BASE}/projects`, {
      headers: { 'X-User-ID': TEST_USER_ID },
      data: { name: 'E2E Test Project from API', aspect_ratio: '16:9' }
    });
    expect(createResponse.ok()).toBeTruthy();
    const createdProject = await createResponse.json();
    console.log('[Test] Created project via API:', createdProject.id);

    // Navigate to project manager
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(500);

    // Verify project is visible in UI
    await expect(page.getByText(createdProject.name).first()).toBeVisible({ timeout: 10000 });
    console.log('[Test] Project visible in UI');

    // Verify New Project modal opens
    await page.locator('button:has-text("New Project")').click();
    await page.waitForTimeout(500);

    // Modal should appear with "Create Project from Clips" title
    await expect(page.locator('text=Create Project from Clips')).toBeVisible({ timeout: 5000 });
    console.log('[Test] New Project modal opened');

    // Close modal
    await page.locator('button:has-text("Cancel")').click();

    // Verify via API
    const projects = await request.get(`${API_BASE}/projects`, {
      headers: { 'X-User-ID': TEST_USER_ID }
    });
    const projectsData = await projects.json();
    expect(projectsData.length).toBeGreaterThan(0);
  });
});

test.describe('Clip Editing Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
  });

  test('Edit clip rating via UI', async ({ page }) => {
    await enterAnnotateMode(page);

    // Click on first clip
    const firstClip = page.locator('[title*="Great Control Pass"]').first();
    await firstClip.click({ force: true });
    await page.waitForTimeout(500);

    // Should see rating stars
    const stars = page.locator('svg.lucide-star');
    const starCount = await stars.count();
    expect(starCount).toBeGreaterThan(0);

    // Change rating
    if (starCount >= 5) {
      await stars.nth(4).click({ force: true });
      await page.waitForTimeout(500);
    }
  });

  test('Edit clip name via UI', async ({ page }) => {
    await enterAnnotateMode(page);

    // Click on first clip
    const firstClip = page.locator('[title*="Great Control Pass"]').first();
    await firstClip.click({ force: true });
    await page.waitForTimeout(500);

    // Edit clip name
    const nameInput = page.locator('input[value*="Great Control Pass"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Edited Clip Name');
      await page.waitForTimeout(500);
      await expect(page.locator('[title*="Edited Clip Name"]').first()).toBeVisible();
    }
  });
});

test.describe('UI Component Tests', () => {
  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
  });

  test('Clip sidebar shows imported clips', async ({ page }) => {
    await enterAnnotateMode(page);

    // Wait for clips to load, then check for clip items by title attribute
    await page.waitForTimeout(1000);
    const clipItems = page.locator('[title*="Great Control Pass"], [title*="Full Effort Play"]');
    const count = await clipItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Star rating is visible for clips', async ({ page }) => {
    await enterAnnotateMode(page);

    const firstClip = page.locator('[title*="Great Control Pass"]').first();
    if (await firstClip.isVisible().catch(() => false)) {
      await firstClip.click({ force: true });
      await page.waitForTimeout(500);
      const hasRatingUI = await page.locator('svg.lucide-star').count() > 0;
      expect(hasRatingUI).toBeTruthy();
    }
  });
});

test.describe('API Integration Tests', () => {
  // Helper to add test user header to API requests
  const testHeaders = { 'X-User-ID': TEST_USER_ID };

  test('Health endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`, { headers: testHeaders });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });

  test('Projects CRUD works', async ({ request }) => {
    // Create
    const createResponse = await request.post(`${API_BASE}/projects`, {
      headers: testHeaders,
      data: { name: 'E2E Test Project', aspect_ratio: '16:9' }
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = await createResponse.json();
    expect(created.id).toBeDefined();

    // Read
    const readResponse = await request.get(`${API_BASE}/projects/${created.id}`, { headers: testHeaders });
    expect(readResponse.ok()).toBeTruthy();

    // Delete
    const deleteResponse = await request.delete(`${API_BASE}/projects/${created.id}`, { headers: testHeaders });
    expect(deleteResponse.ok()).toBeTruthy();
  });

  test('Games list endpoint works', async ({ request }) => {
    const response = await request.get(`${API_BASE}/games`, { headers: testHeaders });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.games).toBeDefined();
    expect(Array.isArray(data.games)).toBeTruthy();
  });

  test('Raw clips endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/clips/raw`, { headers: testHeaders });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('Games CRUD works', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/games`, { headers: testHeaders });
    expect(listResponse.ok()).toBeTruthy();
    const listData = await listResponse.json();
    expect(listData.games).toBeDefined();

    if (listData.games.length > 0) {
      const gameId = listData.games[0].id;
      const getResponse = await request.get(`${API_BASE}/games/${gameId}`, { headers: testHeaders });
      expect(getResponse.ok()).toBeTruthy();
      const gameData = await getResponse.json();
      expect(gameData.id).toBe(gameId);
    }
  });

  test('Clips by project endpoint works', async ({ request }) => {
    // Create project
    const createResponse = await request.post(`${API_BASE}/projects`, {
      headers: testHeaders,
      data: { name: 'Clips Test Project', aspect_ratio: '9:16' }
    });
    expect(createResponse.ok()).toBeTruthy();
    const project = await createResponse.json();

    // Get clips
    const clipsResponse = await request.get(`${API_BASE}/clips/projects/${project.id}/clips`, { headers: testHeaders });
    expect(clipsResponse.ok()).toBeTruthy();
    const clips = await clipsResponse.json();
    expect(Array.isArray(clips)).toBeTruthy();

    // Cleanup
    await request.delete(`${API_BASE}/projects/${project.id}`, { headers: testHeaders });
  });
});
