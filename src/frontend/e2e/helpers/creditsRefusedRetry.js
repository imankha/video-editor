import { expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginForCheck, checkApi, disableGuidanceForCheck } from './checkAuth';
import { openGameDetailsDisclosure } from './gameDetails.js';

/**
 * The T17380:C2 flow, shared with T17620:C1 (T17620 runs it from a large starting balance):
 * an upload that failed for lack of credits completes when the user buys
 * credits and taps Retry on Home.
 *
 * Everything runs against the real backend. Setup (not the asserted gesture): a fresh
 * account uploads one game, then spends its balance down to 1 credit with real
 * storage-extension charges, so the server's own credit check refuses the next upload
 * (cost 2). The user gesture: upload a second game, see it fail on Home, get credits
 * (the test-only grant stands in for the Stripe purchase, which grants the same ledger),
 * tap Retry. The game must turn ready and Home must list it exactly once.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_VIDEO = path.resolve(__dirname, '../../../../formal annotations/test.short/game2-test.mp4');

// In-page fetch: on staging, page.request after the app has started its own session gets 401 (T16100).
async function pageApi(page, apiPath, init = {}) {
  return page.evaluate(async ({ url, init: i }) => {
    const res = await fetch(url, {
      credentials: 'include',
      ...i,
      headers: { 'Content-Type': 'application/json', ...(i.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  }, { url: checkApi(apiPath), init });
}

async function balance(page) {
  const r = await pageApi(page, '/credits');
  expect(r.status, 'GET /credits').toBe(200);
  return r.body.balance;
}

async function games(page) {
  const r = await pageApi(page, '/games');
  expect(r.status, 'GET /games').toBe(200);
  return r.body.games || [];
}

function uniqueVideo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't17380-'));
  const file = path.join(dir, `t17380-${tag}.mp4`);
  fs.copyFileSync(SOURCE_VIDEO, file);
  // Random tail bytes: a new content hash, so the upload is a new game, not a dedupe.
  fs.appendFileSync(file, Buffer.from(Array.from({ length: 64 * 1024 }, () => Math.floor(Math.random() * 256))));
  return file;
}

// No reloads after the first load: a reload re-opens the last game from the resume
// point a moment later, which closed the upload dialog under the check.
async function openHomeGames(page) {
  // An upload opens Annotate: go Home from the header, then to the Games tab (its name carries a count; the breadcrumb's does not).
  // Guidance can come back on once the fresh account's settings load; its shade
  // swallows clicks, so turn it off again each pass (the helper is idempotent).
  await expect(async () => {
    await disableGuidanceForCheck(page);
    const editorHome = page.getByTestId('editor-home');
    if (await editorHome.isVisible()) await editorHome.click();
    const gamesTab = page.getByRole('button', { name: /^Games\s*\d+/ }).first();
    if (await gamesTab.isVisible()) await gamesTab.click();
    await expect(page.getByRole('button', { name: 'Upload game' }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60000 });
}

async function pickAndSubmit(page, video, opponent) {
  await openHomeGames(page);
  await page.getByRole('button', { name: 'Upload game' }).first().click();
  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill(opponent);
  await page.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('form input[type="file"][accept*="video"]').setInputFiles(video);
  const submit = page.locator('form button:has-text("Upload game")');
  await expect(submit).toBeEnabled({ timeout: 30000 });
  await submit.click();
}

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {import('@playwright/test').Page} page
 * @param {{ minStartBalance?: number }} [options] - grant up to this balance before the spend-down
 */
