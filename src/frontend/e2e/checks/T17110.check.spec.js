import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T17110: on a touch screen, Home's small controls each have a touch box of at least 44x44:
 * the storage banner's "Extend storage" and Dismiss X, a failed-upload game's Retry and
 * Discard, and (on phones, where it is shown) "Report a problem".
 *
 * The account's real games list is fetched and changed in the response so those controls
 * render on any account: a copy of the first game is added as an upload_failed game and every
 * real game expires in 2 days (which raises the storage banner when a draft uses one).
 * What is measured is the real Home layout.
 */
test.setTimeout(240000);

const MIN = 44;

function withFailedAndExpiring(games) {
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const real = games.map((g) => ({ ...g, storage_status: 'active', storage_expires_at: soon, plays_only: false }));
  if (!real.length) return real;
  const failed = { ...games[0], id: 990000000 + games[0].id, name: 'T17110 failed upload', status: 'upload_failed' };
  return [failed, ...real];
}

async function forceFailedAndExpiring(page) {
  // Home loads games from /api/bootstrap ({games: {games: [...]}}); later refreshes use /api/games.
  await page.route(/\/api\/(bootstrap|games)(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const holder = route.request().url().includes('/bootstrap') ? body.games : body;
    if (holder?.games) holder.games = withFailedAndExpiring(holder.games);
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

async function checkHome(browser, viewport) {
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

test('T17110:C1 Home touch targets are at least 44x44 at 390x844 touch', async ({ browser }) => {
  await checkHome(browser, { width: 390, height: 844 });
});

test('T17110:C2 Home touch targets are at least 44x44 at 360x640 and 768x1024 touch', async ({ browser }) => {
  await checkHome(browser, { width: 360, height: 640 });
  await checkHome(browser, { width: 768, height: 1024 });
});
