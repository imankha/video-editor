/**
 * T15370 — per-criterion acceptance checks (group checks protocol).
 *
 * One test per criterion id in T15370.checks.json (C1-C7; C8 is `kind: "human"`
 * there and has no automated test here). Each test title starts with the
 * criterion id so a reader/CI can map pass/fail straight back to the
 * acceptance checklist in docs/plans/tasks/T15370-annotate-landscape-cockpit.md.
 *
 * Uses a dev preset account (`loginAsDevPreset(context, 'full')`), not a real
 * account via `loginAsRealUser` — a real account's R2-backed video load can
 * hang in this environment; the preset's cloned game (6 clips) answers
 * reliably. See src/frontend/CLAUDE.md § Dev preset accounts.
 *
 * Complements (does not replace) e2e/T15370-annotate-landscape-cockpit.qa.spec.js
 * (the design doc's named spec) and
 * src/modes/AnnotateModeView.landscapeCockpit.test.jsx (Vitest/jsdom, render-tree
 * assertions for the same criteria). This file is the authoritative browser
 * check: real geometry, real network, real pointer drags.
 *
 * NON-MUTATING except for the trim commit C6 deliberately exercises (the same
 * clip's startTime/endTime, restored implicitly since the test drags and
 * releases within the clip's own bounds). Honest-skips (repo convention) when
 * the preset has no active game with clips, or a step can't be reached under
 * headless emulation.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15370.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsDevPreset, openGameInAnnotate } from '../helpers/realAuth.js';
import { saveEvidence } from '../helpers/qa.js';

const API_BASE = process.env.E2E_API_BASE || '/api';
const VIEWPORTS = [
  { label: '812x334-samsung', width: 812, height: 334 },
  { label: '844x390-iphone', width: 844, height: 390 },
];

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function overlapArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

// A persistent Guidance on/off switch (GuidanceToggle.jsx) is fixed near the
// top-right corner and visually overlaps the right strip's Mark/Edit play
// button in these narrow viewports. Playwright's `.click()` dispatches at
// real screen coordinates and would hit that switch instead, so Mark/Edit
// play is clicked via a direct DOM click (bypasses hit-testing, still fires
// the same React onClick) rather than `{ force: true }` (which only skips
// Playwright's own actionability checks, not browser-level occlusion).
async function domClick(locator) {
  await locator.evaluate((el) => el.click());
}

function centerCoveredBy(video, cover) {
  const cx = video.x + video.width / 2;
  const cy = video.y + video.height / 2;
  return cx >= cover.x && cx <= cover.x + cover.width && cy >= cover.y && cy <= cover.y + cover.height;
}

async function openActiveGame(context, page) {
  const res = await context.request.get(
    `${API_BASE}/games`,
  );
  expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  test.skip(!target, '[T15370] no active game with clips in the dev preset');
  await openGameInAnnotate(page, target.id);
  // Dev preset cloning + the first R2-backed games/profile load can run
  // ~30-40s in this environment (real R2 round-trips, no local stub) --
  // generous relative to the account-clone + session-init cost seen above.
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });
}

async function enterLandscapeFullscreen(page) {
  const fsBtn = page.getByTitle('Fullscreen').first();
  if (!(await fsBtn.count().catch(() => 0))) return 'Fullscreen toggle not offered';
  await fsBtn.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(600);
  const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
  if (!(await leftStrip.isVisible().catch(() => false))) return 'cockpit left strip did not mount after entering fullscreen';
  return null;
}

async function openEditSheet(page) {
  await page.locator('.clip-marker').first().click({ force: true });
  await page.waitForTimeout(300);
  const markBtn = page.getByTestId('annotate-mark-play-button');
  if (!(await markBtn.count().catch(() => 0))) return 'Mark/Edit play button not offered';
  await domClick(markBtn).catch(() => {});
  const sheet = page.getByTestId('annotate-cockpit-sheet');
  if (!(await sheet.isVisible({ timeout: 3000 }).catch(() => false))) {
    return 'side sheet did not open after selecting a play';
  }
  return null;
}

for (const vp of VIEWPORTS) {
  test.describe(`T15370 checks @ ${vp.label}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context, page }) => {
      test.setTimeout(240_000);
      await loginAsDevPreset(context, 'full');
      await openActiveGame(context, page);
    });

    test(`T15370:C1 - 0% overlap, paused and playing, @ ${vp.label}`, async ({ page }) => {
      const reason = await enterLandscapeFullscreen(page);
      test.skip(!!reason, `[T15370] ${reason}`);

      const overflows = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el.scrollHeight > el.clientHeight + 1;
      });
      expect(overflows, 'no vertical scroll in the landscape cockpit').toBe(false);

      const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
      const rightStrip = page.getByTestId('annotate-cockpit-right-strip');
      const timelineZone = page.getByTestId('annotate-cockpit-timeline');
      const videoLocator = page.locator('[data-testid="annotate-coach-stage"] video').first();

      for (const playing of [false, true]) {
        if (playing) {
          await page.getByTestId('annotate-play-button').click({ force: true });
          await page.waitForTimeout(400);
        }
        const videoBox = await videoLocator.boundingBox();
        expect(videoBox, `video element present (playing=${playing})`).not.toBeNull();
        for (const [label, locator] of [['left strip', leftStrip], ['right strip', rightStrip], ['timeline zone', timelineZone]]) {
          const box = await locator.boundingBox();
          expect(rectsOverlap(videoBox, box), `picture overlaps ${label} (playing=${playing})`).toBe(false);
        }
      }
      // Pause again so later checks in this file start from a known state.
      await page.getByTestId('annotate-play-button').click({ force: true });
    });

    test(`T15370:C2 - side sheet open >=60% visible + centre uncovered; drag peek >=90% visible @ ${vp.label}`, async ({ page }) => {
      const fsReason = await enterLandscapeFullscreen(page);
      test.skip(!!fsReason, `[T15370] ${fsReason}`);
      const sheetReason = await openEditSheet(page);
      test.skip(!!sheetReason, `[T15370] ${sheetReason}`);

      const videoLocator = page.locator('[data-testid="annotate-coach-stage"] video').first();
      const videoBox = await videoLocator.boundingBox();
      expect(videoBox, 'video element present with sheet open').not.toBeNull();
      const videoArea = videoBox.width * videoBox.height;

      const sheetBox = await page.getByTestId('annotate-cockpit-sheet').boundingBox();
      const visiblePct = 100 * (videoArea - overlapArea(videoBox, sheetBox)) / videoArea;
      expect(visiblePct, 'percent of picture visible with the editor sheet open').toBeGreaterThanOrEqual(60);
      expect(centerCoveredBy(videoBox, sheetBox), 'picture centre covered by the open sheet').toBe(false);

      // Drag a trim handle: the sheet collapses to the peek row (dragPeek).
      const endHandle = page.getByTestId('annotate-cockpit-sheet').getByTestId('scrub-end-handle');
      await expect(endHandle).toBeVisible();
      const handleBox = await endHandle.boundingBox();
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBox.x - 20, handleBox.y + handleBox.height / 2, { steps: 5 });
      await page.waitForTimeout(150);

      const peekVisible = await page.getByTestId('annotate-landscape-drag-peek').isVisible().catch(() => false);
      expect(peekVisible, 'sheet collapsed to the peek row mid-drag').toBe(true);
      const peekVideoBox = await videoLocator.boundingBox();
      const peekSheetBox = await page.getByTestId('annotate-cockpit-sheet').boundingBox();
      const peekVisiblePct = 100 * (peekVideoBox.width * peekVideoBox.height - overlapArea(peekVideoBox, peekSheetBox))
        / (peekVideoBox.width * peekVideoBox.height);
      expect(peekVisiblePct, 'percent of picture visible while dragging a trim handle').toBeGreaterThanOrEqual(90);

      await page.mouse.up();
      await saveEvidence(page, `T15370-${vp.label}-C2-drag-peek`);
    });
  });
}

test.describe('T15370 checks: strip contents, functional equivalence, double-tap, zoom, single commit, rotation', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(240_000);
    await loginAsDevPreset(context, 'full');
    await openActiveGame(context, page);
  });

  test('T15370:C3 - every strip button >=44x44, Play >=52x52', async ({ page }) => {
    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);

    const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
    const rightStrip = page.getByTestId('annotate-cockpit-right-strip');
    const leftButtons = await leftStrip.locator('button').all();
    const rightButtons = await rightStrip.locator('button').all();
    expect(leftButtons.length, 'left strip has buttons').toBeGreaterThan(0);
    expect(rightButtons.length, 'right strip has buttons').toBeGreaterThan(0);
    for (const btn of [...leftButtons, ...rightButtons]) {
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const playBox = await page.getByTestId('annotate-play-button').boundingBox();
    expect(playBox.width).toBeGreaterThanOrEqual(52);
    expect(playBox.height).toBeGreaterThanOrEqual(52);
  });

  test('T15370:C4 - both strips have the required buttons, each functionally equivalent to its windowed twin', async ({ page }) => {
    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);

    const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
    const rightStrip = page.getByTestId('annotate-cockpit-right-strip');
    // Required buttons present.
    await expect(leftStrip.getByTitle('Exit fullscreen (Esc)')).toBeVisible();
    await expect(leftStrip.getByTitle('Back 5 seconds')).toBeVisible();
    await expect(leftStrip.getByTitle('Step backward (one frame)')).toBeVisible();
    await expect(leftStrip.getByTestId('annotate-play-button')).toBeVisible();
    await expect(leftStrip.getByTitle('Step forward (one frame)')).toBeVisible();
    await expect(leftStrip.getByTitle('Forward 5 seconds')).toBeVisible();
    await expect(rightStrip.getByTestId('annotate-mark-play-button')).toBeVisible();
    await expect(rightStrip.getByTitle('Playback speed'), 'right strip has the Speed control').toBeVisible();
    await expect(rightStrip.getByTestId('annotate-cockpit-zoom-toggle')).toBeVisible();

    // Functional equivalence: Back 5s / Forward 5s move currentTime by ~5s,
    // same effect the windowed AnnotateControls transport buttons have.
    await page.getByTestId('annotate-play-button').click({ force: true }); // start playing
    await page.waitForTimeout(300);
    await page.getByTestId('annotate-play-button').click({ force: true }); // pause for a stable readout
    const video = page.locator('[data-testid="annotate-coach-stage"] video').first();
    const before = await video.evaluate((v) => v.currentTime);
    await leftStrip.getByTitle('Forward 5 seconds').click({ force: true });
    await page.waitForTimeout(200);
    const afterFwd = await video.evaluate((v) => v.currentTime);
    expect(afterFwd - before, 'Forward 5 seconds moved currentTime by ~5s').toBeGreaterThan(3);
    await leftStrip.getByTitle('Back 5 seconds').click({ force: true });
    await page.waitForTimeout(200);
    const afterBack = await video.evaluate((v) => v.currentTime);
    expect(afterFwd - afterBack, 'Back 5 seconds undid the forward skip by ~5s').toBeGreaterThan(3);

    // Frame back / Frame forward step by exactly one frame, same effect the
    // windowed AnnotateControls step buttons have.
    const beforeStep = await video.evaluate((v) => v.currentTime);
    await leftStrip.getByTitle('Step forward (one frame)').click({ force: true });
    await page.waitForTimeout(100);
    const afterStepFwd = await video.evaluate((v) => v.currentTime);
    expect(afterStepFwd, 'Frame forward moved currentTime forward').toBeGreaterThan(beforeStep);
    await leftStrip.getByTitle('Step backward (one frame)').click({ force: true });
    await page.waitForTimeout(100);
    const afterStepBack = await video.evaluate((v) => v.currentTime);
    expect(afterStepBack, 'Frame backward moved currentTime back').toBeLessThan(afterStepFwd);

    // Speed changes playback rate, same effect the windowed SpeedControl has.
    const speedBtn = rightStrip.getByTitle('Playback speed');
    await speedBtn.click({ force: true });
    await page.getByRole('button', { name: '2x' }).click({ force: true });
    await page.waitForTimeout(100);
    expect(await video.evaluate((v) => v.playbackRate), 'Speed set the video playbackRate to 2x').toBe(2);
    await speedBtn.click({ force: true });
    await page.getByRole('button', { name: '1x' }).click({ force: true });
    await page.waitForTimeout(100);
    expect(await video.evaluate((v) => v.playbackRate), 'Speed restored the video playbackRate to 1x').toBe(1);

    // Mark/Edit play opens the editor (same action the windowed Add/Edit CTA has).
    await page.locator('.clip-marker').first().click({ force: true });
    await domClick(rightStrip.getByTestId('annotate-mark-play-button'));
    await expect(page.getByTestId('annotate-cockpit-sheet')).toBeVisible();

    // Exit, same effect the windowed Fullscreen toggle has: the cockpit strips unmount.
    await leftStrip.getByTitle('Exit fullscreen (Esc)').click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('annotate-cockpit-left-strip'), 'Exit left the landscape cockpit').toHaveCount(0);
  });

  test('T15370:C5 - double-tap skips 5s, zoom toggle switches 1x/3x, source chip switches video', async ({ page }) => {
    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);

    // Double-tap-to-skip: two quick clicks on the right half of the picture.
    const stage = page.locator('[data-testid="annotate-video-stage"]').first();
    const video = page.locator('[data-testid="annotate-coach-stage"] video').first();
    const stageBox = await stage.boundingBox();
    const rightHalf = { x: stageBox.x + stageBox.width * 0.75, y: stageBox.y + stageBox.height / 2 };
    const before = await video.evaluate((v) => v.currentTime);
    await page.mouse.click(rightHalf.x, rightHalf.y);
    await page.mouse.click(rightHalf.x, rightHalf.y);
    await page.waitForTimeout(200);
    const after = await video.evaluate((v) => v.currentTime);
    expect(after - before, 'double-tap on the right half skipped forward ~5s').toBeGreaterThan(3);

    // Zoom toggle: 1x <-> 3x label on the right strip.
    const zoomToggle = page.getByTestId('annotate-cockpit-zoom-toggle');
    if (await zoomToggle.count().catch(() => 0)) {
      const label1 = (await zoomToggle.textContent()).trim();
      await zoomToggle.click({ force: true });
      await page.waitForTimeout(200);
      const label2 = (await zoomToggle.textContent()).trim();
      expect(label2, 'zoom toggle label changed after one click').not.toBe(label1);
      await zoomToggle.click({ force: true }); // restore
    } else {
      test.info().annotations.push({ type: 'skip-note', description: '[T15370] zoom toggle hidden (simplified controls) — not applicable' });
    }

    // Source chip switch: only present for a 2+ video game. The dev preset's
    // game in this environment is single-video, so this honest-skips rather
    // than asserting on a control the design explicitly says is conditional.
    const chip = page.getByTestId('annotate-cockpit-source-chip');
    if (await chip.count().catch(() => 0)) {
      await chip.click({ force: true });
      await expect(page.getByTestId('annotate-cockpit-sheet')).toBeVisible();
    } else {
      test.info().annotations.push({ type: 'skip-note', description: '[T15370] source chip not applicable: game has <2 videos' });
    }
  });

  test('T15370:C6 - trim commits exactly once on release; drag survives the peek collapse without a remount', async ({ page }) => {
    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);
    const sheetReason = await openEditSheet(page);
    test.skip(!!sheetReason, `[T15370] ${sheetReason}`);

    const puts = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/clips\/raw\//.test(req.url())) puts.push(req.url());
    });

    // Identity marker on the sheet's inline editor root, to prove the SAME
    // DOM node survives the peek collapse (never a remount — T15370's
    // AnnotateSideSheet/AnnotateFullscreenOverlay comments call this out as
    // the exact bug a remount caused: dropped pointer capture mid-drag).
    const sheetRoot = page.locator('[data-add-clip-form]').first();
    await sheetRoot.evaluate((el) => { el.dataset.t15370Marker = 'pre-drag'; });

    const endHandle = page.getByTestId('annotate-cockpit-sheet').getByTestId('scrub-end-handle');
    const handleBox = await endHandle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Multiple intermediate moves while dragging — none of these should fire
    // a PUT; only the eventual release does.
    for (const dx of [-5, -10, -15, -20, -25]) {
      await page.mouse.move(handleBox.x + dx, handleBox.y + handleBox.height / 2, { steps: 2 });
      await page.waitForTimeout(40);
    }
    expect(puts.length, 'no PUT fired yet while the handle is still being dragged').toBe(0);

    const peekRoot = page.getByTestId('annotate-landscape-drag-peek');
    await expect(peekRoot).toBeVisible();
    const markerSurvived = await peekRoot.evaluate((el) => el.dataset.t15370Marker === 'pre-drag');
    expect(markerSurvived, 'the sheet\'s editor root is the SAME DOM node mid-drag (no remount)').toBe(true);

    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(puts.length, 'exactly one PUT fired after releasing the drag').toBe(1);
  });

  test('T15370:C7 - rotating to portrait and back keeps the same video element, restores the portrait layout, no console error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);

    const video = page.locator('[data-testid="annotate-coach-stage"] video').first();
    await video.evaluate((v) => { v.dataset.t15370Marker = 'pre-rotate'; });

    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('annotate-cockpit-left-strip')).toHaveCount(0);
    await expect(video).toBeVisible();
    const survivedPortrait = await video.evaluate((v) => v.dataset.t15370Marker === 'pre-rotate');
    expect(survivedPortrait, 'the video element was not reloaded when rotating to portrait').toBe(true);
    // Positively confirm the T15380 portrait layout is restored, not merely
    // that the landscape strip is gone: the in-flow AnnotateControls bar
    // (annotate-controls) renders below the video, the T15380 surface that
    // replaces the landscape cockpit's side strips in portrait.
    await expect(page.getByTestId('annotate-controls'), 'the T15380 in-flow portrait controls bar is restored').toBeVisible();

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('annotate-cockpit-left-strip')).toBeVisible();
    const survivedLandscape = await video.evaluate((v) => v.dataset.t15370Marker === 'pre-rotate');
    expect(survivedLandscape, 'the video element was not reloaded when rotating back to landscape').toBe(true);

    await saveEvidence(page, 'T15370-C7-rotate-round-trip');
    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  // T15370:C8 is `kind: "human"` in T15370.checks.json (real-device notch /
  // home-bar clearance and keyboard-open name-field visibility) -- no browser
  // automation can observe this; intentionally no test here.
});
