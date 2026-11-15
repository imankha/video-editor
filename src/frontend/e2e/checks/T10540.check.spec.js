import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T10540:C10 - the Games tile picture follows the game's top-rated play without a hard
 * refresh. The browser keeps a tile picture for a day under its address, so the address
 * must carry the game's current top play (poster_version from GET /api/games), and the
 * tile must show the picture served at that address. Leaving Annotate refetches the list
 * (gamesDataStore.finishAnnotation), so the next Home visit renders the new address.
 */
test.setTimeout(180000);

test('T10540:C10 each Games tile shows the picture addressed by its top-rated play', async ({ page }) => {
  await loginForCheck(page);
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `/games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const game = games.find((g) => g.status !== 'pending' && g.clip_count > 0) || games[0];
  expect(game, 'a game on the account').toBeTruthy();
  expect(typeof game.poster_version, 'GET /api/games carries poster_version').toBe('string');

  await page.goto('/');
  await page.getByTestId('home-tab-games').first().click();
  const tile = page.locator(`img[src*="/api/games/${game.id}/poster.jpg"]`).first();
  await expect(tile).toBeAttached({ timeout: 60000 });
  const src = await tile.getAttribute('src');
  expect(new URL(src, page.url()).searchParams.get('v')).toBe(game.poster_version);
});
