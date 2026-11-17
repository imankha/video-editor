import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T16780:C1 - Home asks for no poster.jpg of a game whose upload is not ready.
 *
 * The two targets hold different accounts and either may have no unfinished upload, so the
 * check answers the app's own games list (GET /api/bootstrap, GET /api/games) with the server's list and marks one game
 * upload_failed (the state the honest reap leaves, T7490). It then records every poster.jpg
 * request while Home draws that game's "Upload incomplete" card.
 */
test.setTimeout(180000);

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('T16780:C1 no poster.jpg request for a game whose upload is incomplete', async ({ page }) => {
  await loginForCheck(page);

  // Home reads its games from GET /api/bootstrap (data.games, T16050); a later refetch uses
  // GET /api/games. Both carry the same { games: [...] } list.
  let failedId = null;
  const markFailed = (list) => {
    const games = list?.games || [];
    const game = games.find((g) => g.id === failedId) || games.find((g) => g.status === 'ready');
    if (game) {
      failedId = game.id;
      game.status = 'upload_failed';
    }
  };
  await page.route((url) => /\/api\/(bootstrap|games)$/.test(url.pathname), async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    markFailed(new URL(route.request().url()).pathname.endsWith('/bootstrap') ? body.games : body);
    return route.fulfill({ response: res, json: body });
  });

  const posterRequests = [];
  page.on('request', (req) => {
    const m = new URL(req.url()).pathname.match(/\/api\/games\/(\d+)\/poster\.jpg$/);
    if (m) posterRequests.push(Number(m[1]));
  });

  await page.goto('/');
  await page.getByTestId('home-tab-games').first().click();
  await expect(page.getByTestId('home-failed-game').first()).toBeVisible({ timeout: 60000 });
  expect(failedId, 'the account has a ready game to mark unfinished').not.toBeNull();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  expect(posterRequests.filter((id) => id === failedId), `poster.jpg requests for game ${failedId}`).toEqual([]);
});
