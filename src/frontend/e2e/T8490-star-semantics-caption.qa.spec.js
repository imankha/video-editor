import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import { saveEvidence } from './helpers/qa.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T8490 QA: star-scale caption live-drive.
 *
 * Real-browser evidence that the 5-state rating caption (task file "What to
 * build" Step 1) renders correctly on both the desktop strip (T8600) and the
 * mobile bottom sheet, and that Save stays reachable at 320x844 once the
 * caption is added (T8550 concern, annotate.md T8140 note).
 *
 * Run: cd src/frontend && npx playwright test e2e/T8490-star-semantics-caption.qa.spec.js
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');

let testUserSeq = 0;
function newTestUserId() {
  return `e2e_t8490_${Date.now()}_${++testUserSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

async function setupTestUserContext(page, userId) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': userId,
    'X-Test-Mode': 'true',
  });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
}

async function clearBrowserState(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.evaluate(async () => {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(name => caches.delete(name)));
    }
  });
}

async function enterAnnotateMode(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);

  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
  await page.locator('input[type="date"]').fill('2026-03-21');
  await page.getByRole('button', { name: 'Home' }).click({ force: true });

  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(1000);

  const addGameButton = page.locator('form button[type="submit"], button:has-text("Add Game")').last();
  await expect(addGameButton).toBeEnabled({ timeout: 5000 });
  await addGameButton.click();

  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    expect(await video.evaluate(v => !!v.src)).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });

  const uploadingButton = page.locator('button:has-text("Uploading video")');
  await page.waitForTimeout(2000);
  if (await uploadingButton.isVisible().catch(() => false)) {
    await expect(uploadingButton).toBeHidden({ timeout: 300000 });
  }

  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });

  await page.evaluate(() => {
    document.querySelectorAll('.quest-overlay').forEach(el => el.remove());
  });

  await expect(page.locator('[data-testid="clip-row"]')).toHaveCount(0);
}

async function ensurePaused(page) {
  await page.locator('video').first().evaluate(v => { if (!v.paused) v.pause(); });
  await page.waitForTimeout(200);
}

async function seekVideoDirect(page, time) {
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; }, time);
  await page.waitForTimeout(1000);
}

test.describe('T8490: rating caption — desktop strip', () => {
  skipOnDeployedTarget(test, "import()s /src/stores/authStore.js for an empty test-login session (Vite-dev path; 404s on a deployed build)");
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page, newTestUserId());
    await page.goto('/');
    await clearBrowserState(page);
  });

  test('shows the 5-state caption across ratings and layers @t8490', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible();

    // Default rating (4, "Good") — "Big play" caption.
    await expect(strip).toContainText('Big play (!) - saved to your library.');
    await saveEvidence(page, 'T8490-strip-rating4-mine');

    // Rating 2 -> generic "Saved to your library."
    await strip.locator('button[title="2 stars"]').click();
    await expect(strip).toContainText('Saved to your library.');
    await saveEvidence(page, 'T8490-strip-rating2');

    // Rating 5 + My Athlete (default layer) -> "reel will be created."
    await strip.locator('button[title="5 stars"]').click();
    await expect(strip).toContainText("Can't-miss play (!!) - reel will be created.");
    await expect(strip.locator('button:has-text("Save")')).toBeVisible();
    await saveEvidence(page, 'T8490-strip-rating5-mine');

    // Switch to Team layer -> "team clips don't start reels."
    await page.locator('[role="radio"][aria-label="Team layer"]').click();
    await expect(strip).toContainText("Can't-miss team play (!!) - team clips don't start reels.");
    await saveEvidence(page, 'T8490-strip-rating5-team');

    // Save stays reachable throughout (never covered/off-screen).
    await expect(strip.locator('button:has-text("Save")')).toBeInViewport();
  });
});

test.describe('T8490: rating caption — mobile bottom sheet', () => {
  skipOnDeployedTarget(test, "import()s /src/stores/authStore.js for an empty test-login session (Vite-dev path; 404s on a deployed build)");
  // 320x844 — the narrowest supported width (T7590/T8550 short-viewport concern).
  test.use({ viewport: { width: 320, height: 844 } });

  test.beforeAll(async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await setupTestUserContext(page, newTestUserId());
    await page.goto('/');
    await clearBrowserState(page);
  });

  test('shows the caption in the mobile sheet with Save still reachable at 320x844 @t8490', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);

    const sheet = page.locator('[data-add-clip-form]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Big play (!) - saved to your library.');
    await saveEvidence(page, 'T8490-mobile-320-rating4-mine');

    await sheet.locator('button[title="5 stars"]').click();
    await expect(sheet).toContainText("Can't-miss play (!!) - reel will be created.");
    await saveEvidence(page, 'T8490-mobile-320-rating5-mine');

    // The pinned footer keeps Save reachable without scrolling (T8140).
    const saveButton = sheet.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeInViewport();
    await saveEvidence(page, 'T8490-mobile-320-save-reachable');
  });
});
