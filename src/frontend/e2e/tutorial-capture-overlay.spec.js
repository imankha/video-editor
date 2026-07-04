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
  const { mark, ring, clearRing, act, dwell, step, videosReady } = kit;

  // --- line 0: intro -------------------------------------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  await page.mouse.move(960, 420);
  await mark(0);                               // "Next, add a spotlight..."
  await dwell(2.5);

  // --- line 1: open your reel in Overlay mode ---------------------------------------
  step('open overlay');
  try { await page.getByRole('button', { name: /^In Overlay \(/ }).click(); } catch {}
  await dwell(1);
  const overlayChip = page.getByTitle(/^Overlay: .*\(click to open\)/).first();
  const openBtn = page.getByTitle('Open in Overlay').first();
  let target = overlayChip;
  try { await overlayChip.waitFor({ timeout: 4000 }); } catch { target = openBtn; }
  await ring(target, 10);
  await dwell(1);
  await mark(1, 'Overlay');
  await act(target);
  await clearRing();
  step('waiting for overlay editor + detection');
  const marker = page.getByTitle(/Click to (assign|revisit)/).first();
  await marker.waitFor({ timeout: 90000 });
  await videosReady(1, 45000);
  await dwell(1);

  // --- line 2: loads working video + auto-detects players -----------------------------
  await mark(2);
  await dwell(4.5);

  // --- line 3: green markers along the timeline ----------------------------------------
  await mark(3, 'markers');
  try { await ring(marker, 16); } catch {}
  await dwell(3);
  await clearRing();

  // --- line 4: click each one and tap your player ---------------------------------------
  step('assign player');
  await mark(4, 'Click');
  try {
    await act(marker);
    await dwell(1.2);
    const box = page.locator('[class*="pointer-events-auto"][class*="cursor-pointer"]').first();
    await box.waitFor({ timeout: 6000 });
    await act(box);
  } catch { step('assign skipped'); }
  await dwell(2.5);

  // --- line 5: sometimes the tracker misses ----------------------------------------------
  await mark(5);
  await dwell(3.5);

  // --- line 6: place the circle by hand ----------------------------------------------------
  step('manual placement');
  await mark(6, 'tracker');
  try {
    const m2 = page.getByTitle(/Click to (assign|revisit)/).nth(1);
    await act(m2);
    await dwell(1.2);
    const vid = page.locator('video').first();
    const vb = await vid.boundingBox({ timeout: 5000 });
    await page.mouse.move(vb.x + vb.width * 0.55, vb.y + vb.height * 0.62, { steps: 20 });
    await page.mouse.click(vb.x + vb.width * 0.55, vb.y + vb.height * 0.62);
  } catch { step('manual placement skipped'); }
  await dwell(2.5);

  // --- line 7: play it back --------------------------------------------------------------------
  await mark(7, 'Play');
  await videosReady(1, 8000);
  await dwell(5);

  // --- line 8: overlay settings -------------------------------------------------------------------
  step('settings');
  await mark(8);
  const settings = page.getByText('Overlay Settings').first();
  try {
    await settings.scrollIntoViewIfNeeded({ timeout: 4000 });
    await ring(settings, 14);
  } catch {}
  await dwell(2.5);
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
