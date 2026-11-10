/**
 * T15750 — per-criterion acceptance checks (group checks protocol).
 *
 * C1 (picture width >= 50% of screen width with Edit play open, portrait
 * fullscreen) and C2 (opening Edit play does not start playback). See
 * docs/plans/tasks/T15750-phone-portrait-fullscreen-with-edit-play-open.md.
 *
 * Uses a dev preset account (`loginAsDevPreset(context, 'full')`), not a real
 * account via `loginAsRealUser` — a real account's R2-backed video load can
 * hang in this environment; the preset's cloned game answers reliably. See
 * src/frontend/CLAUDE.md § Dev preset accounts.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15750.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsDevPreset, openGameInAnnotate } from '../helpers/realAuth.js';
import { saveEvidence } from '../helpers/qa.js';

const API_BASE = process.env.E2E_API_BASE || '/api';

async function domClick(locator) {
  await locator.evaluate((el) => el.click());
}

async function openActiveGameInPortraitFullscreen(context, page) {
  const res = await context.request.get(`${API_BASE}/games`);
  expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  test.skip(!target, '[T15750] no active game with clips in the dev preset');
  await openGameInAnnotate(page, target.id);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

  const fsBtn = page.getByTitle('Fullscreen').first();
  if (!(await fsBtn.count().catch(() => 0))) {
    test.skip(true, '[T15750] fullscreen toggle not offered');
  }
  await fsBtn.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(600);
}

test.describe('T15750 checks @ 390x844-iphone-portrait', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(240_000);
    await loginAsDevPreset(context, 'full');
    await openActiveGameInPortraitFullscreen(context, page);
  });

  test('T15750:C1 - picture is at least 50% of screen width with Edit play open', async ({ page }) => {
    await page.locator('.clip-marker').first().click({ force: true });
    await page.waitForTimeout(300);
    const markBtn = page.getByTestId('annotate-mark-play-button');
    test.skip(!(await markBtn.count().catch(() => 0)), '[T15750] Mark/Edit play button not offered');
    await domClick(markBtn);

    const video = page.locator('[data-testid="annotate-coach-stage"] video').first();
    await expect(video).toBeVisible();
    const videoBox = await video.boundingBox();
    expect(videoBox, 'video element has a bounding box with the editor open').not.toBeNull();

    const viewportWidth = page.viewportSize().width;
    expect(
      videoBox.width,
      `picture width (${videoBox.width}px) is at least 50% of screen width (${viewportWidth}px) with Edit play open`,
    ).toBeGreaterThanOrEqual(viewportWidth * 0.5);

    await saveEvidence(page, 'T15750-C1-portrait-fs-edit-open');
  });

  test('T15750:C2 - opening Edit play does not start playback', async ({ page }) => {
    const video = page.locator('[data-testid="annotate-coach-stage"] video').first();
    await expect(video).toBeVisible();
    const pausedBefore = await video.evaluate((v) => v.paused);
    expect(pausedBefore, 'video is paused before opening Edit play').toBe(true);

    await page.locator('.clip-marker').first().click({ force: true });
    await page.waitForTimeout(300);
    const markBtn = page.getByTestId('annotate-mark-play-button');
    test.skip(!(await markBtn.count().catch(() => 0)), '[T15750] Mark/Edit play button not offered');
    await domClick(markBtn);
    await page.waitForTimeout(1000); // give any stale-frame race a window to misfire

    const pausedAfter = await video.evaluate((v) => v.paused);
    expect(pausedAfter, 'video is still paused after opening Edit play').toBe(true);
  });
});
