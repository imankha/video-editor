import { expect } from '@playwright/test';
import { loginForCheck } from './checkAuth';

/**
 * The T17110 flow, shared by its own check and T17300:C1's. On a touch screen, Home's small
 * controls each have a touch box of at least 44x44:
 * the storage banner's "Extend storage" and Dismiss X, a failed-upload game's Retry and
 * Discard, and (on phones, where it is shown) "Report a problem".
 *
 * The account's real games list is fetched and changed in the response so those controls
 * render on any account: a copy of the first game is added as an upload_failed game and every
 * real game expires in 2 days. The banner only counts a game a draft depends on, and Home
 * drops 'pending' games, so every draft is also made to use the first non-pending game
 * (T17300: on staging the account's only drafts used a pending game and no banner showed).
 * What is measured is the real Home layout.
 */
const MIN = 44;

function withFailedAndExpiring(games) {
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const real = games.map((g) => ({ ...g, storage_status: 'active', storage_expires_at: soon, plays_only: false }));
  if (!real.length) return real;
  const failed = { ...games[0], id: 990000000 + games[0].id, name: 'T17110 failed upload', status: 'upload_failed' };
  return [failed, ...real];
}

function withDraftsOn(projects, gameId) {
  return projects.map((p) => ({ ...p, game_ids: [...new Set([...(p.game_ids || []), gameId])] }));
}

async function forceFailedAndExpiring(page) {
  // Home loads games and drafts from /api/bootstrap ({games: {games: [...]}, projects: [...]});
  // later refreshes use /api/games ({games: [...]}) and /api/projects ([...]).
  let draftGameId = null;
  await page.route(/\/api\/(bootstrap|games|projects)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const url = route.request().url();
    const holder = url.includes('/bootstrap') ? body.games : (url.includes('/games') ? body : null);
    if (holder?.games) {
      const ready = holder.games.find((g) => g.status !== 'pending');
      if (ready) draftGameId = ready.id;
      holder.games = withFailedAndExpiring(holder.games);
    }
    if (draftGameId !== null) {
      if (url.includes('/bootstrap') && Array.isArray(body.projects)) body.projects = withDraftsOn(body.projects, draftGameId);
      if (url.includes('/projects') && Array.isArray(body)) return route.fulfill({ response, json: withDraftsOn(body, draftGameId) });
    }
    await route.fulfill({ response, json: body });
  });
}

async function expectTouchBox(locator, what) {
  await expect(locator, what).toBeVisible({ timeout: 60000 });
  const box = await locator.boundingBox();
  expect(box, `${what} has a box`).not.toBeNull();
  expect.soft(box.width, `${what} width`).toBeGreaterThanOrEqual(MIN);
  expect.soft(box.height, `${what} height`).toBeGreaterThanOrEqual(MIN);
}

export async function checkHomeTouchTargets(browser, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  await loginForCheck(context);
  const page = await context.newPage();
  try {
    await forceFailedAndExpiring(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^Games/ }).first().click({ timeout: 60000 });

    const banner = page.getByTestId('storage-expiry-banner');
    await expectTouchBox(banner.getByRole('button', { name: 'Extend storage' }), 'Extend storage');
    await expectTouchBox(banner.getByRole('button', { name: 'Dismiss' }), 'banner Dismiss');

    await expectTouchBox(page.getByRole('button', { name: /^Retry upload of / }).first(), 'Retry upload');
    await expectTouchBox(page.getByRole('button', { name: /^Discard / }).first(), 'Discard');

    // "Report a problem" sits under Home on phones only (sm:hidden; desktop has the corner button).
    if (viewport.width < 640) {
      const report = page.getByRole('button', { name: 'Report a problem' });
      await report.scrollIntoViewIfNeeded({ timeout: 60000 });
      await expectTouchBox(report, 'Report a problem');
    }
  } finally {
    await context.close();
  }
}
