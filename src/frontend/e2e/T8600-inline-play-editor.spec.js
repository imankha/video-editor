import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T8600: Inline Play Editor — desktop under-canvas strip.
 *
 * Real-browser coverage for the desktop (non-fullscreen) editor strip that
 * clip-selection-state-machine.spec.js's 900x600 viewport does NOT reach
 * (useIsMobile() classifies width<1024 as mobile, so that spec exercises the
 * bottom sheet). This spec runs at 1280x800 specifically to land in the
 * desktop strip branch.
 *
 * Run: cd src/frontend && npx playwright test e2e/T8600-inline-play-editor.spec.js
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');

// Each test drives the full add-game + create-clip flow, so tests MUST NOT share
// a backend account: POST /api/games dedupes by blake3_hash (games.py:307-341 and
// :343-382), so a second test uploading the same fixture lands back in the FIRST
// test's game, WITH its clips. A clip under the playhead then auto-selects
// (AnnotateContainer.jsx:1216) and flips the CTA to "Edit Play" - the strip opens
// in edit mode and there is no "Save" button. (clip-selection-state-machine.spec.js
// can use one module-scoped id because it has a single test.)
let testUserSeq = 0;
function newTestUserId() {
  return `e2e_t8600_${Date.now()}_${++testUserSeq}_${Math.random().toString(36).slice(2, 8)}`;
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

  // Bypass auth gate so Add Clip works instead of showing sign-in modal
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });

  await page.evaluate(() => {
    document.querySelectorAll('.quest-overlay').forEach(el => el.remove());
  });

  // Every test in this file assumes a virgin account (see newTestUserId) - a
  // leaked shared account would auto-select a pre-existing clip under the
  // playhead and silently flip Add Play into Edit Play. Fail fast and legibly
  // here instead of hanging 300s waiting for a "Save" button that will never
  // appear in that state.
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

function getStrip(page) {
  return page.locator('[data-testid="annotate-editor-strip"]');
}

test.describe('T8600: Desktop inline play editor strip', () => {
  skipOnDeployedTarget(test, "import()s /src/stores/authStore.js for an empty test-login session (Vite-dev path; 404s on a deployed build)");
  // Desktop width — useIsMobile() classifies width<1024 as mobile, so this
  // must stay >=1024 to exercise the strip, not the bottom sheet.
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

  test('Add Play opens the strip in place of the timeline; one-tap Save lands "Play 1" @t8600', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    // Timeline visible, strip absent, before opening the editor.
    const timeline = page.locator('.bg-gray-700.cursor-pointer.touch-none').last();
    await expect(timeline).toBeVisible();
    await expect(getStrip(page)).toHaveCount(0);

    // Open via the primary CTA — Add Play (no selection yet).
    const primaryCta = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(primaryCta).toHaveText(/Add Play/);
    await primaryCta.click();
    await page.waitForTimeout(800);

    // Strip replaces the timeline; green tint (create mode).
    const strip = getStrip(page);
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Adding new play');
    await expect(timeline).toHaveCount(0);

    // One-tap Save — no fields touched.
    await strip.locator('button:has-text("Save")').click();
    await page.waitForTimeout(1000);

    await expect(getStrip(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="clip-row"]', { hasText: 'Play 1' })).toBeVisible();
  });

  test('Edit Play opens the yellow strip prefilled; Update does not duplicate @t8600', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    // Create one clip first via one-tap Save.
    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);
    await getStrip(page).locator('button:has-text("Save")').click();
    await page.waitForTimeout(1000);

    const clipCountBefore = await page.locator('[data-testid="clip-row"]').count();

    // Select the clip, then Edit Play.
    await page.locator('[data-testid="clip-row"]').first().click();
    await page.waitForTimeout(500);
    const primaryCta = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(primaryCta).toHaveText(/Edit Play/);
    await primaryCta.click();
    await page.waitForTimeout(800);

    const strip = getStrip(page);
    await expect(strip).toBeVisible();
    // T8760 item 4: the header dropped "Editing:"; the pencil ("Rename this
    // play") is the one name-edit affordance.
    await expect(strip.locator('[title="Rename this play"]')).toBeVisible();
    await expect(strip.locator('button:has-text("Update")')).toBeVisible();

    await strip.locator('button:has-text("Update")').click();
    await page.waitForTimeout(1000);

    const clipCountAfter = await page.locator('[data-testid="clip-row"]').count();
    expect(clipCountAfter).toBe(clipCountBefore);
  });

  test('the transport-bar Add button is absent while the strip is open @t8600', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);
    await expect(getStrip(page)).toBeVisible();

    const transportAdd = page.locator('button[title="Add play ending at current time (A)"]');
    await expect(transportAdd).toHaveCount(0);
  });

  test('"Add details" expands and collapses in place, no popup @t8600', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);
    const strip = getStrip(page);
    const detailsButton = strip.locator('[data-testid="add-details-button"]');
    await expect(detailsButton).toBeVisible();

    await expect(strip.locator('label:has-text("Notes")')).toHaveCount(0);
    await detailsButton.click();
    await page.waitForTimeout(300);
    await expect(strip.locator('label:has-text("Notes")')).toBeVisible();

    await detailsButton.click();
    await page.waitForTimeout(300);
    await expect(strip.locator('label:has-text("Notes")')).toHaveCount(0);
  });

  test('Esc closes details first, then a second Esc closes the editor @t8600', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    await page.locator('[data-testid="annotate-primary-cta"]').click();
    await page.waitForTimeout(800);
    const strip = getStrip(page);
    await strip.locator('[data-testid="add-details-button"]').click();
    await page.waitForTimeout(300);
    await expect(strip.locator('label:has-text("Notes")')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(strip.locator('label:has-text("Notes")')).toHaveCount(0);
    await expect(strip).toBeVisible(); // editor still open

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(getStrip(page)).toHaveCount(0); // editor closed
  });
});
