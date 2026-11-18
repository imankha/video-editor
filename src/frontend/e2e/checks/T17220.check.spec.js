import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17220: one Share game window. "Share game" from Mark Plays and from the Home game
 * menu open the same window, and a typed email shares on Send without Enter.
 *
 * The share POST is answered by the test (route.fulfill) so a check run never emails
 * anyone; the assertion is on what the app sends.
 */
test.setTimeout(240000);
test.use({ viewport: { width: 1280, height: 900 } });
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

/** An active game that has marked plays (Mark Plays' Share game needs one), read from the API. */
async function pickGame(page) {
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const game = games.find((g) => g.storage_status === 'active' && g.clip_count > 0 && g.name);
  test.skip(!game, '[T17220] no active game with plays on this account');
  return game;
}

/** The open share window: the overlay that holds the Send button. */
const shareWindow = (page) => page.locator('div.fixed.inset-0').filter({ has: page.getByTestId('share-game-submit') });

/** What the user sees in the window: heading and every control label. */
async function signature(dialog) {
  await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible({ timeout: 30000 });
  const heading = await dialog.getByRole('heading', { level: 2 }).textContent();
  const buttons = await dialog.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));
  return { heading, buttons, linkRow: await dialog.getByText('Anyone with the link').count() };
}

async function openFromHome(page, game) {
  // Home's Games tab (its address; plain '/' resumes the last open game).
  await page.goto('/home/games');
  const tile = page.locator('div.group[role="button"]', { hasText: game.name }).first();
  await expect(tile).toBeVisible({ timeout: 90000 });
  await tile.hover();
  await tile.locator('[data-game-kebab]').click();
  await page.locator('[data-game-menu]').getByRole('button', { name: 'Share game' }).click();
  const dialog = shareWindow(page);
  await expect(dialog).toBeVisible({ timeout: 30000 });
  return dialog;
}

test('T17220:C1 Share game from Mark Plays and from Home open the same window', async ({ context, page }) => {
  await loginForCheck(context);
  const game = await pickGame(page);

  // Mark Plays shows its Share game card while no play is selected: open the game at a
  // time between plays (the editor's deep link), read from the game's own plays.
  const detail = await page.request.get(checkApi(`/games/${game.id}`));
  expect(detail.ok(), `GET /games/${game.id} -> ${detail.status()}`).toBeTruthy();
  const plays = ((await detail.json()).annotations || []).slice().sort((x, y) => x.start_time - y.start_time);
  let t = plays.length ? plays[plays.length - 1].end_time + 10 : 10;
  let widest = 0;
  for (let i = 1; i < plays.length; i++) {
    const gap = plays[i].start_time - plays[i - 1].end_time;
    if (gap > widest && gap > 6) { widest = gap; t = Math.round(plays[i - 1].end_time + gap / 2); }
  }
  await page.goto(`/annotate/g/${game.id}?t=${t}`);
  await disableGuidanceForCheck(page);
  const markPlaysShare = page.getByTestId('annotate-share-plays-action');
  await expect(markPlaysShare).toBeVisible({ timeout: 90000 });
  await expect(markPlaysShare).not.toHaveAttribute('aria-disabled', 'true', { timeout: 90000 });
  await markPlaysShare.click();
  const fromMarkPlays = shareWindow(page);
  await expect(fromMarkPlays).toBeVisible({ timeout: 30000 });
  const a = await signature(fromMarkPlays);
  await fromMarkPlays.getByRole('button', { name: 'Cancel' }).click();
  await expect(fromMarkPlays).toHaveCount(0);

  const fromHome = await openFromHome(page, game);
  const b = await signature(fromHome);

  expect(a.linkRow, 'Mark Plays window has the "Anyone with the link" row').toBe(1);
  expect(a).toEqual(b);
});

test('T17220:C2 typing one email and tapping Send shares it without Enter; no "Share with 0"', async ({ context, page }) => {
  await loginForCheck(context);
  const game = await pickGame(page);
  const posted = [];
  await page.route(/\/api\/games\/\d+\/share$/, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { all_sent: true, results: [{ email: 'coach@example.com', sent: true }] } });
  });

  const dialog = await openFromHome(page, game);
  const send = dialog.getByTestId('share-game-submit');
  await expect(send).toHaveAccessibleName('Send');
  await expect(send).toBeDisabled();
  await expect(page.getByText(/Share with \d/)).toHaveCount(0);

  await dialog.getByPlaceholder(/emails/i).fill('coach@example.com');
  await expect(send).toBeEnabled();
  await send.click();

  await expect.poll(() => posted.length, { timeout: 30000 }).toBe(1);
  expect(posted[0].recipients.map((r) => r.email)).toEqual(['coach@example.com']);
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
});
