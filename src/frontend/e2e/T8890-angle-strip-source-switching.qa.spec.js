/**
 * T8890 QA — the angle strip + source switching, driven end-to-end in a REAL
 * browser (not jsdom), against the vite dev server.
 *
 * WHY STUBBED (and not a real seeded game): there is no product path to CREATE
 * overlapping footage yet — the intake (T8800) deliberately discards overlapping
 * timestamps (EPIC decision 1), and the gestures that DO create overlap
 * (T8900 fix-timing / T8910 add-in-annotate) are not built. So a real 2-source
 * overlap game cannot exist until those ship. This spec therefore stubs the
 * /load response with a synthetic overlap game (seq 1 backbone 0-20s; seq 2
 * "sideline" angle at 8-14s, fully inside the backbone) and serves two REAL,
 * visibly-different tiny MP4s (blue backbone / red angle) with HTTP Range so the
 * A/B player is genuinely seekable and the swap is a real browser swap.
 *
 * It proves what the unit tests can only approximate:
 *   - the violet angle strip renders where the angle exists (real EDGE_PADDING
 *     layout), with an "Angles" label;
 *   - clicking the angle bar makes it active AND surfaces the over-video switcher
 *     (>= 2 sources cover the playhead), with the angle as the active source;
 *   - clicking the main track reverts to the backbone (main camera);
 *   - no horizontal overflow at 360 / 390 / 428 px.
 *
 * The full-pipeline seed (T8800->T8870->T8880->T8890) against a real R2-backed
 * 2-source game is owed at STAGING once T8900/T8910 provide an overlap-creating
 * gesture; this container has no R2 credentials and no way to author overlap.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8890-angle-strip-source-switching.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { routeSeekableVideo } from './helpers/videoRoute.js';
import { assertNoHorizontalOverflow, saveEvidence } from './helpers/qa.js';

const GAME_ID = 990001;
let dir;
let mainPath;
let anglePath;

test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 't8890-'));
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

// Synthetic overlap game: seq 2 (offset 8, dur 6) sits inside seq 1 (offset 0, dur 20).
function overlapGame() {
  return {
    id: GAME_ID,
    name: 'Overlap QA game',
    storage_status: 'active',
    video_duration: 20,
    video_width: 320,
    video_height: 240,
    video_size: 100000,
    viewed_duration: 0,
    last_playhead_position: null,
    annotations: [],
    videos: [
      { sequence: 1, video_url: '/stub-video/main.mp4', duration: 20, video_width: 320, video_height: 240, offset_seconds: 0, recorded_at: '2026-09-05T14:00:00Z' },
      { sequence: 2, video_url: '/stub-video/sideline.mp4', duration: 6, video_width: 320, video_height: 240, offset_seconds: 8, recorded_at: '2026-09-05T14:00:08Z' },
    ],
  };
}

async function stubAndOpen(page) {
  // Playwright matches routes in REVERSE registration order (last wins), so the
  // catch-all goes FIRST and the specific stubs after it override it. Scope it to
  // real API resource segments (NOT a bare "/api/", which also matches vite module
  // URLs and would serve JSON for a JS module) -> empty, so nothing hangs.
  await page.route(/\/api\/(auth|games|clips|projects|admin|quests|profiles|teammate)/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // Auth bypass without a backend: initSession() authenticates via these two.
  await page.route(/\/api\/auth\/me/, (r) => r.fulfill({ json: { user_id: 'e2e-user', email: 'test@e2e.local' } }));
  await page.route(/\/api\/auth\/init/, (r) => r.fulfill({ json: { profile_id: 'e2e-profile' } }));

  const game = overlapGame();
  await page.route(new RegExp(`/api/games/${GAME_ID}/load`), (r) =>
    r.fulfill({ json: { game, playback_url: { url: '/stub-video/main.mp4', expires_in: 3600 }, teammate_shares: [], teammate_tags: [] } }));
  await page.route(new RegExp(`/api/games/${GAME_ID}(\\?|$)`), (r) => r.fulfill({ json: game }));

  // Serve the two real MP4s (seekable) wherever the app requests them. Registered
  // AFTER the catch-all so the /api/.../video one wins.
  await routeSeekableVideo(page, /\/stub-video\/main\.mp4/, mainPath);
  await routeSeekableVideo(page, /\/stub-video\/sideline\.mp4/, anglePath);
  await routeSeekableVideo(page, new RegExp(`/api/games/${GAME_ID}/video`), mainPath);

  await page.addInitScript((id) => sessionStorage.setItem('pendingGameId', String(id)), GAME_ID);
  await page.goto('/annotate', { waitUntil: 'domcontentloaded' });
}

test('renders the violet angle strip and switches the active source', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  await stubAndOpen(page);

  // The angle strip + label render (only because an angle exists).
  await expect(page.getByTestId('angle-strip')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('angle-lane-label')).toBeVisible();
  const bar = page.getByTestId('angle-bar-2');
  await expect(bar).toBeVisible();
  expect(await bar.getAttribute('data-active')).toBe('false');
  // Angle sits inside the backbone => no coverage-extension hatch.
  await expect(page.getByTestId('angle-extension-hatch')).toHaveCount(0);
  await saveEvidence(page, 't8890-strip');

  // Click the angle bar -> seeks into its span AND makes it the active camera.
  await bar.click();
  await expect(page.getByTestId('angle-bar-2')).toHaveAttribute('data-active', 'true');
  // The over-video switcher appears now that >= 2 sources cover the playhead.
  await expect(page.getByTestId('angle-switcher-badge')).toBeVisible();
  await expect(page.getByTestId('angle-switch-2')).toHaveAttribute('aria-pressed', 'true');
  await saveEvidence(page, 't8890-switched');

  // Clicking the main camera segment reverts to the backbone.
  await page.getByTestId('angle-switch-1').click();
  await expect(page.getByTestId('angle-switch-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('angle-bar-2')).toHaveAttribute('data-active', 'false');

  await context.close();
});

test('no horizontal overflow at 360 / 390 / 428 px with the angle strip', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 390, height: 780 }, serviceWorkers: 'block', hasTouch: true, isMobile: true });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  await stubAndOpen(page);
  // Mobile: ONE merged strip.
  await expect(page.getByTestId('angle-strip-mobile')).toBeVisible({ timeout: 30000 });

  for (const width of [360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(250);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, `t8890-responsive-${width}`);
  }

  await context.close();
});
