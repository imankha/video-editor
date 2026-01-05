import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Full Workflow E2E Test
 *
 * Uses test data from: formal annotations/12.6.carlsbad/
 * - Video: wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4
 * - TSV: 12.6.carlsbad.tsv
 *
 * OPTIMIZATION: The video is uploaded ONCE at the start of the suite.
 * All tests that need annotate mode load the saved game instead of re-uploading.
 *
 * Run with:
 *   cd src/frontend && npx playwright test
 *
 * Debug with:
 *   cd src/frontend && npx playwright test --ui
 */

// E2E tests run on port 8001 (see playwright.config.js)
const API_BASE = 'http://localhost:8001/api';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths - relative to project root
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/12.6.carlsbad');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, '12.6.carlsbad.tsv');

// Shared state for the test suite
let sharedGameUploaded = false;

/**
 * Helper: Upload video and import TSV (only called once per suite)
 */
async function uploadGameOnce(page) {
  if (sharedGameUploaded) {
    console.log('[Setup] Game already uploaded, loading from Games tab');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);

    // Try to load existing game
    const loadButton = page.locator('button:has-text("Load")').first();
    if (await loadButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loadButton.click();
      await expect(page.locator('video')).toBeVisible({ timeout: 30000 });
      return;
    }
    // If no game found, fall through to upload
    console.log('[Setup] No existing game found, uploading fresh');
  }

  console.log('[Setup] Uploading video...');
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const videoInput = page.locator('input[type="file"][accept*="video"]');
  await videoInput.setInputFiles(TEST_VIDEO);
  await expect(page.locator('video')).toBeVisible({ timeout: 120000 });
  console.log('[Setup] Video loaded');

  // Import TSV
  console.log('[Setup] Importing TSV...');
  const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
  await tsvInput.setInputFiles(TEST_TSV);
  await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });
  console.log('[Setup] TSV imported');

  // Wait for auto-save
  await page.waitForTimeout(2000);
  sharedGameUploaded = true;
}

/**
 * Helper: Enter annotate mode with existing game or upload if needed
 */
async function enterAnnotateMode(page) {
  await uploadGameOnce(page);
}

// ============================================================================
// Test Suites
// ============================================================================

test.describe('Full Workflow Tests', () => {
  test.beforeAll(async ({ request }) => {
    // Check if backend is running
    try {
      const health = await request.get(`${API_BASE}/health`);
      expect(health.ok()).toBeTruthy();
    } catch (e) {
      throw new Error('Backend not running. Start with: cd src/backend && uvicorn app.main:app --port 8000');
    }

    // Check if test files exist
    if (!fs.existsSync(TEST_VIDEO)) {
      throw new Error(`Test video not found: ${TEST_VIDEO}`);
    }
    if (!fs.existsSync(TEST_TSV)) {
      throw new Error(`Test TSV not found: ${TEST_TSV}`);
    }
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
    // This test does the initial upload (will be reused by subsequent tests)
    await uploadGameOnce(page);

    // Verify annotate mode is active
    await expect(page.getByRole('heading', { name: 'Clips' })).toBeVisible();
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });
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
    expect(content).toContain('Good Pass');
    expect(content).toContain('Great Dribbling');
  });

  test('4. Import button is visible in annotate mode', async ({ page }) => {
    await enterAnnotateMode(page);

    // Verify "Import Into Projects" button is visible and enabled
    const importButton = page.locator('button:has-text("Import Into Projects")');
    await expect(importButton).toBeVisible({ timeout: 5000 });

    // Button should be enabled when we have clips
    const isDisabled = await importButton.getAttribute('disabled');
    expect(isDisabled).toBeNull(); // null means not disabled
  });

  test('5. Create project manually', async ({ page, request }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(500);

    // Create a new project
    await page.locator('button:has-text("New Project")').click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder('My Highlight Reel').fill('Carlsbad Highlights');
    await page.locator('button:has-text("9:16")').click();
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(1000);

    // Verify project was created
    await expect(page.locator('text=Carlsbad Highlights').first()).toBeVisible();

    // Verify via API
    const projects = await request.get(`${API_BASE}/projects`);
    const projectsData = await projects.json();
    expect(projectsData.some(p => p.name === 'Carlsbad Highlights')).toBeTruthy();
  });
});

