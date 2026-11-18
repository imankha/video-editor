import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T17080: on a game whose plays are all "My athlete" (no team plays), the Share window's
 * "Copy link" must never be silent: it copies a working link or shows a visible message.
 */
test.setTimeout(180000);

async function athleteOnlyGame(page) {
  const resp = await page.request.get(checkApi('/games'));
  expect(resp.ok(), `GET /games -> ${resp.status()}`).toBeTruthy();
  const body = await resp.json();
  const games = Array.isArray(body) ? body : body.games;
  const game = games.find((g) => !g.is_reference && g.team_clip_count === 0 && g.athlete_clip_count > 0);
  expect(game, 'a game with only "My athlete" plays').toBeTruthy();
  return game;
}

async function pressCopyLink(page) {
  const game = await athleteOnlyGame(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^Games/ }).first().click({ timeout: 60000 });
  const tile = page.locator(`[data-game-id="${game.id}"]`).first();
  await expect(tile).toBeVisible({ timeout: 60000 });
  await tile.hover();
  await tile.locator('[data-game-kebab]').click();
  await page.locator('[data-game-menu]').getByText('Share game', { exact: true }).click();
  const copy = page.getByRole('button', { name: /Copy link/ });
  await expect(copy).toBeVisible({ timeout: 30000 });
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/games/${game.id}/share-link`) && r.request().method() === 'POST', { timeout: 120000 }),
    copy.click(),
  ]);
  return resp;
}

async function expectNotSilent(page, resp) {
  if (resp.ok()) {
    await expect(page.getByRole('alert').filter({ hasText: /copied|Copy it here/i })).toBeVisible({ timeout: 10000 });
    return;
  }
  // Refused: the parent sees a message in the Share window saying what to do.
  await expect(page.getByTestId('share-link-blocked')).toBeVisible({ timeout: 10000 });
}

for (const [id, viewport] of [['T17080:C1', { width: 1440, height: 900 }], ['T17080:C2', { width: 390, height: 844 }]]) {
  test(`${id} Copy link on an all-"My athlete" game is never silent at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    await loginForCheck(context);
    const page = await context.newPage();
    const resp = await pressCopyLink(page);
    await expectNotSilent(page, resp);
    await context.close();
  });
}
