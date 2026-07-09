/**
 * Tutorial capture: OVERLAY quest. SOURCE OF TRUTH — copy into
 * video-editor/src/frontend/e2e/ before running. Marks map to line numbers in
 * ReelBallersTutroials/overlay/talk_track.txt.
 *
 * Uses a draft in "In Overlay" status and REALLY clicks Add Spotlight at the end
 * (render job runs on the dev backend after the recording stops).
 */
import { test } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { OVERLAY_INIT, makeKit, finishCapture } from './helpers/tutorialCapture';

const QUEST_DIR = 'C:/Users/imank/Videos/Captures/ReelBallersTutroials/overlay';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const W = 1920, H = 1080;

test('capture overlay tutorial footage', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: QUEST_DIR, size: { width: W, height: H } },
  });
  await context.addInitScript(OVERLAY_INIT);
  await loginAsRealUser(context, 'imankh@gmail.com');
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const kit = makeKit(page);
  const { mark, ring, clearRing, act, drag, dwell, step, videosReady, pauseVideos } = kit;
  let playerPos = null;                        // where the assigned player is on screen

  // --- PRE-ROLL (excluded from the roughcut: everything before mark(0) is cut) --
  // stage the highlight shape to BODY (persists per draft) and warm the editor
  step('pre-roll: set shape to Body');
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const overlayChip = page.getByTitle(/^Overlay: .*\(click to open\)/).first();
  const openBtn = page.getByTitle('Open in Overlay').first();
  let target = overlayChip;
  try { await overlayChip.waitFor({ timeout: 4000 }); } catch { target = openBtn; }
  await target.click();
  const marker = page.getByTitle(/Click to (assign|revisit)/).first();
  await marker.waitFor({ timeout: 90000 });
  try {
    const bodyBtn = page.getByRole('button', { name: 'Body', exact: true }).first();
    await bodyBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
    await bodyBtn.click();
    await dwell(0.8);
  } catch { step('pre-roll Body click failed'); }
  await page.getByText('Reel Drafts', { exact: true }).first().click();  // breadcrumb home
  await page.getByRole('button', { name: /^In Overlay \(|^All \(/ }).first()
    .waitFor({ timeout: 15000 }).catch(() => {});
  await dwell(1);

  // --- line 0: intro -------------------------------------------------------------
  await page.mouse.move(960, 420);
  await mark(0);                               // "Next, add a spotlight..."
  await dwell(2.5);

  // --- line 1: open your reel in Overlay mode ---------------------------------------
  step('open overlay');
  await target.waitFor({ timeout: 8000 });
  await ring(target, 10);
  await dwell(1);
  await mark(1, 'Overlay');
  await act(target);
  await clearRing();
  step('waiting for overlay editor + detection');
  await marker.waitFor({ timeout: 90000 });
  await videosReady(1, 45000);
  await pauseVideos();                        // boxes only render while ON a detection frame

  // --- line 2: loads working video + auto-detects players -----------------------------
  // show the TOP first (the "Overlay" tab is visible), then scroll just enough to
  // see the video + the player-tracker layer together — no more scrolling until line 8
  const boxSel = '[class*="pointer-events-auto"][class*="cursor-pointer"]';
  await mark(2);
  await dwell(1.2);
  await page.mouse.move(960, 500);
  await page.mouse.wheel(0, 240);
  await dwell(0.4);
  try {
    await act(marker);                         // land on a detection frame -> green boxes
    await page.locator(boxSel).first().waitFor({ timeout: 8000 });
  } catch { step('detection frame seek failed'); }
  await dwell(2.2);

  // --- line 3: green markers along the timeline ----------------------------------------
  await mark(3, 'markers');
  try { await ring(marker, 16); } catch {}
  await dwell(3);
  await clearRing();

  // --- line 4: click each marker, then tap your player -----------------------------------
  step('assign player');
  await mark(4, 'Click');
  try {
    await act(marker);                         // marker click (ripple)...
    const box = page.locator(boxSel).first();
    await box.waitFor({ timeout: 6000 });
    await dwell(0.8);
    const bb = await box.boundingBox();
    if (bb) playerPos = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
    await act(box);                            // ...then tap the player box (ripple)
  } catch { step('assign skipped'); }
  await dwell(1.6);
  try {                                        // second marker -> second tap
    const m2 = page.getByTitle(/Click to (assign|revisit)/).nth(1);
    await act(m2);
    await page.locator(boxSel).first().waitFor({ timeout: 5000 });
    await dwell(0.8);
    await act(page.locator(boxSel).first());
  } catch { step('second assign skipped'); }
  await dwell(1.6);

  // --- line 5: sometimes the tracker misses ----------------------------------------------
  await mark(5);
  await dwell(3.5);

  // --- line 6: turn the tracker layer off, then place the circle by hand ---------------------
  step('tracker off + manual placement');
  await mark(6, 'tracker');
  try {                                        // the tracker layer's crosshair toggle
    const trackerToggle = page.getByTitle('Hide player boxes').first();
    await ring(trackerToggle, 8);
    await dwell(1);
    await act(trackerToggle);
    await clearRing();
  } catch { step('tracker toggle skipped'); await clearRing(); }
  await dwell(1);
  try {                                        // drag the circle onto the same player
    const circle = page.locator('.cursor-move').first();
    const cb = await circle.boundingBox({ timeout: 5000 });
    const target = playerPos || { x: cb.x + cb.width / 2 + 60, y: cb.y + cb.height / 2 + 20 };
    await drag(cb.x + cb.width / 2, cb.y + cb.height / 2, target.x, target.y, 28);
  } catch { step('circle drag skipped'); }
  await dwell(2);

  // --- line 7: play it back once ------------------------------------------------------------
  await mark(7, 'Play');
  await videosReady(1, 8000);                  // starts playback
  await dwell(4.5);                            // ...one watch-through
  await pauseVideos();

  // --- line 8: overlay settings -------------------------------------------------------------------
  // second (and last) scroll: bottom of the video + the Add Spotlight button visible
  step('settings');
  await mark(8);
  await page.mouse.move(960, 500);
  await page.mouse.wheel(0, 380);
  await dwell(0.5);
  const settings = page.getByText('Overlay Settings').first();
  try { await ring(settings, 14); } catch {}
  await dwell(2);
  await clearRing();

  // --- line 9: pick a highlight color ------------------------------------------------------------------
  const cyan = page.getByTitle('Cyan').first();
  try { await ring(cyan, 10); } catch {}
  await dwell(0.8);
  await mark(9, 'color');
  try { await act(cyan); } catch { step('color skipped'); }
  await clearRing();
  await dwell(1.6);

  // --- line 10: choose the shape --------------------------------------------------------------------------
  await mark(10, 'shape');
  try { await ring(page.getByText('Shape', { exact: true }).first(), 16); } catch {}
  await dwell(1.4);
  await clearRing();

  // --- line 11: Body wraps / Ground glows -------------------------------------------------------------------
  await mark(11, 'Body');
  try {
    await act(page.getByRole('button', { name: 'Body', exact: true }).first());
    await dwell(2);
    await act(page.getByRole('button', { name: 'Ground', exact: true }).first());
  } catch { step('shape buttons skipped'); }
  await dwell(2);

  // --- line 12: click Add Spotlight -----------------------------------------------------------------------------
  step('add spotlight');
  const addSpot = page.getByRole('button', { name: 'Add Spotlight', exact: true }).first();
  await ring(addSpot, 8);
  await dwell(1);
  await mark(12, 'click');
  await act(addSpot);
  await clearRing();
  await dwell(3.5);

  await finishCapture(context, page, kit, QUEST_DIR, { width: W, height: H });
});
