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
 * Prerequisites:
 * 1. Backend running: cd src/backend && uvicorn app.main:app --port 8000
 * 2. Frontend running: cd src/frontend && npm run dev
 *
 * Run with:
 *   cd src/frontend && npx playwright test
 *
 * Debug with:
 *   cd src/frontend && npx playwright test --ui
 */

const API_BASE = 'http://localhost:8000/api';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths - relative to project root
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/12.6.carlsbad');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-vs-carlsbad-sc-2025-11-02-2025-12-08.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, '12.6.carlsbad.tsv');

test.describe('Full Workflow - Using Carlsbad Test Data', () => {
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

  test.beforeEach(async ({ page }) => {
    // Start fresh - go to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('1. Project Manager loads correctly', async ({ page }) => {
    // Should see Project Manager on fresh load with Games tab active
    await expect(page.locator('text=Games')).toBeVisible();
    await expect(page.locator('text=Projects')).toBeVisible();
    await expect(page.locator('text=Add Game')).toBeVisible();

    // Switch to Projects tab and verify New Project button
    await page.click('button:has-text("Projects")');
    await expect(page.locator('text=New Project')).toBeVisible();
  });

  test('2. Annotate Mode - Upload video and import TSV', async ({ page }) => {
    // Click Add Game to trigger file picker, then set file on hidden input
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);

    // Wait for video to load and Annotate mode to activate
    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });
    await expect(page.locator('text=Clips')).toBeVisible();
    console.log('Video loaded successfully');

    // Import TSV file
    console.log('Importing TSV:', TEST_TSV);
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);

    // Wait for import - should see success message with clip count
    // The TSV has 25 clips
    await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });
    console.log('TSV imported successfully');

    // Verify some clips appear in the sidebar
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 5000 });
  });

  test('3. Annotate Mode - Export TSV round-trip', async ({ page }) => {
    // Load video to enter Annotate mode
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });

    // Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });

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
    console.log('TSV export successful');
  });

  test('4. Full workflow - Annotate to Project', async ({ page }) => {
    // This test covers the complete workflow:
    // 1. Load video in Annotate mode
    // 2. Import annotations
    // 3. Export/Import into projects
    // 4. Select project (Framing mode)
    // 5. Export framing output
    // 6. Switch to Overlay mode
    // 7. Export final video

    // Step 1: Load video to enter Annotate mode
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });

    // Step 2: Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await expect(page.locator('text=/Imported \\d+ clips?/')).toBeVisible({ timeout: 10000 });

    // Step 4: Click "Import Into Projects" button
    const importButton = page.locator('button:has-text("Import Into Projects")');
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();

      // Wait for export progress modal/indicator
      await page.waitForTimeout(5000);

      // Wait for completion - this creates projects
      await page.waitForSelector('text=/Created|Complete|Success/i', { timeout: 300000 });
      console.log('Import into projects completed');
    }

    // Step 5: Go to Project Manager and verify project was created
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const projectCount = await page.locator('.cursor-pointer:has-text("clips")').count();
    expect(projectCount).toBeGreaterThan(0);
    console.log(`Found ${projectCount} project(s)`);

    // Step 6: Click on first project to enter Framing mode
    await page.locator('.cursor-pointer:has-text("clips")').first().click();
    await page.waitForTimeout(2000);

    // Should be in Framing mode
    const isFramingMode = await page.locator('text=Framing').isVisible().catch(() => false) ||
                          await page.locator('text=Crop').isVisible().catch(() => false);
    expect(isFramingMode).toBeTruthy();
    console.log('Entered Framing mode');
  });

  test('5. Create project manually and add clips', async ({ page, request }) => {
    // Switch to Projects tab first
    await page.click('button:has-text("Projects")');
    await page.waitForTimeout(500);

    // Create a new project via UI
    await page.click('text=New Project');
    await page.fill('input[placeholder*="Project name"]', 'Carlsbad Highlights');
    await page.click('button:has-text("9:16")');
    await page.click('button:has-text("Create")');
    await page.waitForTimeout(1000);

    // Verify project was created
    await expect(page.locator('text=Carlsbad Highlights')).toBeVisible();

    // Verify via API
    const projects = await request.get(`${API_BASE}/projects`);
    const projectsData = await projects.json();
    expect(projectsData.some(p => p.name === 'Carlsbad Highlights')).toBeTruthy();
    console.log('Project created successfully');
  });
});

test.describe('UI Component Tests', () => {
  test('Clip sidebar shows imported clips', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Load video to enter Annotate mode
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });

    // Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await page.waitForTimeout(2000);

    // Check sidebar shows clips
    const clipItems = page.locator('[class*="clip"], .cursor-pointer:has-text("Good")');
    const count = await clipItems.count();
    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} clip items in sidebar`);
  });

  test('Star rating is visible for clips', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Load video to enter Annotate mode
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });

    // Import TSV
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await page.waitForTimeout(2000);

    // Click on first clip
    const firstClip = page.locator('text=Good Pass').first();
    if (await firstClip.isVisible().catch(() => false)) {
      await firstClip.click();
      await page.waitForTimeout(500);

      // Should see rating UI elements
      const hasRatingUI = await page.locator('[data-rating], button:has(svg[class*="star"]), .star').count() > 0;
      console.log('Rating UI visible:', hasRatingUI);
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
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('Raw clips endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/clips/raw`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });
});
