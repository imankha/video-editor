/**
 * T17700 acceptance checks: Sync (was "Line up") on the real Annotate screen at the two
 * layouts the criterion names, 390x844 (phone) and 1440x900 (desktop).
 *
 * WHY STUBBED (same reasoning as e2e/T8900-fix-timing.qa.spec.js): Sync shows only on a
 * game whose second camera overlaps the main one, and no check account holds such a game
 * (dev presets or staging). So the API is stubbed with a synthetic overlap game (seq 1 main
 * camera 0-20s; seq 2 "sideline" camera at offset 0 for 6s) and two ffmpeg-made MP4s are
 * served with Range support. Everything else is the real app: AnnotateContainer's wiring,
 * AnnotateModeView, SourceBar, SyncPrompts, FixTimingStrip, AngleLanes.
 *
 * C2: before any tap, the screen shows the Sync button (named for both cameras, tooltip
 *     saying what it does) and the second-camera tip saying why, both on screen.
 * C3: the Sync panel fits the viewport; Earlier/Later and a drag of the camera bar never
 *     save, X cancels (no save, offset restored), Done saves exactly once.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17700.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { routeSeekableVideo } from '../helpers/videoRoute.js';
import { disableGuidanceForCheck } from '../helpers/checkAuth';

const GAME_ID = 990177;
const VIEWPORTS = [['390x844', { width: 390, height: 844 }], ['1440x900', { width: 1440, height: 900 }]];
const SYNC_TIP = "This game has a second camera. If the two don't show the same moment, tap Sync.";

let mainPath;
let anglePath;

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 't17700-'));
  const gen = (name, color, dur) => {
    const out = path.join(dir, name);
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=${dur}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ], { stdio: 'ignore' });
    return out;
  };
  mainPath = gen('main.mp4', 'blue', 20);
  anglePath = gen('sideline.mp4', 'red', 6);
});

// The playhead opens at 0, inside the sideline camera's span (0-6s), so the main camera
// plays with a second camera covering the moment: the case Sync is for.
function makeOverlapGame() {
  return {
    id: GAME_ID,
    name: 'Sync check game',
    storage_status: 'active',
    video_duration: 20,
    video_width: 320,
    video_height: 240,
    video_size: 100000,
    viewed_duration: 0,
    last_playhead_position: null,
    annotations: [],
    videos: [
      { sequence: 1, video_url: '/stub-video/main.mp4', duration: 20, video_width: 320, video_height: 240, offset_seconds: 0, recorded_at: '2026-09-05T14:00:00Z', original_filename: 'main.mp4' },
      { sequence: 2, video_url: '/stub-video/sideline.mp4', duration: 6, video_width: 320, video_height: 240, offset_seconds: 0, recorded_at: '2026-09-05T14:00:00Z', original_filename: 'sideline.mp4' },
    ],
  };
}

async function openOverlapGame(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();
  const game = makeOverlapGame();
  const patches = [];

  await page.route(/\/api\/(auth|games|clips|projects|admin|quests|profiles|teammate)/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ json: { user_id: 'e2e-user', email: 'test@e2e.local' } }));
  await page.route(/\/api\/auth\/init/, (r) => r.fulfill({ json: { profile_id: 'e2e-profile' } }));
  await page.route(new RegExp(`/api/games/${GAME_ID}/load`), (r) =>
    r.fulfill({ json: { game, playback_url: { url: '/stub-video/main.mp4', expires_in: 3600 }, teammate_shares: [], teammate_tags: [] } }));
  // Every placement write is recorded: the criterion is about WHEN this fires.
  await page.route(new RegExp(`/api/games/${GAME_ID}/videos/(\\d+)/placement`), (r) => {
    const seq = Number(r.request().url().match(/videos\/(\d+)\/placement/)[1]);
    const body = JSON.parse(r.request().postData() || '{}');
    patches.push({ seq, offset_seconds: body.offset_seconds });
    const v = game.videos.find((x) => x.sequence === seq);
    if (v && body.offset_seconds != null) v.offset_seconds = body.offset_seconds;
    r.fulfill({ json: v });
  });
  await page.route(new RegExp(`/api/games/${GAME_ID}(\\?|$)`), (r) => r.fulfill({ json: game }));
  await routeSeekableVideo(page, /\/stub-video\/main\.mp4/, mainPath);
  await routeSeekableVideo(page, /\/stub-video\/sideline\.mp4/, anglePath);
  await routeSeekableVideo(page, new RegExp(`/api/games/${GAME_ID}/video(?![a-z])`), mainPath);

  await page.addInitScript((id) => {
    sessionStorage.setItem('pendingGameId', String(id));
    localStorage.removeItem('rb.annotate.syncTipSeen');
  }, GAME_ID);
  await page.goto('/annotate', { waitUntil: 'domcontentloaded' });
  // The coach shade would swallow taps outside its own step.
  await disableGuidanceForCheck(page);
  return { context, page, patches };
}

/** The element is drawn and lies fully inside the viewport's width (no clipping). */
async function expectInsideViewport(page, locator, viewport) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
}

