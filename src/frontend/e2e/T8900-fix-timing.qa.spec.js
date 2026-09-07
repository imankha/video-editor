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
 * T5380 LANDMINE: jsdom pointer-event tests (AngleLanes.fixTiming.test.jsx) gave
 * false confidence before on setPointerCapture semantics diverging from a real
 * browser. The two "real pointer drag" tests below drive an ACTUAL Chromium
 * mouse drag (page.mouse down/move/up, real PointerEvents incl. setPointerCapture)
 * rather than fireEvent, so the #1 acceptance criterion (accidental drag
 * structurally impossible outside the mode) is proven in a real browser, not just
 * jsdom.
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

// EDGE_PADDING mirrors TimelineBase.jsx / AngleLanes.jsx's default (20px) — used
// to convert a real drag's pixel delta into the offset_seconds we expect the
// endpoint to receive, so the drag assertion is tied to the actual distance
// dragged, not just "some number changed".
const EDGE_PADDING = 20;
const TIMELINE_DURATION_S = 20; // backbone (seq 1) duration in makeOverlapGame()

/** A REAL Chromium pointer drag (mouse down/move/up -> real PointerEvents,
 * including setPointerCapture) on `locator`, moving `dxPx` horizontally. */
async function realDrag(page, locator, dxPx) {
  // boundingBox() is PAGE-relative but page.mouse is VIEWPORT-relative — if the
  // bar sits below the fold (this game's timeline does, at 1280x800) those
  // coordinates land off-screen and the mouse events hit nothing. Scroll it
  // into view first so the drag coordinates are actually on-screen.
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dxPx, startY, { steps: 12 });
  await page.mouse.up();
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

test('T5380 guard: a REAL pointer drag OUTSIDE Fix-timing mode does nothing (no PATCH, bar unmoved)', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  const game = makeOverlapGame();
  const patches = [];
  await stubAndOpen(page, game, patches);

  const bar = page.getByTestId('angle-bar-2');
  await expect(bar).toBeVisible({ timeout: 30000 });
  expect(await bar.getAttribute('data-fix-target')).toBe('false');
  const leftBefore = await bar.evaluate((el) => el.style.left);

  // Fix-timing is NOT open (fixSequence is null everywhere) — attempt a REAL
  // mouse drag (down+move+up, real PointerEvents/setPointerCapture) directly on
  // the bar. Per the structural gate (dragProps only attached when
  // isFixTarget), this must be a no-op: no drag, no PATCH.
  await realDrag(page, bar, 120);
  await page.waitForTimeout(300); // let any (wrongly) fired async PATCH land

  const leftAfter = await bar.evaluate((el) => el.style.left);
  expect(leftAfter).toBe(leftBefore); // position unchanged — no drag happened
  expect(patches.length).toBe(0); // no write of any kind
  // Fix-timing must still be closed (the drag didn't accidentally open it).
  await expect(page.getByTestId('fix-timing-strip')).toHaveCount(0);

  await context.close();
});

test('T5380 guard: a REAL pointer drag INSIDE Fix-timing mode moves the bar; Done fires exactly one PATCH', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  const game = makeOverlapGame();
  const patches = [];
  await stubAndOpen(page, game, patches);

  const bar = page.getByTestId('angle-bar-2');
  await expect(bar).toBeVisible({ timeout: 30000 });

  // Open Fix-timing (menu-open mechanics are exercised by the earlier tests;
  // here we drive the OPEN via synthetic events so this test isolates the
  // real-pointer DRAG itself, same pattern as the tests above).
  await bar.dispatchEvent('contextmenu');
  const item = page.getByTestId('fix-timing-menu-item');
  await item.waitFor({ state: 'visible' });
  await item.dispatchEvent('click');
  await expect(page.getByTestId('fix-timing-strip')).toBeVisible();

  const target = page.getByTestId('angle-bar-2');
  expect(await target.getAttribute('data-fix-target')).toBe('true');
  const leftBefore = await target.evaluate((el) => el.style.left);

  // Real drag of +120px. Convert to the expected offset_seconds via the SAME
  // formula AngleLanes uses (pixel delta / usableWidth * duration), so the
  // eventual PATCH is checked against the actual distance dragged, not just
  // "some number changed".
  const trackBox = await page.getByTestId('angle-strip').boundingBox();
  const usableWidth = trackBox.width - EDGE_PADDING * 2;
  const dxPx = 120;
  const expectedDeltaSeconds = (dxPx / usableWidth) * TIMELINE_DURATION_S;
  const expectedOffset = 8 + expectedDeltaSeconds; // loaded offset_seconds is 8

  await realDrag(page, target, dxPx);

  // Wait on an AUTO-RETRYING assertion first — mouse.up() only confirms the OS
  // event was dispatched, not that React has re-rendered from the resulting
  // state update. A raw el.evaluate() read straight after would race that
  // render (this is exactly the class of jsdom-vs-real-browser timing gap
  // T5380 warns about: a plain read has no retry, an `expect(...)` does).
  await expect(page.getByTestId('fix-timing-moved')).not.toContainText('Moved 0s');
  // Now the render has landed — the bar's rendered position previews the drag live.
  const leftDuringDrag = await target.evaluate((el) => el.style.left);
  expect(leftDuringDrag).not.toBe(leftBefore);
  expect(patches.length).toBe(0); // preview only — nothing written yet
  await saveEvidence(page, 't8900-real-drag-preview');

  // Done -> EXACTLY ONE PATCH, carrying the dragged-to offset (within the
  // rounding the strip's own display uses).
  await page.getByTestId('fix-timing-done').click();
  await expect(page.getByTestId('fix-timing-strip')).toHaveCount(0);
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].seq).toBe(2);
  expect(patches[0].offset_seconds).toBeCloseTo(expectedOffset, 0);

  await context.close();
});
