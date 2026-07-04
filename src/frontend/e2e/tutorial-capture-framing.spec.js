/**
 * Tutorial capture: FRAMING quest. SOURCE OF TRUTH — copy into
 * video-editor/src/frontend/e2e/ before running. Marks map to line numbers in
 * ReelBallersTutroials/framing/talk_track.txt.
 *
 * Uses a Not-Started draft and REALLY exports it at the end (render job runs on
 * the dev backend after the recording stops).
 */
import { test } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { OVERLAY_INIT, makeKit, finishCapture } from './helpers/tutorialCapture';

const QUEST_DIR = 'C:/Users/imank/Videos/Captures/ReelBallersTutroials/framing';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const W = 1920, H = 1080;

test('capture framing tutorial footage', async ({ browser }) => {
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
  const { mark, ring, clearRing, act, drag, dwell, step, videosReady } = kit;

  // --- lines 0-2: intro over the drafts list -----------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  await page.mouse.move(960, 420);
  await mark(0);                               // "Your best clips are now reel drafts."
  await dwell(2.5);
  const firstCard = page.locator('[data-testid="project-card"]').first();
  await mark(1);                               // "...you first frame it."
  try { await ring(firstCard, 6); } catch {}
  await dwell(3.5);
  await clearRing();
  await mark(2);                               // "Framing lets you crop..."
  await dwell(4);

  // --- line 3: each card shows progress -----------------------------------------
  step('filter + target card');
  try { await page.getByRole('button', { name: /^Not Started \(/ }).click(); } catch {}
  await dwell(0.8);
  const framingChip = page.getByTitle(/: Not Started \(click to open\)/).first();
  await framingChip.waitFor();
  await mark(3, 'card');
  await ring(framingChip, 10);
  await dwell(3.5);
  await clearRing();

  // --- line 4: pick a draft -------------------------------------------------------
  await ring(framingChip, 10);
  await dwell(0.8);
  await mark(4, 'Pick');
  await act(framingChip);
  await clearRing();
  step('waiting for framing editor');
  const cropHandle = page.locator('.crop-handle').first();
  await cropHandle.waitFor({ timeout: 90000 });
  await videosReady(1, 45000);
  await dwell(1.5);

  // --- line 5: the white box ---------------------------------------------------------
  await mark(5);
  const cropBox = cropHandle.locator('xpath=..');
  try { await ring(cropBox, 6); } catch {}
  await dwell(3);
  await clearRing();

  // --- line 6: drag and resize the box --------------------------------------------------
  step('drag crop box');
  await mark(6, 'Drag');
  try {
    const b = await cropBox.boundingBox({ timeout: 5000 });
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await drag(cx, cy, cx + 110, cy - 30, 30);            // reposition
    await dwell(0.8);
    const h = await page.locator('.crop-handle').last().boundingBox({ timeout: 5000 });
    await drag(h.x + h.width / 2, h.y + h.height / 2,
               h.x + h.width / 2 + 35, h.y + h.height / 2 + 35, 22);  // resize corner
  } catch { step('crop drag skipped'); }
  await dwell(1.5);

  // --- line 7: reposition when the player drifts ------------------------------------------
  await mark(7);
  try {
    const b = await cropBox.boundingBox({ timeout: 5000 });
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await drag(cx, cy, cx - 90, cy + 20, 30);
  } catch {}
  await dwell(3);

  // --- line 8: each move sets a keyframe ----------------------------------------------------
  await mark(8);
  const segLabel = page.getByText('Split Segments to trim or control speed').first();
  try { await ring(segLabel.locator('xpath=ancestor::div[2]'), 8); } catch {}
  await dwell(4.2);
  await clearRing();

  // --- lines 9-10: split segments + half speed ------------------------------------------------
  step('split segments');
  await mark(9, 'Split');
  try { await ring(segLabel.locator('xpath=ancestor::div[2]'), 8); } catch {}
  await dwell(3);
  await clearRing();
  await mark(10, 'Mark');
  try {
    const sb = await segLabel.locator('xpath=ancestor::div[2]').boundingBox({ timeout: 5000 });
    const y = sb.y + sb.height / 2;
    await page.mouse.move(sb.x + sb.width * 0.35, y, { steps: 15 });
    await page.mouse.click(sb.x + sb.width * 0.35, y);
    await dwell(0.8);
    await page.mouse.move(sb.x + sb.width * 0.62, y, { steps: 15 });
    await page.mouse.click(sb.x + sb.width * 0.62, y);
    await dwell(1);
    await act(page.getByTitle('Set speed to 0.5x').first());
  } catch { step('split skipped'); }
  await dwell(1.6);

  // --- line 11: switch background to Dim ---------------------------------------------------------
  step('dim');
  const dimToggle = page.locator('button[aria-label="Toggle background darkness"]').first();
  try { await ring(dimToggle, 26); } catch {}
  await dwell(1);
  await mark(11, 'Dim');
  try { await act(dimToggle); } catch { step('dim skipped'); }
  await clearRing();
  await videosReady(1, 8000);                  // watch it through (force-plays)
  await dwell(2);

  // --- line 12: dimmed edges ----------------------------------------------------------------------
  await mark(12);
  await dwell(4.5);

  // --- line 13: click Export ----------------------------------------------------------------------
  step('export');
  const exportBtn = page.getByRole('button', { name: 'Export', exact: true }).first();
  await ring(exportBtn, 8);
  await dwell(1);
  await mark(13, 'Export');
  await act(exportBtn);
  await clearRing();
  await dwell(3);

  // --- line 14: upscales while you frame another ----------------------------------------------------
  await mark(14);
  try { await act(page.getByText('Reel Drafts', { exact: true }).first()); } catch {}
  await dwell(3.5);

  await finishCapture(context, page, kit, QUEST_DIR, { width: W, height: H });
});
