import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Request Storm Regression Test
 *
 * Verifies that the getGame() in-flight deduplication fix prevents request storms
 * when opening games with many clips. The original bug created 100-150+ concurrent
 * GET /api/games/{id} requests, saturating the backend.
 *
 * Commits: a8f27108, 0f52c37b
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_reqstorm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');

async function setupTestUserContext(page) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': TEST_USER_ID,
    'X-Test-Mode': 'true',
  });

  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
}

async function navigateToGamesTab(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('button:has-text("Games")').click();
  await page.waitForSelector('text="Loading games..."', { state: 'hidden', timeout: 30000 }).catch(() => null);
  await expect(page.locator('[data-game-id]').first()).toBeVisible({ timeout: 15000 });
}

function countGetGameRequests(page) {
  let count = 0;
  const handler = (req) => {
    // Opening a game now uses the consolidated GET /api/games/{id}/load endpoint
    // (game + playback URL + teammate data in one request). getGame() — GET
    // /api/games/{id} — remains as a fallback. Count both so the request-storm
    // guard tracks however the open flow fetches game data.
    if (req.method() === 'GET' && /\/api\/games\/\d+(\/load)?$/.test(req.url())) {
      count++;
    }
  };
  page.on('request', handler);
  return {
    get count() { return count; },
    stop() { page.removeListener('request', handler); },
  };
}

test.describe.serial('request storm regression', () => {
  test.beforeAll(async ({ request }) => {
    if (!fs.existsSync(TEST_VIDEO)) {
      throw new Error(`Test video not found: ${TEST_VIDEO}`);
    }
    if (!fs.existsSync(TEST_TSV)) {
      throw new Error(`Test TSV not found: ${TEST_TSV}`);
    }

    let lastError = null;
    for (let i = 0; i < 30; i++) {
      try {
        const health = await request.get(`${API_BASE}/health`);
        if (health.ok()) {
          console.log(`[E2E] Backend health check passed`);
          lastError = null;
          break;
        }
      } catch (e) {
        lastError = e;
        if (i < 29) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (lastError) {
      throw new Error(`Backend not running on port ${API_PORT}. Start it with: cd src/backend && uvicorn app.main:app --port ${API_PORT}`);
    }

    console.log(`[E2E] Test user ID: ${TEST_USER_ID}`);
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page);
  });

  test('setup: create game with video and clips', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('e.g., Carlsbad SC').fill('Storm Test Opponent');
    const today = new Date().toISOString().split('T')[0];
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Home' }).click();

    const videoInput = page.locator('form input[type="file"][accept*="video"]');
    await videoInput.setInputFiles(TEST_VIDEO);
    await page.waitForTimeout(1000);

    const createButton = page.locator('form button:has-text("Add Game")');
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    await expect(page.locator('video')).toBeVisible({ timeout: 120000 });
    console.log('[Setup] Video loaded in annotate mode');

    const uploadingButton = page.locator('button:has-text("Uploading video")');
    await page.waitForTimeout(2000);
    const isUploading = await uploadingButton.isVisible().catch(() => false);
    if (isUploading) {
      console.log('[Setup] Upload in progress, waiting...');
      await expect(uploadingButton).toBeHidden({ timeout: 300000 });
    }
    console.log('[Setup] Video upload complete');

    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await tsvInput.setInputFiles(TEST_TSV);
    await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 10000 });
    console.log('[Setup] TSV imported, clips visible');

    await page.waitForTimeout(5000);
    console.log('[Setup] Game with clips created successfully');
  });

  test('opening a game with clips does not create request storm', async ({ page }) => {
    await navigateToGamesTab(page);

    const tracker = countGetGameRequests(page);

    await page.locator('[data-game-id]').first().click();
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });

    await page.waitForTimeout(3000);
    tracker.stop();

    console.log(`[Test] GET /api/games/{id} requests: ${tracker.count}`);
    expect(tracker.count).toBeLessThanOrEqual(5);
  });

  test('navigating between games loads fresh data each time', async ({ page }) => {
    await navigateToGamesTab(page);

    const tracker1 = countGetGameRequests(page);
    await page.locator('[data-game-id]').first().click();
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    tracker1.stop();
    const firstCount = tracker1.count;

    console.log(`[Test] First open: ${firstCount} requests`);
    expect(firstCount).toBeGreaterThan(0);
    expect(firstCount).toBeLessThanOrEqual(5);

    await page.locator('button[title="Home"]').click();
    await expect(page.locator('button:has-text("Games")')).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Games")').click();
    await page.waitForSelector('text="Loading games..."', { state: 'hidden', timeout: 30000 }).catch(() => null);
    await expect(page.locator('[data-game-id]').first()).toBeVisible({ timeout: 15000 });

    const tracker2 = countGetGameRequests(page);
    await page.locator('[data-game-id]').first().click();
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    tracker2.stop();

    console.log(`[Test] Second open: ${tracker2.count} requests`);
    expect(tracker2.count).toBeGreaterThan(0);
    expect(tracker2.count).toBeLessThanOrEqual(5);
  });

  test('video element is wired up on multi-clip game', async ({ page }) => {
    await navigateToGamesTab(page);

    const tracker = countGetGameRequests(page);
    await page.locator('[data-game-id]').first().click();
    await expect(page.locator('video')).toBeVisible({ timeout: 30000 });
    tracker.stop();

    expect(tracker.count).toBeLessThanOrEqual(5);

    const hasSrc = await page.locator('video').first().evaluate(v =>
      !!(v.src || v.querySelector('source')?.src)
    );
    expect(hasSrc).toBe(true);

    const readyState = await page.locator('video').first().evaluate(v => v.readyState);
    if (readyState >= 2) {
      const playResult = await page.locator('video').first().evaluate(v =>
        v.play().then(() => 'playing').catch(e => e.name)
      );
      console.log(`[Test] Video ready (state ${readyState}), play result: ${playResult}`);
    } else {
      console.log(`[Test] Video element present with src but still downloading (readyState: ${readyState})`);
    }

    console.log('[Test] Video element verified');
  });

  test.afterAll(async ({ request }) => {
    try {
      const res = await request.delete(`${API_BASE}/auth/user`, {
        headers: { 'X-User-ID': TEST_USER_ID },
      });
      if (res.ok()) {
        const data = await res.json();
        console.log(`[Cleanup] ${data.message}`);
      }
    } catch (e) {
      console.log(`[Cleanup] Failed: ${e.message}`);
    }
  });
});
