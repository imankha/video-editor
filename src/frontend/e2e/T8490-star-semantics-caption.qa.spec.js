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
  await page.locator('button:has-text("Upload game")').click();
  await page.waitForTimeout(500);

  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
  await page.locator('input[type="date"]').fill('2026-03-21');
  await page.getByRole('button', { name: 'Home' }).click({ force: true });

  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(1000);

  const addGameButton = page.locator('form button[type="submit"], button:has-text("Upload game")').last();
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

  // T10610: the create-clip toggle + free-text caption panel this test used to
  // drive were already superseded by T10310 (the create-clip decision moved
  // out of the editor onto the main-screen split CTA) before this task. The
  // rating control left in the strip is the RatingBadge popup
  // (PlayProgressBadges.jsx) — its rows carry the SAME star-semantics
  // (adjective + chess-style notation) this spec is really protecting, so the
  // rewrite drives that popup instead of a caption string. The primary CTA
  // now creates the play immediately (create-at-tap) and opens the strip
  // already in EDIT mode — there is no separate Save step.
  test('rating popup shows the star-semantics adjective + notation, and persists via surgical PUT @t8490', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    const [saveResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/clips/raw/save') && r.request().method() === 'POST'),
      page.locator('[data-testid="annotate-primary-cta"]').click(),
    ]);
    const clipId = (await saveResp.json()).raw_clip_id;
    await page.waitForTimeout(800);

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible();

    // No Save button anywhere — Delete play + Done replace it (T10610 § D/§ E row 1).
    await expect(strip.getByRole('button', { name: /^Save/ })).toHaveCount(0);
    await expect(strip.getByTestId('delete-play-button')).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Done' })).toBeVisible();

    // T10690/T10710: create-at-tap no longer seeds a rating (raw_clips.rating
    // is nullable) — the play starts genuinely UNRATED, so the popup opens
    // with NO row checked, not a hidden default of 4. Pick 4 stars ("Good")
    // ourselves, confirming the row's adjective + notation, before continuing
    // with this test's rating-change assertions below.
    await strip.getByTestId('badge-rated').click();
    const picker = page.getByTestId('rating-picker');
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('radio', { name: /^4 stars - Good/ })).toHaveAttribute('aria-checked', 'false');
    const [put4] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      picker.getByRole('radio', { name: /^4 stars - Good/ }).click(),
    ]);
    expect(put4.postDataJSON()).toEqual({ rating: 4 });
    await saveEvidence(page, 'T8490-strip-rating4-mine');

    // Rating 2 -> "Technical Lapse" (the learn-from band), persisted via a
    // surgical PUT carrying ONLY {rating} (T10610 § 2.2 gesture table).
    // Picking a row closes the popup, so reopen it first.
    await strip.getByTestId('badge-rated').click();
    const [put2] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      page.getByTestId('rating-picker').getByRole('radio', { name: /^2 stars - Technical Lapse/ }).click(),
    ]);
    expect(put2.postDataJSON()).toEqual({ rating: 2 });
    await saveEvidence(page, 'T8490-strip-rating2');

    // Rating 5 ("Brilliant") + My athlete (default layer).
    await strip.getByTestId('badge-rated').click();
    const [put5] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      page.getByTestId('rating-picker').getByRole('radio', { name: /^5 stars - Brilliant/ }).click(),
    ]);
    expect(put5.postDataJSON()).toEqual({ rating: 5 });
    await saveEvidence(page, 'T8490-strip-rating5-mine');

    // Delete play + Done stay reachable throughout (never covered/off-screen) —
    // this is the surviving form of the old "Save stays reachable" assertion
    // now that there is no Save button to check.
    await expect(strip.getByTestId('delete-play-button')).toBeInViewport();
    await expect(strip.getByRole('button', { name: 'Done' })).toBeInViewport();
    await saveEvidence(page, 'T8490-strip-rating5-team');
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

  // T10610: same rewrite as the desktop strip test above — the caption panel
  // is gone; the RatingBadge popup (a mobile bottom sheet here, per
  // PlayProgressBadges' isMobile split) carries the star-semantics adjective +
  // notation instead, and the create-at-tap primary CTA opens the sheet
  // already in EDIT mode with the play already persisted.
  test('rating popup (mobile sheet) shows star semantics, Done still reachable at 320x844 @t8490', async ({ page }) => {
    await enterAnnotateMode(page);
    await ensurePaused(page);
    await seekVideoDirect(page, 10);

    const [saveResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/clips/raw/save') && r.request().method() === 'POST'),
      page.locator('[data-testid="annotate-primary-cta"]').click(),
    ]);
    const clipId = (await saveResp.json()).raw_clip_id;
    await page.waitForTimeout(800);

    const sheet = page.locator('[data-add-clip-form]');
    await expect(sheet).toBeVisible();

    await sheet.getByTestId('badge-rated').click();
    const picker = page.getByTestId('rating-picker');
    await expect(picker).toBeVisible();
    // T10690/T10710: unrated at create-at-tap — no row starts checked.
    await expect(picker.getByRole('radio', { name: /^4 stars - Good/ })).toHaveAttribute('aria-checked', 'false');
    const [put4] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      picker.getByRole('radio', { name: /^4 stars - Good/ }).click(),
    ]);
    expect(put4.postDataJSON()).toEqual({ rating: 4 });
    await saveEvidence(page, 'T8490-mobile-320-rating4-mine');

    // Picking a row closes the sheet, so reopen it first.
    await sheet.getByTestId('badge-rated').click();
    const [put5] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      page.getByTestId('rating-picker').getByRole('radio', { name: /^5 stars - Brilliant/ }).click(),
    ]);
    expect(put5.postDataJSON()).toEqual({ rating: 5 });
    await saveEvidence(page, 'T8490-mobile-320-rating5-mine');

    // The pinned footer keeps Done reachable without scrolling (T8140) — the
    // surviving form of the old "Save reachable" assertion.
    const doneButton = sheet.getByRole('button', { name: 'Done' });
    await expect(doneButton).toBeVisible();
    await expect(doneButton).toBeInViewport();
    await saveEvidence(page, 'T8490-mobile-320-done-reachable');
  });
});
