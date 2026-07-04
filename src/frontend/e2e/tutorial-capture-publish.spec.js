/**
 * Tutorial capture: PUBLISH quest. SOURCE OF TRUTH — copy into
 * video-editor/src/frontend/e2e/ before running. Marks map to line numbers in
 * ReelBallersTutroials/publish/talk_track.txt. See helpers/tutorialCapture.js.
 *
 * Run (after copying):
 *   cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
 *     npx playwright test e2e/tutorial-capture-publish.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { OVERLAY_INIT, makeKit, finishCapture } from './helpers/tutorialCapture';

const QUEST_DIR = 'C:/Users/imank/Videos/Captures/ReelBallersTutroials/publish';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const W = 1920, H = 1080;

test('capture publish tutorial footage', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: QUEST_DIR, size: { width: W, height: H } },
  });
  await context.addInitScript(OVERLAY_INIT);
  await loginAsRealUser(context, 'imankh@gmail.com');
  // Stage in-session: un-publish reel 34 -> Done+unpublished draft (project 53).
  // A fresh session re-syncs the profile DB from R2, reverting out-of-session restores.
  const staged = await context.request.post('/api/downloads/34/restore-project');
  if (!staged.ok() && staged.status() !== 404) {
    throw new Error(`restore-project failed: ${staged.status()} ${await staged.text()}`);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const kit = makeKit(page);
  const { mark, ring, clearRing, act, dwell, step, videosReady } = kit;

  // --- line 0: intro over the drafts list --------------------------------------
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  await page.mouse.move(960, 400);
  await mark(0);
  await dwell(4);

  // --- line 1: the draft is marked Done -----------------------------------------
  const moveBtn = page.getByRole('button', { name: 'Move to My Reels' });
  await moveBtn.waitFor({ timeout: 20000 });
  const card = page.locator('[data-testid="project-card"]').filter({ has: moveBtn }).first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await mark(1);
  await ring(card.getByText('Done', { exact: true }).first(), 8);
  await dwell(4.5);
  await clearRing();

  // --- line 2: preview it ---------------------------------------------------------
  const previewBtn = card.getByRole('button', { name: 'Preview video' });
  await ring(previewBtn, 8);
  await dwell(0.8);
  await mark(2, 'preview');
  await act(previewBtn);
  await clearRing();
  await videosReady(1, 10000);
  await dwell(7);
  await page.keyboard.press('Escape');
  await dwell(1.5);

  // --- line 3: click Move to My Reels ----------------------------------------------
  await ring(moveBtn, 8);
  await dwell(1);
  await mark(3, 'Move');
  await act(moveBtn);
  await clearRing();
  await dwell(3.5);

  // --- line 4: in My Reels under the game name ---------------------------------------
  await mark(4);
  step('My Reels drawer (auto-opens on publish)');
  const drawerHeading = page.getByRole('heading', { name: 'My Reels', exact: true }).first();
  try {
    await drawerHeading.waitFor({ timeout: 5000 });
  } catch {
    await page.getByRole('button', { name: /^My Reels/ }).first().click();
    await drawerHeading.waitFor();
  }
  await dwell(2);
  step('scroll drawer to reel rows');
  await page.mouse.move(1700, 540);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 900); await dwell(0.3); }
  await dwell(0.5);
  const reelPlay = page.getByRole('button', { name: 'Play video' }).locator('visible=true').last();
  await reelPlay.waitFor();
  await reelPlay.hover();
  const reelTitle = page.getByText('Brilliant Pass', { exact: true }).locator('visible=true').last();
  try { await ring(reelTitle, 14); } catch { await ring(reelPlay, 12); }
  await dwell(2);
  await clearRing();

  // --- line 5: play / download / share ------------------------------------------------
  step('open More actions menu');
  const moreBtn = page.getByRole('button', { name: 'More actions' }).locator('visible=true').last();
  await mark(5, 'play');
  await act(moreBtn);
  await dwell(1.2);
  try {
    await ring(page.getByText('Download', { exact: true }).locator('visible=true').last(), 6);
    await dwell(1.2);
    await ring(page.getByText('Share', { exact: true }).locator('visible=true').last(), 6);
    await dwell(1.2);
  } catch {}
  await clearRing();
  await page.keyboard.press('Escape');
  await dwell(1.5);
  await dwell(2);                            // line 6 (mobile) continues this shot

  // --- line 7: collections --------------------------------------------------------------
  step('scroll back to collections');
  await mark(7, 'collections');
  await page.mouse.move(1700, 540);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -900); await dwell(0.25); }
  await dwell(0.5);
  try { await ring(page.getByText('Top Plays').first(), 10); } catch {}
  await dwell(3);
  await clearRing();

  // --- line 8: click the first entry (Ranking banner) --------------------------------------
  step('click Rank reels');
  const rankCta = page.getByText('Rank reels').first();
  await rankCta.waitFor();
  await ring(rankCta, 10);
  await dwell(1.2);
  await mark(8, 'clicking');
  await act(rankCta);
  await clearRing();
  await videosReady(2, 15000);
  await dwell(3);

  // --- line 9: two reels side by side --------------------------------------------------------
  await mark(9);
  await dwell(5);

  // --- line 10: each choice sorts --------------------------------------------------------------
  await mark(10, 'choice');
  try {
    await act(page.getByText('Pick this one').locator('visible=true').first());
    await dwell(3);
    await act(page.getByText('Pick this one').locator('visible=true').last());
  } catch {
    await page.keyboard.press('ArrowLeft');
    await dwell(3);
    await page.keyboard.press('ArrowRight');
  }
  await dwell(2.5);

  await finishCapture(context, page, kit, QUEST_DIR, { width: W, height: H });
});
