/**
 * Tutorial capture: ANNOTATE quest. SOURCE OF TRUTH — copy into
 * video-editor/src/frontend/e2e/ before running. Marks map to line numbers in
 * ReelBallersTutroials/annotate/talk_track.txt.
 *
 * Creates one demo clip ("Brilliant Scan and Pass") + its reel draft, then deletes
 * both via API after the recording ends, so repeated captures don't accumulate data.
 */
import { test } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';
import { OVERLAY_INIT, makeKit, finishCapture } from './helpers/tutorialCapture';

const QUEST_DIR = 'C:/Users/imank/Videos/Captures/ReelBallersTutroials/annotate';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const W = 1920, H = 1080;
const CLIP_NAME = 'Brilliant Scan and Pass';
const GAME_ID = 7;                            // 'at Sporting Mar 21'

test('capture annotate tutorial footage', async ({ browser }) => {
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
  const { mark, ring, clearRing, act, drag, typeInto, dwell, step, videosReady } = kit;

  // --- line 0: home screen ----------------------------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Games/ }).first().waitFor();
  await page.mouse.move(960, 400);
  await mark(0);
  await dwell(3);

  // --- line 1: pick your sport --------------------------------------------------
  step('sport picker');
  const sportBtn = page.getByRole('button', { name: /Switch sport or profile/ }).first();
  await ring(sportBtn, 8);
  await dwell(1);
  await mark(1, 'sport');
  await act(sportBtn);
  await dwell(1.4);
  const profileRow = page.locator(
    'button[title="Active profile"], button[title="Switch to this profile"]').first();
  try { await act(profileRow); } catch {}
  await clearRing();
  await dwell(1.2);
  await page.keyboard.press('Escape');
  await dwell(0.5);

  // --- line 2: the game opens in Annotate ----------------------------------------
  step('open game');
  await page.getByRole('button', { name: /^Games/ }).first().click();
  await dwell(1);
  const gameCard = page.getByRole('button', { name: /at Sporting Mar 21/ }).first();
  await ring(gameCard, 8);
  await dwell(0.8);
  await mark(2, 'opens');
  await act(gameCard);
  await clearRing();
  try {
    await page.waitForURL('**/annotate**', { timeout: 8000 });
  } catch {
    step('card click did not navigate — falling back to direct annotate open');
    await openGameInAnnotate(page, GAME_ID);
  }
  const addClip = page.getByRole('button', { name: 'Add Clip', exact: true }).first();
  await addClip.waitFor({ timeout: 45000 });
  await videosReady(1, 25000);
  await dwell(1.5);

  // --- line 3: clips left, match center --------------------------------------------
  step('clips list');
  await mark(3);
  try { await ring(page.getByText(/Brilliant |Good /).first(), 24); } catch {}
  await dwell(4);
  await clearRing();

  // --- line 4: scrub through ----------------------------------------------------------
  step('scrub');
  await mark(4, 'Scrub');
  try {
    const vid = page.locator('video').first();
    const vb = await vid.boundingBox();
    await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2, { steps: 10 });
    await dwell(0.4);
    const bar = page.locator('div.bg-gray-700.cursor-pointer').first();  // TimelineBase track
    const bb = await bar.boundingBox({ timeout: 5000 });
    const y = bb.y + bb.height / 2;
    await drag(bb.x + bb.width * 0.30, y, bb.x + bb.width * 0.48, y, 35);
  } catch { step('scrub skipped'); }
  await dwell(3);

  // --- line 5: click Add Clip ------------------------------------------------------------
  step('add clip');
  await ring(addClip, 8);
  await dwell(0.8);
  await mark(5, 'click');
  await act(addClip);
  await clearRing();

  // --- line 6: the clip editor opens --------------------------------------------------------
  const nameInput = page.getByPlaceholder('Enter clip name...');
  await nameInput.waitFor();
  await mark(6);
  const scrubRegion = page.locator('div.h-10.bg-gray-800').first();
  try { await ring(scrubRegion, 12); } catch {}
  await dwell(2.6);
  await clearRing();

  // --- line 7: drag the start/end handles -------------------------------------------------------
  step('trim handles');
  await mark(7, 'Drag');
  try {
    const green = page.locator('[class*="bg-green-500/20"]').first();
    const g = await green.boundingBox({ timeout: 4000 });
    const y = g.y + g.height / 2;
    await drag(g.x + 3, y, g.x - 28, y, 20);
    await dwell(0.6);
    const g2 = await green.boundingBox({ timeout: 4000 });
    await drag(g2.x + g2.width - 3, y, g2.x + g2.width + 22, y, 20);
  } catch { step('handle drag skipped'); }
  await dwell(1.6);

  // --- line 8: describe the clip ------------------------------------------------------------------
  step('name');
  await mark(8, 'Describe');
  await typeInto(nameInput, CLIP_NAME);
  await dwell(0.5);

  // --- line 9: rating, tags, note ---------------------------------------------------------------------
  step('rating/tags/note');
  await mark(9, 'rating');
  try { await act(page.locator('button[title="4 stars"]').first()); } catch {}
  await dwell(0.5);
  for (const tag of ['Pass', 'Dribble']) {
    try { await act(page.getByRole('button', { name: tag, exact: true }).first()); } catch {}
    await dwell(0.4);
  }
  try {
    await typeInto(page.getByPlaceholder('Add a note about this clip...'),
      'Great vision to start the counter');
  } catch { step('note skipped'); }
  await dwell(0.8);

  // --- line 10: My Athlete toggle ------------------------------------------------------------------------
  step('my athlete');
  await mark(10, 'toggle');
  try {
    const toggle = page.locator(
      'xpath=//label[normalize-space()="My Athlete"]/following-sibling::button[1]').first();
    await ring(toggle, 8);
    const b = await toggle.boundingBox({ timeout: 4000 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  } catch { step('toggle ring skipped'); }
  await dwell(3);
  await clearRing();

  // --- line 11: tag a teammate -----------------------------------------------------------------------------
  step('teammate');
  await mark(11, 'tag');
  try {
    await typeInto(page.getByPlaceholder('Tag a teammate...'), 'Alex');
    await page.keyboard.press('Enter');
  } catch { step('teammate skipped'); }
  await dwell(2);

  // --- line 12: Create Reel ----------------------------------------------------------------------------------
  step('create reel');
  // create mode renders a Toggle next to a "Don't Create Reel"/"Create Reel" span
  const reelToggle = page.locator(
    'xpath=//span[contains(normalize-space(),"Create Reel")]/following-sibling::*[1]').first();
  try { await ring(reelToggle, 8); } catch {}
  await dwell(0.8);
  await mark(12, 'Create');
  try { await act(reelToggle); } catch { step('create reel skipped'); }
  await clearRing();
  await dwell(1.6);

  // --- line 13: click Save ------------------------------------------------------------------------------------
  step('save');
  const saveBtn = page.getByRole('button', { name: 'Save', exact: true }).first();
  await ring(saveBtn, 8);
  await dwell(0.8);
  await mark(13, 'Save');
  await act(saveBtn);
  await clearRing();
  await dwell(2.5);

  // --- line 14: saved and rated in your list ---------------------------------------------------------------------
  await mark(14);
  try { await ring(page.getByText(CLIP_NAME).first(), 14); } catch {}
  await dwell(3);
  await clearRing();

  // --- line 15: click Playback Annotations -------------------------------------------------------------------------
  step('playback');
  const playback = page.getByRole('button', { name: /Playback Annotations/ }).first();
  await ring(playback, 8);
  await dwell(0.8);
  await mark(15, 'click');
  await act(playback);
  await clearRing();
  await videosReady(1, 15000);

  // --- line 16: clips play back with titles --------------------------------------------------------------------------
  await mark(16);
  await dwell(6.5);

  // --- line 17: Share Annotations -----------------------------------------------------------------------------------------
  step('share');
  const share = page.getByRole('button', { name: /Share Annotations/ }).first();
  await ring(share, 8);
  await dwell(0.8);
  await mark(17, 'Share');
  await act(share);
  await clearRing();
  await dwell(3.5);

  // --- end ----------------------------------------------------------------------
  await finishCapture(context, page, kit, QUEST_DIR, { width: W, height: H });

  // --- cleanup: delete the demo clip + its reel draft (not recorded) ---------------
  const api = await browser.newContext({ baseURL: BASE });
  try {
    await loginAsRealUser(api, 'imankh@gmail.com');
    const projects = await (await api.request.get('/api/projects')).json();
    for (const p of (Array.isArray(projects) ? projects : []).filter(p => p.name === CLIP_NAME)) {
      await api.request.delete(`/api/projects/${p.id}`);
      console.log(`[cleanup] deleted reel draft ${p.id} (${p.name})`);
    }
    const clips = await (await api.request.get('/api/clips/raw')).json();
    for (const c of (Array.isArray(clips) ? clips : []).filter(c => c.name === CLIP_NAME)) {
      await api.request.delete(`/api/clips/raw/${c.id}`);
      console.log(`[cleanup] deleted raw clip ${c.id} (${c.name})`);
    }
  } catch (e) {
    console.log(`[cleanup] skipped: ${e.message}`);
  } finally {
    await api.close();
  }
});
