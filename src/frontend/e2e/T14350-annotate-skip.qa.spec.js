/**
 * T14350: YouTube-style skips in Annotate, driven in a real browser as a real user.
 * - Forward 5 seconds transport button: +5 s.
 * - Double-click the right / left half of the video: +5 / -5 s, ripple "5 seconds",
 *   playing state unchanged; three quick clicks: +10 s, label "10 seconds".
 * - L key: +10 s (works on the default Plays layer too).
 * - Phone (390x844, touch): two taps do the same, in and out of fullscreen.
 *
 * Run: bash scripts/dev-verify.sh src/frontend/e2e/T14350-annotate-skip.qa.spec.js --reporter=line
 * Opens the account's first active game; with none, uploads the T12000 fixture and
 * deletes the game it created. Params: E2E_REAL_EMAIL, E2E_REAL_PROFILE.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Fallback when the account has no active game: upload the T12000 fixture.
const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');
const API_BASE = process.env.E2E_API_BASE || '/api';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const headers = { 'X-Profile-ID': PROFILE };

async function gameIds(context) {
  const res = await context.request.get(`${API_BASE}/games`, { headers });
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  return ((await res.json()).games || []).map((g) => g.id);
}

let preexisting = null;

async function openGame(context, page) {
  await loginAsRealUser(context, process.env.E2E_REAL_EMAIL || 'imankh@gmail.com', PROFILE);
  const res = await context.request.get(`${API_BASE}/games`, { headers });
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  preexisting = games.map((g) => g.id);
  const active = games.find((g) => g.storage_status === 'active');
  if (active) {
    // An active game streams its server video from the start. Uploading when one
    // exists can dedupe into it, and the player then swaps the local blob for the
    // server URL mid-test (src change resets the playhead to 0).
    await openGameInAnnotate(page, active.id);
  } else {
    await page.goto('/');
    await page.getByRole('button', { name: 'Upload game' }).click();
    await page.getByTestId('footage-file-input').setInputFiles(TEST_VIDEO);
    await expect(page.getByTestId('footage-picker-ready-single')).toBeVisible({ timeout: 30000 });
    await page.locator('form').getByRole('button', { name: 'Upload game' }).click();
    await page.waitForURL(/\/annotate/, { timeout: 30000 });
  }
  const stage = page.getByTestId('annotate-video-stage');
  await expect(stage).toBeVisible({ timeout: 30000 });
  // Wait for a seekable video with room to skip both ways.
  await page.waitForFunction(() => {
    const v = [...document.querySelectorAll('[data-testid="annotate-video-stage"] video')]
      .find((el) => el.getAttribute('aria-hidden') !== 'true');
    return v && v.readyState >= 1 && v.duration > 60;
  }, null, { timeout: 30000 });
  // Close any first-run dialog (sport question) that would eat clicks.
  await page.keyboard.press('Escape');
  return stage;
}

// Delete only the game this test uploaded; leave the account as found.
test.afterEach(async ({ context }) => {
  if (!preexisting) return;
  const created = (await gameIds(context)).filter((id) => !preexisting.includes(id));
  for (const id of created) {
    const res = await context.request.delete(`${API_BASE}/games/${id}`, { headers });
    console.log(`[T14350] cleanup: deleted game ${id} -> ${res.status()}`);
  }
  preexisting = null;
});

// Playhead + playing state of the on-screen video element.
const videoState = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll('[data-testid="annotate-video-stage"] video')]
    .find((el) => el.getAttribute('aria-hidden') !== 'true');
  return { t: v.currentTime, paused: v.paused };
});

async function seekTo(page, seconds) {
  await page.evaluate((s) => {
    const v = [...document.querySelectorAll('[data-testid="annotate-video-stage"] video')]
      .find((el) => el.getAttribute('aria-hidden') !== 'true');
    v.currentTime = s;
  }, seconds);
  // The transport reads the app's playhead state, not the element: wait until the
  // app has caught up (its readout shows the new time) before skipping from it.
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  await expect(page.getByTestId('annotate-controls')).toContainText(mmss, { timeout: 5000 });
}

async function halfPoint(stage, side) {
  const box = await stage.boundingBox();
  return { x: box.x + box.width * (side === 'left' ? 0.2 : 0.8), y: box.y + box.height * 0.5 };
}

const near = (actual, expected) => expect(Math.abs(actual - expected)).toBeLessThan(0.75);

test.describe('desktop', () => {
  test.setTimeout(120000);
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Forward 5 s button, double-click skips with ripple, accumulation, L key (T14350)', async ({ context, page }, info) => {
    const stage = await openGame(context, page);
    await seekTo(page, 30);

    // Forward 5 seconds button.
    let s0 = await videoState(page);
    await page.getByTitle('Forward 5 seconds (Right arrow)').click();
    await page.waitForTimeout(400);
    near((await videoState(page)).t, s0.t + 5);

    // Double-click right half: +5, ripple "5 seconds", paused state unchanged.
    s0 = await videoState(page);
    const right = await halfPoint(stage, 'right');
    await page.mouse.dblclick(right.x, right.y);
    const ripple = page.getByTestId('skip-ripple');
    await expect(ripple).toBeVisible();
    await expect(ripple).toHaveAttribute('data-side', 'right');
    await expect(ripple).toContainText('5 seconds');
    await page.screenshot({ path: `../../qa/T14350-desktop-ripple.png` });
    await page.waitForTimeout(400);
    let s1 = await videoState(page);
    near(s1.t, s0.t + 5);
    expect(s1.paused).toBe(s0.paused);
    await expect(ripple).toBeHidden({ timeout: 2000 });

    // Double-click left half: -5.
    s0 = await videoState(page);
    const left = await halfPoint(stage, 'left');
    await page.mouse.dblclick(left.x, left.y);
    await expect(ripple).toHaveAttribute('data-side', 'left');
    await page.waitForTimeout(400);
    near((await videoState(page)).t, s0.t - 5);
    await expect(ripple).toBeHidden({ timeout: 2000 });

    // Three quick clicks on the right half: +10 total, label "10 seconds".
    s0 = await videoState(page);
    await page.mouse.click(right.x, right.y, { clickCount: 3, delay: 0 });
    await expect(ripple).toContainText('10 seconds');
    await page.waitForTimeout(400);
    s1 = await videoState(page);
    near(s1.t, s0.t + 10);
    expect(s1.paused).toBe(s0.paused);
    await expect(ripple).toBeHidden({ timeout: 2000 });

    // Double-click while playing: still playing after the skip.
    await page.getByTestId('annotate-play-button').click();
    await page.waitForTimeout(500);
    s0 = await videoState(page);
    expect(s0.paused).toBe(false);
    await page.mouse.dblclick(right.x, right.y);
    await page.waitForTimeout(400);
    s1 = await videoState(page);
    expect(s1.paused).toBe(false);
    expect(s1.t - s0.t).toBeGreaterThan(4.5);
    await page.getByTestId('annotate-play-button').click();
    await page.waitForTimeout(300);
    await expect(ripple).toBeHidden({ timeout: 2000 });

    // L key: +10 s on the default (Plays) layer.
    s0 = await videoState(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('l');
    await page.waitForTimeout(400);
    near((await videoState(page)).t, s0.t + 10);

    // Reduced motion: no expanding circle, the label still shows.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.dblclick(right.x, right.y);
    await expect(ripple).toContainText('5 seconds');
    expect(await ripple.locator('.skip-ripple-circle').evaluate((el) => getComputedStyle(el).display)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    info.annotations.push({ type: 'T14350', description: 'desktop skips verified' });
  });
});

test.describe('phone', () => {
  test.setTimeout(120000);
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function doubleTap(page, stage, side) {
    const p = await halfPoint(stage, side);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(80);
    await page.touchscreen.tap(p.x, p.y);
  }

  test('two taps skip 5 s, in and out of fullscreen (T14350)', async ({ context, page }) => {
    const stage = await openGame(context, page);
    await seekTo(page, 30);

    let s0 = await videoState(page);
    await doubleTap(page, stage, 'right');
    await expect(page.getByTestId('skip-ripple')).toContainText('5 seconds');
    await page.screenshot({ path: `../../qa/T14350-phone-ripple.png` });
    await page.waitForTimeout(400);
    let s1 = await videoState(page);
    near(s1.t, s0.t + 5);
    expect(s1.paused).toBe(s0.paused);
    await expect(page.getByTestId('skip-ripple')).toBeHidden({ timeout: 2000 });

    // Fullscreen.
    await page.getByTitle('Fullscreen').click();
    await page.waitForTimeout(500);
    const fsStage = page.getByTestId('annotate-video-stage');
    s0 = await videoState(page);
    await doubleTap(page, fsStage, 'left');
    await expect(page.getByTestId('skip-ripple')).toHaveAttribute('data-side', 'left');
    await page.screenshot({ path: `../../qa/T14350-phone-fullscreen-ripple.png` });
    await page.waitForTimeout(400);
    s1 = await videoState(page);
    near(s1.t, s0.t - 5);
    expect(s1.paused).toBe(s0.paused);
  });
});
