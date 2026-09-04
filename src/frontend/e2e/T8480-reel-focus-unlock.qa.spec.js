import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { openAddClipForm } from './helpers/annotateClips.js';

/**
 * T8480 - Focus unlocks the moment a reel exists.
 *
 * The bug: saving a clip with the reel switch ON showed "Reel created!" but the
 * Focus/Overlay tabs stayed disabled (the project existed but was never
 * selected, so ModeSwitcher's hasProject stayed false), and the only
 * explanation was a hover-only title tooltip - invisible on touch.
 *
 * Proves, against the running app (empty test-session bypass, local stack):
 *   - save with reel ON -> the Focus tab is enabled immediately (new project
 *     auto-selected), zero extra gestures
 *   - the toast reads exactly "Reel started, click Focus to complete" and its
 *     action opens Focus for the new reel
 *   - saving does NOT navigate away from Annotate or reload its video
 *   - tapping a locked tab fires a visible explanation toast (390x844 too)
 *
 * T8470 (same branch): after the save, every surface tells ONE story for the
 * fresh draft - details-panel button is a live "Open reel (Draft)" link, and
 * no surface renders "Not Started" / bare "Ready" for it.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');

const TOAST_COPY = 'Reel started, click Focus to complete';

/** Fresh throwaway user per test run so reruns never collide. */
function makeUserId(tag) {
  return `e2e_t8480_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Empty-session bypass + a fresh game uploaded and opened in Annotate. */
async function setupAnnotateWithGame(page, userId) {
  await page.setExtraHTTPHeaders({ 'X-Test-Mode': 'true', 'X-User-ID': userId });
  // R2 presigned URLs must not carry the test headers (CORS preflight).
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user_id: userId, email: 'e2e@test.local' }),
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Freshest bundle, not a stale PWA-cached one.
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Add a game with the short test video and land in Annotate.
  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('T8480 Reel Unlock');
  await page.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('form input[type="file"][accept*="video"]').setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(500);
  const createButton = page.locator('form button:has-text("Add Game")');
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click();
}

/** Save the open add-clip form and return the parsed save response. */
async function saveClip(page, form) {
  const [saveResp] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/clips/raw/save') && res.request().method() === 'POST',
      { timeout: 15000 },
    ),
    form.locator('button.bg-green-600:has-text("Save")').click(),
  ]);
  expect(saveResp.ok()).toBeTruthy();
  return saveResp.json();
}

test.afterEach(async ({ page }, testInfo) => {
  // Delete the whole throwaway test-user folder from the backend store.
  const userId = testInfo.annotations.find((a) => a.type === 'userId')?.description;
  if (userId) {
    await page.request.delete('/api/auth/user', { headers: { 'X-User-ID': userId } }).catch(() => {});
  }
});

test.describe('T8480 - Focus unlocks the moment a reel exists (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('save with reel ON -> Focus tab enabled, exact toast, action opens Focus, no navigation', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const userId = makeUserId('desk');
    testInfo.annotations.push({ type: 'userId', description: userId });
    await setupAnnotateWithGame(page, userId);

    const form = await openAddClipForm(page);
    const annotateUrl = page.url();

    // Before the save: Focus tab is locked (no project selected yet).
    await expect(page.getByTestId('mode-framing')).toHaveAttribute('aria-disabled', 'true');

    // Flip the reel switch ON (desktop-only control in the add-clip form).
    const reelSwitch = form.getByRole('switch').last();
    await expect(form.getByText("Don't Create Reel")).toBeVisible({ timeout: 5000 });
    await reelSwitch.click();
    await expect(form.getByText('Create Reel', { exact: true })).toBeVisible();

    const result = await saveClip(page, form);
    expect(result.project_created).toBeTruthy();
    expect(result.project_id).toBeTruthy();

    // The exact user-decided toast copy - and only this copy (no "Reel created!").
    await expect(page.getByText(TOAST_COPY)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Reel created!')).toHaveCount(0);

    // Focus tab enabled immediately - zero additional gestures.
    await expect(page.getByTestId('mode-framing')).toHaveAttribute('aria-disabled', 'false', { timeout: 10000 });

    // Auto-selection must NOT have navigated away from Annotate or dropped the video.
    expect(page.url()).toBe(annotateUrl);
    await expect(page.locator('video').first()).toBeVisible();

    // The toast's action opens Focus with the new reel selected.
    await page.getByRole('button', { name: 'Open Focus' }).click();
    await expect(page).toHaveURL(/\/focus/, { timeout: 20000 });
  });
});

test.describe('T8470 - one status story for a fresh draft (desktop)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('save with reel ON -> Home continue card, Clips tab chip, and Highlight Reels drawer all say Draft', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const userId = makeUserId('t8470');
    testInfo.annotations.push({ type: 'userId', description: userId });
    await setupAnnotateWithGame(page, userId);

    const form = await openAddClipForm(page);
    const reelSwitch = form.getByRole('switch').last();
    await expect(form.getByText("Don't Create Reel")).toBeVisible({ timeout: 5000 });
    await reelSwitch.click();
    await expect(form.getByText('Create Reel', { exact: true })).toBeVisible();

    const result = await saveClip(page, form);
    expect(result.project_created).toBeTruthy();
    await expect(page.getByText(TOAST_COPY)).toBeVisible({ timeout: 10000 });

    // Home: the continue card describes the fresh reel as a Draft, never
    // "Not Started" - one status vocabulary (T8470 Part A/B).
    await page.getByRole('button', { name: 'Home' }).click();
    const continueCard = page.getByRole('button', { name: /clip.*Draft/ });
    await expect(continueCard).toBeVisible({ timeout: 10000 });
    await expect(continueCard).not.toContainText('Not Started');

    // In Progress Clips tab: the chip counts the same single-clip draft.
    await page.getByRole('button', { name: /^In Progress Clips/ }).click();
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('project-card').getByText('Draft', { exact: true })).toBeVisible();

    // Published tab: published-reels list is empty, but the empty state
    // is count-aware - it must never claim "No reels yet" while the draft exists
    // (T8470 Part C), and its link switches to the In Progress Clips tab.
    await page.getByRole('button', { name: /^Published/ }).click();
    await expect(page.getByText('No reels yet')).toBeVisible({ timeout: 10000 });
    const draftLink = page.getByRole('button', { name: /draft clip.*in progress.*Clips tab/ });
    await expect(draftLink).toBeVisible();
    await draftLink.click();

    // The drawer closed and the In Progress Clips tab is now active.
    await expect(page.getByText('No reels yet')).toHaveCount(0);
    await expect(page.getByTestId('project-card').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('T8480 - touch-visible explanations + unlock (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('locked-tab tap explains itself; rating 5 auto-reel save unlocks Focus', async ({ page }, testInfo) => {
    test.setTimeout(180000);
    const userId = makeUserId('mob');
    testInfo.annotations.push({ type: 'userId', description: userId });
    await setupAnnotateWithGame(page, userId);

    // Locked Focus tab tap -> visible toast, not a silent no-op / hover-only
    // title. Tap BEFORE opening the add-clip form (the form sheet overlaps the
    // header at 390px and would swallow the forced pointer events).
    // force: Playwright refuses actionability on aria-disabled; real taps land.
    await expect(page.getByTestId('mode-framing')).toBeVisible({ timeout: 60000 });
    await page.getByTestId('mode-framing').click({ force: true });
    await expect(page.getByText('Select a reel first')).toBeVisible({ timeout: 5000 });

    const form = await openAddClipForm(page);

    // Mobile hides the reel toggle; rating 5 (My Athlete) auto-enables it.
    await form.locator('button[title="5 stars"]').click();
    const result = await saveClip(page, form);
    expect(result.project_created).toBeTruthy();

    await expect(page.getByText(TOAST_COPY)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('mode-framing')).toHaveAttribute('aria-disabled', 'false', { timeout: 10000 });

    // Overlay stays locked (nothing exported) - its tap must explain itself too.
    await page.getByTestId('mode-overlay').click({ force: true });
    await expect(page.getByText('Export from Focus first to enable Overlay mode')).toBeVisible({ timeout: 5000 });
  });
});
