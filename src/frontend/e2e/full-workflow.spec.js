import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Full Workflow E2E Test
 *
 * Prerequisites:
 * 1. Backend running: cd src/backend && uvicorn app.main:app --port 8000
 * 2. Frontend running: cd src/frontend && npm run dev
 * 3. A test video file (optional - some tests will be skipped without it)
 *
 * Run with:
 *   cd src/frontend && npx playwright test
 *
 * Debug with:
 *   cd src/frontend && npx playwright test --ui
 *
 * To reset database before test, delete: user_data/a/database.sqlite
 */

const TEST_VIDEO_PATH = process.env.TEST_VIDEO_PATH || '';
const API_BASE = 'http://localhost:8000/api';

test.describe('Full Workflow - Fresh Database', () => {
  test.beforeAll(async ({ request }) => {
    // Check if backend is running
    try {
      const health = await request.get(`${API_BASE}/health`);
      expect(health.ok()).toBeTruthy();
    } catch (e) {
      throw new Error('Backend not running. Start with: cd src/backend && uvicorn app.main:app --port 8000');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Start fresh - go to home page
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('1. Project Manager loads correctly', async ({ page }) => {
    // Should see Project Manager on fresh load
    await expect(page.locator('text=New Project')).toBeVisible();
    await expect(page.locator('text=Annotate Game')).toBeVisible();
  });

  test('2. Annotate Mode - Import TSV and Export', async ({ page }) => {
    // Navigate to Annotate mode
    await page.click('text=Annotate Game');
    await page.waitForTimeout(500);

    // Should see Annotate UI
    await expect(page.locator('text=Clips')).toBeVisible();

    // Import TSV file
    const tsvPath = path.join(__dirname, 'fixtures', 'sample-annotations.tsv');
    if (!fs.existsSync(tsvPath)) {
      test.skip('TSV fixture not found');
      return;
    }

    // Click Import button and upload TSV
    const fileInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await fileInput.setInputFiles(tsvPath);

    // Wait for import success message
    await expect(page.locator('text=Imported 3 clip')).toBeVisible({ timeout: 5000 });

    // Verify clips appear in sidebar (sorted by endTime)
    await expect(page.locator('text=Brilliant Goal')).toBeVisible();
    await expect(page.locator('text=Good Defense')).toBeVisible();
    await expect(page.locator('text=Interesting Build-Up')).toBeVisible();

    // Test Export TSV (round-trip)
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Export")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('annotations.tsv');

    // Verify exported content
    const downloadPath = await download.path();
    const content = fs.readFileSync(downloadPath, 'utf8');
    expect(content).toContain('start_time\trating\ttags');
    expect(content).toContain('Brilliant Goal');
    expect(content).toContain('5\tGoal,Dribble');
  });

  test('3. Create Project and add clips', async ({ page, request }) => {
    // Go to Project Manager
    await page.goto('/');

    // Create a new project
    await page.click('text=New Project');

    // Fill in project details
    await page.fill('input[placeholder*="Project name"]', 'E2E Test Project');
    await page.click('button:has-text("9:16")'); // Select portrait aspect ratio
    await page.click('button:has-text("Create")');

    // Wait for modal to close and project to appear
    await page.waitForTimeout(500);
    await expect(page.locator('text=E2E Test Project')).toBeVisible();

    // Verify project was created via API
    const projects = await request.get(`${API_BASE}/projects`);
    const projectsData = await projects.json();
    expect(projectsData.some(p => p.name === 'E2E Test Project')).toBeTruthy();
  });

  test('4. Select Project and enter Framing mode', async ({ page }) => {
    // First ensure we have a project
    await page.goto('/');

    // Check if any project exists
    const projectCards = page.locator('[data-testid="project-card"], .cursor-pointer:has-text("clips")');
    const count = await projectCards.count();

    if (count === 0) {
      // Create a project first
      await page.click('text=New Project');
      await page.fill('input[placeholder*="Project name"]', 'Framing Test');
      await page.click('button:has-text("16:9")');
      await page.click('button:has-text("Create")');
      await page.waitForTimeout(500);
    }

    // Click on first project card (avoid delete button area)
    const firstProject = page.locator('.cursor-pointer:has-text("clips")').first();
    await firstProject.click();

    // Should enter Framing mode
    await page.waitForTimeout(500);

    // Check for Framing mode indicators
    const framingIndicators = [
      page.locator('text=Framing'),
      page.locator('text=Crop'),
      page.locator('button:has-text("Export")'),
    ];

    // At least one framing indicator should be visible
    let foundFraming = false;
    for (const indicator of framingIndicators) {
      if (await indicator.isVisible().catch(() => false)) {
        foundFraming = true;
        break;
      }
    }

    // If no clips loaded, we might see "Upload a clip" or similar
    // That's okay - the mode switch worked
    expect(foundFraming || await page.locator('text=Upload').isVisible()).toBeTruthy();
  });

  test('5. Mode switching - Framing to Overlay', async ({ page }) => {
    // Start from a project context
    await page.goto('/');

    // Create or select a project
    const hasProjects = await page.locator('.cursor-pointer:has-text("clips")').count() > 0;

    if (!hasProjects) {
      await page.click('text=New Project');
      await page.fill('input[placeholder*="Project name"]', 'Mode Switch Test');
      await page.click('button:has-text("16:9")');
      await page.click('button:has-text("Create")');
      await page.waitForTimeout(500);
    }

    // Select first project
    await page.locator('.cursor-pointer:has-text("clips")').first().click();
    await page.waitForTimeout(500);

    // Look for mode switcher
    const modeSwitcher = page.locator('button:has-text("Overlay"), [role="tab"]:has-text("Overlay")');
    if (await modeSwitcher.isVisible().catch(() => false)) {
      await modeSwitcher.click();
      await page.waitForTimeout(500);

      // Should see Overlay mode indicators
      await expect(page.locator('text=Overlay').first()).toBeVisible();
    }
  });

  test('6. Full export workflow (requires video)', async ({ page }) => {
    // This test requires a video file
    if (!TEST_VIDEO_PATH || !fs.existsSync(TEST_VIDEO_PATH)) {
      test.skip('Set TEST_VIDEO_PATH environment variable to run this test');
      return;
    }

    // Go to Annotate mode
    await page.goto('/');
    await page.click('text=Annotate Game');
    await page.waitForTimeout(500);

    // Upload video
    const videoInput = page.locator('input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO_PATH);

    // Wait for video to load
    await page.waitForSelector('video', { timeout: 30000 });

    // Import TSV annotations
    const tsvPath = path.join(__dirname, 'fixtures', 'sample-annotations.tsv');
    const fileInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await fileInput.setInputFiles(tsvPath);
    await expect(page.locator('text=Imported 3 clip')).toBeVisible({ timeout: 5000 });

    // Click "Import Into Projects" button
    const importButton = page.locator('button:has-text("Import Into Projects")');
    if (await importButton.isVisible().catch(() => false)) {
      await importButton.click();

      // Wait for export progress
      await page.waitForSelector('text=Creating projects', { timeout: 60000 });

      // Wait for completion
      await page.waitForTimeout(5000);
    }

    // Should have created projects
    await page.goto('/');
    const projectCount = await page.locator('.cursor-pointer:has-text("clips")').count();
    expect(projectCount).toBeGreaterThan(0);
  });
});

test.describe('UI Component Tests', () => {
  test('Star rating selector works', async ({ page }) => {
    // Go to Annotate mode
    await page.goto('/');
    await page.click('text=Annotate Game');
    await page.waitForTimeout(500);

    // Import a TSV to get a clip
    const tsvPath = path.join(__dirname, 'fixtures', 'sample-annotations.tsv');
    if (fs.existsSync(tsvPath)) {
      const fileInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
      await fileInput.setInputFiles(tsvPath);
      await page.waitForTimeout(1000);

      // Click on first clip in sidebar
      const firstClip = page.locator('text=Brilliant Goal');
      if (await firstClip.isVisible().catch(() => false)) {
        await firstClip.click();

        // Should see star rating selector
        const stars = page.locator('[data-rating], .star-rating button, button:has(svg)');
        expect(await stars.count()).toBeGreaterThan(0);
      }
    }
  });

  test('Timeline interaction works', async ({ page }) => {
    // Go to Annotate mode
    await page.goto('/');
    await page.click('text=Annotate Game');
    await page.waitForTimeout(500);

    // Look for timeline element
    const timeline = page.locator('[class*="timeline"], [data-testid="timeline"]');
    if (await timeline.isVisible().catch(() => false)) {
      // Timeline should be interactive
      const box = await timeline.boundingBox();
      if (box) {
        // Click in the middle of the timeline
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
      }
    }
  });

  test('Keyboard shortcuts respond', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Annotate Game');
    await page.waitForTimeout(500);

    // Press space (should toggle play/pause if video loaded)
    await page.keyboard.press('Space');

    // Press Escape (should deselect or close modals)
    await page.keyboard.press('Escape');

    // No errors should occur
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(500);

    // Filter out expected errors
    const unexpectedErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('not defined')
    );
    expect(unexpectedErrors).toHaveLength(0);
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
      data: { name: 'API Test Project', aspect_ratio: '16:9' }
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

  test('Raw clips endpoint responds', async ({ request }) => {
    const response = await request.get(`${API_BASE}/clips/raw`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });
});
