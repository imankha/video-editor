/**
 * T8900 QA — Fix-timing: nudge an angle into alignment, driven end-to-end in a
 * REAL browser against the vite dev server.
 *
 * WHY STUBBED (same reasoning as T8890's spec): no product path CREATES real
 * overlapping footage in this container (no R2 creds; intake discards overlap).
 * So we stub /load with a synthetic overlap game (seq 1 backbone 0-20s; seq 2
 * "sideline" angle at offset 8, dur 6, fully inside the backbone) and serve two
 * real seekable MP4s. The placement PATCH is intercepted, its body asserted, and
 * the stubbed /load is MUTATED to the new offset so the reload genuinely reflects
 * the persisted correction (the bar's rendered position changes).
 *
 * Proves the acceptance criteria the unit tests can only approximate:
 *   - the mode opens from the angle bar's long-press/right-click "Fix timing" menu;
 *   - a +1s nudge previews (moved counter), Done fires EXACTLY ONE PATCH with the
 *     final offset (loaded 8 + 1 = 9), Esc/cancel writes nothing;
 *   - reload shows the corrected placement (the persisted offset).
 *
 * Run: bash scripts/dev-verify.sh e2e/T8900-fix-timing.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { routeSeekableVideo } from './helpers/videoRoute.js';
import { saveEvidence } from './helpers/qa.js';

const GAME_ID = 990002;
let dir;
let mainPath;
let anglePath;

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 't8900-'));
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

// Mutable synthetic overlap game so the PATCH can move seq-2's offset and a
// reload reflects it (persistence observable).
function makeOverlapGame() {
  return {
    id: GAME_ID,
    name: 'Fix-timing QA game',
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
      { sequence: 2, video_url: '/stub-video/sideline.mp4', duration: 6, video_width: 320, video_height: 240, offset_seconds: 8, recorded_at: '2026-09-05T14:00:08Z', original_filename: 'sideline.mp4' },
    ],
  };
}

async function stubAndOpen(page, game, patches) {
  await page.route(/\/api\/(auth|games|clips|projects|admin|quests|profiles|teammate)/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ json: { user_id: 'e2e-user', email: 'test@e2e.local' } }));
  await page.route(/\/api\/auth\/init/, (r) => r.fulfill({ json: { profile_id: 'e2e-profile' } }));

  await page.route(new RegExp(`/api/games/${GAME_ID}/load`), (r) =>
    r.fulfill({ json: { game, playback_url: { url: '/stub-video/main.mp4', expires_in: 3600 }, teammate_shares: [], teammate_tags: [] } }));

  // Placement PATCH: capture the body, mutate the game (so reload reflects it),
  // and echo the updated row. Registered LAST so it wins over the catch-all.
  await page.route(new RegExp(`/api/games/${GAME_ID}/videos/(\\d+)/placement`), (r) => {
    const url = r.request().url();
    const seq = Number(url.match(/videos\/(\d+)\/placement/)[1]);
    const body = JSON.parse(r.request().postData() || '{}');
    patches.push({ seq, offset_seconds: body.offset_seconds });
    const v = game.videos.find((x) => x.sequence === seq);
    if (v) v.offset_seconds = body.offset_seconds; // mutate -> reload sees it
    r.fulfill({ json: v });
  });
  await page.route(new RegExp(`/api/games/${GAME_ID}(\\?|$)`), (r) => r.fulfill({ json: game }));

  await routeSeekableVideo(page, /\/stub-video\/main\.mp4/, mainPath);
  await routeSeekableVideo(page, /\/stub-video\/sideline\.mp4/, anglePath);
  // Anchor so this never swallows /videos/{seq}/placement (the "s" after "video").
  await routeSeekableVideo(page, new RegExp(`/api/games/${GAME_ID}/video(?![a-z])`), mainPath);

  await page.addInitScript((id) => sessionStorage.setItem('pendingGameId', String(id)), GAME_ID);
  await page.goto('/annotate', { waitUntil: 'domcontentloaded' });
}

test('open Fix-timing, +1s, Done -> one PATCH; reload shows the corrected placement', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  const game = makeOverlapGame();
  const patches = [];
  await stubAndOpen(page, game, patches);

  const bar = page.getByTestId('angle-bar-2');
  await expect(bar).toBeVisible({ timeout: 30000 });
  const leftBefore = await bar.evaluate((el) => el.style.left);

  // Open Fix-timing from the bar's right-click menu. Drive it with synthetic DOM
  // events: the menu is a transient popover that closes on any outside
  // pointerdown, so a real Playwright right-click + click races its own dismiss.
  await bar.dispatchEvent('contextmenu');
  const item = page.getByTestId('fix-timing-menu-item');
  await item.waitFor({ state: 'visible' });
  await item.dispatchEvent('click');
  await expect(page.getByTestId('fix-timing-strip')).toBeVisible();
  await expect(page.getByTestId('fix-timing-strip')).toContainText('sideline');
  await saveEvidence(page, 't8900-mode-open');

  // Nudge +1s -> moved counter reflects it.
  await page.getByTestId('fix-timing-nudge-1').click();
  await expect(page.getByTestId('fix-timing-moved')).toContainText('+1s');
  await saveEvidence(page, 't8900-nudged');

  // Done -> exactly one PATCH with the final offset (8 + 1 = 9).
  await page.getByTestId('fix-timing-done').click();
  await expect(page.getByTestId('fix-timing-strip')).toHaveCount(0);
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ seq: 2, offset_seconds: 9 });

  // Reload -> the persisted offset renders the bar at a NEW position.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const barAfter = page.getByTestId('angle-bar-2');
  await expect(barAfter).toBeVisible({ timeout: 30000 });
  const leftAfter = await barAfter.evaluate((el) => el.style.left);
  expect(leftAfter).not.toBe(leftBefore); // moved 8s -> 9s
  await saveEvidence(page, 't8900-reload-persisted');

  await context.close();
});

test('Esc discards Fix-timing without any write', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  const game = makeOverlapGame();
  const patches = [];
  await stubAndOpen(page, game, patches);

  const bar = page.getByTestId('angle-bar-2');
  await expect(bar).toBeVisible({ timeout: 30000 });
  await bar.dispatchEvent('contextmenu');
  const item = page.getByTestId('fix-timing-menu-item');
  await item.waitFor({ state: 'visible' });
  await item.dispatchEvent('click');
  await expect(page.getByTestId('fix-timing-strip')).toBeVisible();

  await page.getByTestId('fix-timing-nudge-1').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('fix-timing-strip')).toHaveCount(0);
  // No PATCH fired, and the primary CTA is back.
  await page.waitForTimeout(300);
  expect(patches.length).toBe(0);
  await expect(page.getByTestId('annotate-primary-cta')).toBeVisible();

  await context.close();
});