async function expectNoSideScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

/** A real Chromium pointer drag (down/move/up) on `locator`, `dxPx` to the right. */
async function realDrag(page, locator, dxPx) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dxPx, y, { steps: 12 });
  await page.mouse.up();
}

for (const [label, viewport] of VIEWPORTS) {
  test(`T17700:C2 before tapping, the Annotate screen says what Sync does and why (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await openOverlapGame(browser, viewport);

    const sync = page.getByTestId('source-bar-fix-timing');
    await expect(sync).toBeVisible({ timeout: 30000 });
    await expectInsideViewport(page, sync, viewport);
    await expect(sync).toHaveAccessibleName('Sync sideline with Main camera');
    await expect(sync).toHaveAttribute('title', 'Make both cameras show the same moment');
    // Phone shows "Sync"; desktop adds "cameras" (innerText: only what is drawn).
    expect((await sync.evaluate((el) => el.innerText)).trim()).toBe(viewport.width >= 1024 ? 'Sync cameras' : 'Sync');

    const tip = page.getByTestId('sync-tip');
    await expectInsideViewport(page, tip, viewport);
    await expect(tip).toContainText(SYNC_TIP);
    await expect(page.getByText(/line (it )?up/i)).toHaveCount(0);
    await expectNoSideScroll(page);

    // Nothing was tapped yet, and the panel is still closed.
    await expect(page.getByTestId('fix-timing-strip')).toHaveCount(0);
    await context.close();
  });

  test(`T17700:C3 Sync panel fits; nudges and drags never save, X cancels, Done saves once (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page, patches } = await openOverlapGame(browser, viewport);

    const sync = page.getByTestId('source-bar-fix-timing');
    await expect(sync).toBeVisible({ timeout: 30000 });
    await sync.click();
    const strip = page.getByTestId('fix-timing-strip');
    await expectInsideViewport(page, strip, viewport);
    await expect(strip.getByRole('heading')).toHaveText('Sync sideline with Main camera');
    for (const id of ['fix-timing-earlier-10', 'fix-timing-later-0.1', 'fix-timing-done', 'fix-timing-cancel']) {
      await expectInsideViewport(page, page.getByTestId(id), viewport);
    }
    await expectNoSideScroll(page);

    // Earlier/Later preview only.
    await page.getByTestId('fix-timing-later-1').click();
    await page.getByTestId('fix-timing-later-0.1').click();
    await expect(page.getByTestId('fix-timing-moved')).toHaveText('Moved 1.1s later');
    // Letting go of a drag of the camera bar does not save either (owner ruling Q4).
    const bar = page.getByTestId('angle-bar-2');
    await realDrag(page, bar, 40);
    await expect(strip).toBeVisible();
    await page.waitForTimeout(500); // let any (wrongly) fired PATCH land
    expect(patches).toEqual([]);

    // X cancels: no save, and the camera is back where it was.
    await page.getByTestId('fix-timing-cancel').click();
    await expect(strip).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(patches).toEqual([]);
    await sync.click();
    await expect(page.getByTestId('fix-timing-moved')).toHaveText('Not moved');

    // Done is the one save: exactly one PATCH with the final offset (0 + 1 = 1).
    await page.getByTestId('fix-timing-later-1').click();
    await page.getByTestId('fix-timing-done').click();
    await expect(strip).toHaveCount(0);
    await expect.poll(() => patches.length).toBe(1);
    await page.waitForTimeout(500);
    expect(patches).toEqual([{ seq: 2, offset_seconds: 1 }]);
    await context.close();
  });
}
