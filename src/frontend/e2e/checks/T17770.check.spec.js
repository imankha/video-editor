import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { renderGamePage, absolutizePosterUrl } from '../../functions/shared/game/[token].js';

/**
 * T17770 - a public game link must keep playing after the parent uses "Keep only marked
 * plays" then "Restore full video" (C1), and a video that cannot load must read as a
 * message, not an empty player (C2).
 *
 * On a deployed target the viewer opens the real edge page (functions/shared/game/[token].js).
 * The local stack runs no Pages Functions, so locally the check renders the SAME edge HTML
 * from the API's real resolve JSON with the module's own renderGamePage, or opens the SPA
 * fallthrough when the API reports no playable video (what the edge does then).
 */
test.setTimeout(420000);

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};
const UNAVAILABLE = "These game plays aren't available right now.";

async function listGames(page) {
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.games;
}

/** A game the parent can Keep-only/Restore and publicly share; gives it a team play if it has none. */
async function shareableGame(page) {
  const games = await listGames(page);
  const usable = games.filter((g) => !g.is_reference && g.status === 'ready' && g.storage_status === 'active'
    && (g.team_clip_count + g.athlete_clip_count) > 0);
  expect(usable.length, 'a ready, unexpired game with marked plays').toBeGreaterThan(0);
  const game = usable.find((g) => g.team_clip_count > 0) || usable[0];
  if (game.team_clip_count === 0) {
    const clipsRes = await page.request.get(checkApi(`/clips/raw?game_id=${game.id}`));
    expect(clipsRes.ok(), `GET /clips/raw -> ${clipsRes.status()}`).toBeTruthy();
    const clip = (await clipsRes.json())[0];
    const put = await page.request.put(checkApi(`/clips/raw/${clip.id}`), { data: { my_athlete: false } });
    expect(put.ok(), `mark play as team -> ${put.status()}`).toBeTruthy();
  }
  return game;
}

async function createGameLink(page, gameId) {
  const res = await page.request.post(checkApi(`/games/${gameId}/share-link`), { timeout: 240000 });
  expect(res.ok(), `create game link -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()).share_token;
}

/** Open the public game page signed out. */
async function openPublicGamePage(viewer, token, baseURL, apiBase) {
  const pageUrl = `${baseURL}/shared/game/${token}`;
  if (!process.env.E2E_BASE_URL) {
    const apiOrigin = new URL(apiBase).origin;
    const res = await viewer.request.get(`${apiOrigin}/api/shared/game/${token}`);
    expect(res.ok(), `game link JSON -> ${res.status()}`).toBeTruthy();
    const share = await res.json();
    if (share.recap_url) {
      const html = renderGamePage(absolutizePosterUrl(share, apiOrigin), token);
      await viewer.route(pageUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    }
  }
  await viewer.goto(pageUrl);
}

async function expectPlays(viewer) {
  const video = viewer.locator('video').first();
  await expect(video).toBeVisible({ timeout: 60000 });
  await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 60000, message: 'video loads (readyState >= 2)' })
    .toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((v) => v.error && v.error.code), 'no media error').toBeFalsy();
  await expect(viewer.getByText(UNAVAILABLE)).toBeHidden();
}

async function keepOnlyThenRestore(page, gameId, alreadyPlaysOnly) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Games/ }).first().click({ timeout: 60000 });
  const tile = page.locator(`[data-game-id="${gameId}"]`).first();
  await expect(tile).toBeVisible({ timeout: 60000 });
  if (!alreadyPlaysOnly) {
    await tile.hover();
    await tile.locator('[data-game-kebab]').click();
    await page.getByRole('button', { name: 'Keep only marked plays' }).click();
    await page.getByRole('button', { name: 'Keep plays only' }).click();
  }
  await expect(tile.getByText('Plays only')).toBeVisible({ timeout: 60000 });
  // Keep only re-exports in the background when the plays were not preserved yet.
  await expect.poll(async () => (await listGames(page)).find((g) => g.id === gameId)?.preservation_status,
    { timeout: 300000, intervals: [3000] }).toBe('complete');
  await tile.hover();
  await tile.locator('[data-game-kebab]').click();
  await page.getByRole('button', { name: 'Restore full video' }).click();
  const restore = page.getByRole('button', { name: 'Restore video' });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/games/${gameId}/plays-only`) && r.request().method() === 'DELETE' && r.ok(), { timeout: 60000 }),
    restore.click(),
  ]);
}

test.describe('T17770 shared game video', () => {
  test('T17770:C1 public game link plays on phone and desktop after Keep only marked plays and Restore full video', async ({ browser, context, page, baseURL }, testInfo) => {
    await loginForCheck(context);
    const game = await shareableGame(page);
    const token = await createGameLink(page, game.id);
    // A plays-only game (an earlier run stopped before Restore) only needs the Restore step.
    await keepOnlyThenRestore(page, game.id, game.plays_only);

    for (const device of [DESKTOP, PHONE]) {
      const viewerContext = await browser.newContext(device);
      const viewer = await viewerContext.newPage();
      await openPublicGamePage(viewer, token, baseURL, testInfo.project.use.apiBase);
      await expectPlays(viewer);
      await viewerContext.close();
    }
  });

  test('T17770:C2 a game video that cannot load shows a readable message', async ({ browser, context, page, baseURL }, testInfo) => {
    await loginForCheck(context);
    const game = await shareableGame(page);
    const token = await createGameLink(page, game.id);

    const viewerContext = await browser.newContext(PHONE);
    const viewer = await viewerContext.newPage();
    // The media object is gone: storage answers 404 for the recap video.
    await viewer.route(/_team\.mp4/, (route) => route.fulfill({ status: 404, contentType: 'application/xml', body: '<Error><Code>NoSuchKey</Code></Error>' }));
    await openPublicGamePage(viewer, token, baseURL, testInfo.project.use.apiBase);
    await expect(viewer.getByText(UNAVAILABLE)).toBeVisible({ timeout: 60000 });
    await expect(viewer.getByText('Ask the person who shared this link to send it again.')).toBeVisible();
    await expect(viewer.locator('video')).toBeHidden();
    await viewerContext.close();
  });
});