export async function retryCreditsRefusedUpload(context, page, { minStartBalance = 0 } = {}) {
  await loginForCheck(context, { devPreset: 'empty' });
  // '/home', not '/': a bare '/' restores the account's resume point (T14980), and another check
  // on the shared staging account can leave it in Annotate or Framing (T17420, T17620).
  await page.goto('/home');
  await page.waitForLoadState('domcontentloaded');
  // A cold stack draws the Guidance switch late; the helper only looks for 5s.
  await page.getByTestId('guidance-toggle').first().waitFor({ state: 'visible', timeout: 60000 });
  await disableGuidanceForCheck(page);

  // Setup: one paid game to spend storage-extension credits on.
  const activated = page.waitForResponse(
    (r) => /\/api\/games\/\d+\/activate/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 240000 },
  );
  await pickAndSubmit(page, uniqueVideo('setup'), 'T17380 setup');
  expect((await activated).status(), 'setup upload activated').toBe(200);
  const setupGame = (await games(page)).find((g) => g.status === 'ready');
  expect(setupGame, 'setup game is ready').toBeTruthy();

  // T17620: the shared staging account holds a balance this flow must spend down first.
  if (minStartBalance > 0) {
    const short = minStartBalance - (await balance(page));
    if (short > 0) {
      const g = await pageApi(page, '/credits/grant', {
        method: 'POST', body: JSON.stringify({ amount: short, source: 't17620_check' }),
      });
      expect(g.status, 'POST /credits/grant (start balance)').toBe(200);
    }
  }

  // Setup: spend down to 1 credit (a sub-GB game costs ceil(days/30) to extend).
  // The call budget comes from the starting balance: the shared staging account held
  // over 2400 credits, which a fixed 200-call cap (12 credits a call) never reached (T17620).
  const maxCalls = Math.ceil((await balance(page)) / 12) + 12;
  for (let i = 0; i < maxCalls; i += 1) {
    const left = await balance(page);
    if (left <= 1) break;
    const days = Math.min(360, 30 * (left - 1));
    const r = await pageApi(page, `/games/${setupGame.id}/extend-storage`, {
      method: 'POST', body: JSON.stringify({ days }),
    });
    expect(r.status, `extend-storage ${days}d`).toBe(200);
  }
  expect(await balance(page), 'balance is below the 2-credit upload cost').toBe(1);
  const gamesBefore = (await games(page)).length;

  // The gesture: upload a game the server refuses for credits.
  const refused = page.waitForResponse(
    (r) => /\/api\/games\/prepare-upload/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await pickAndSubmit(page, uniqueVideo('refused'), 'T17380 refused');
  const prep = await (await refused).json();
  expect(prep.can_afford, 'the server refused the upload for credits').toBe(false);

  // The user is annotating the kept pending game (T8180), so Annotate shows the
  // failure first. Then Home: its credits dialog is up over the failed tile.
  await expect(page.getByRole('button', { name: 'Retry upload' })).toBeVisible({ timeout: 60000 });
  await page.getByTestId('editor-home').click();
  const creditsTitle = page.getByText('Not enough credits', { exact: true });
  await expect(creditsTitle).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(creditsTitle).toHaveCount(0);
  const retry = page.getByRole('button', { name: /^Retry upload of / });
  await expect(retry, 'Home shows the failed upload with Retry').toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('uploading-game-tile').first()).toContainText(/credits/i);

  // Get credits, then Retry.
  const granted = await pageApi(page, '/credits/grant', {
    method: 'POST', body: JSON.stringify({ amount: 20, source: 't17380_check' }),
  });
  expect(granted.status, 'POST /credits/grant').toBe(200);

  const retried = page.waitForResponse(
    (r) => /\/api\/games\/\d+\/activate/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 240000 },
  );
  await retry.click();
  expect((await retried).status(), 'the retried upload activated').toBe(200);

  await expect.poll(async () => {
    const all = await games(page);
    return {
      total: all.length,
      refused: all.filter((g) => /T17380 refused/.test(`${g.name} ${g.opponent_name}`)).map((g) => g.status),
    };
  }, { message: 'exactly one new game, ready', timeout: 60000 }).toEqual({ total: gamesBefore + 1, refused: ['ready'] });
  await expect(page.getByRole('button', { name: /^Retry upload of / })).toHaveCount(0);
}