test.describe('Clip Editing Tests', () => {
  test('Edit clip rating via UI', async ({ page }) => {
    await enterAnnotateMode(page);

    // Click on first clip
    const firstClip = page.locator('[title*="Good Pass"]').first();
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
    const firstClip = page.locator('[title*="Good Pass"]').first();
    await firstClip.click({ force: true });
    await page.waitForTimeout(500);

    // Edit clip name
    const nameInput = page.locator('input[value*="Good Pass"]').first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Edited Clip Name');
      await page.waitForTimeout(500);
      await expect(page.locator('[title*="Edited Clip Name"]').first()).toBeVisible();
    }
  });
});

test.describe('UI Component Tests', () => {
  test('Clip sidebar shows imported clips', async ({ page }) => {
    await enterAnnotateMode(page);

    // Wait for clips to load, then check for clip items by title attribute
    await page.waitForTimeout(1000);
    const clipItems = page.locator('[title*="Good Pass"], [title*="Great Dribbling"]');
    const count = await clipItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Star rating is visible for clips', async ({ page }) => {
    await enterAnnotateMode(page);

    const firstClip = page.locator('[title*="Good Pass"]').first();
    if (await firstClip.isVisible().catch(() => false)) {
      await firstClip.click({ force: true });
      await page.waitForTimeout(500);
      const hasRatingUI = await page.locator('svg.lucide-star').count() > 0;
      expect(hasRatingUI).toBeTruthy();
    }
  });
});

test.describe('API Integration Tests', () => {
  test('Health endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.status).toBe('healthy');
  });

  test('Projects CRUD works', async ({ request }) => {
    // Create
    const createResponse = await request.post(`${API_BASE}/projects`, {
      data: { name: 'E2E Test Project', aspect_ratio: '16:9' }
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = await createResponse.json();
    expect(created.id).toBeDefined();

    // Read
    const readResponse = await request.get(`${API_BASE}/projects/${created.id}`);
    expect(readResponse.ok()).toBeTruthy();

    // Delete
    const deleteResponse = await request.delete(`${API_BASE}/projects/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
  });

  test('Games list endpoint works', async ({ request }) => {
    const response = await request.get(`${API_BASE}/games`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.games).toBeDefined();
    expect(Array.isArray(data.games)).toBeTruthy();
  });

  test('Raw clips endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/clips/raw`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('Games CRUD works', async ({ request }) => {
    const listResponse = await request.get(`${API_BASE}/games`);
    expect(listResponse.ok()).toBeTruthy();
    const listData = await listResponse.json();
    expect(listData.games).toBeDefined();

    if (listData.games.length > 0) {
      const gameId = listData.games[0].id;
      const getResponse = await request.get(`${API_BASE}/games/${gameId}`);
      expect(getResponse.ok()).toBeTruthy();
      const gameData = await getResponse.json();
      expect(gameData.id).toBe(gameId);
    }
  });

  test('Clips by project endpoint works', async ({ request }) => {
    // Create project
    const createResponse = await request.post(`${API_BASE}/projects`, {
      data: { name: 'Clips Test Project', aspect_ratio: '9:16' }
    });
    expect(createResponse.ok()).toBeTruthy();
    const project = await createResponse.json();

    // Get clips
    const clipsResponse = await request.get(`${API_BASE}/clips/projects/${project.id}/clips`);
    expect(clipsResponse.ok()).toBeTruthy();
    const clips = await clipsResponse.json();
    expect(Array.isArray(clips)).toBeTruthy();

    // Cleanup
    await request.delete(`${API_BASE}/projects/${project.id}`);
  });
});
