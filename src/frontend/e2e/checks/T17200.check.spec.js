import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T17200: Home first run, one clear start. A brand-new account is what these criteria
 * describe, but the check account (dev `full` preset / staging lane B) has games. So every
 * test serves that account's own Home data with the library emptied: the real /api/bootstrap
 * response with no games, plays or finished highlights (the credit balance stays real), and
 * the same for the refetch endpoints. Guidance on/off is set in that served response too, so
 * the shared account's saved setting is never written.
 */
test.setTimeout(240000);

// A bootstrap refetch can still be in flight when a test ends.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

function emptyLibrary(data, coachEnabled) {
  return {
    ...data,
    games: { ...(data.games || {}), games: [] },
    projects: [],
    downloads: { ...(data.downloads || {}), count: 0, unwatched_count: 0 },
    settings: { ...(data.settings || {}), guidance: { ...(data.settings?.guidance || {}), coachEnabled } },
  };
}

/** Log in, serve an empty library, open Home. Returns the account's real credit balance. */
async function openNewAccountHome(page, { coachEnabled, login = true }) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (login) await loginForCheck(page.context());
  let balance = null;
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    balance = data.credits?.balance ?? null;
    await route.fulfill({ response, json: emptyLibrary(data, coachEnabled) });
  });
  await page.route(/\/api\/games(\?.*)?$/, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: { games: [] } }) : route.continue()));
  await page.route(/\/api\/projects(\?.*)?$/, (route) => (route.request().method() === 'GET'
    ? route.fulfill({ json: [] }) : route.continue()));
  await page.goto('/');
  await expect.poll(() => balance, { timeout: 90000, message: 'bootstrap carried a credit balance' }).not.toBeNull();
  await expect(page.getByTestId('home-upload-game')).toBeVisible({ timeout: 60000 });
  return balance;
}

const creditLine = (balance) => new RegExp(`You have ${balance} free credits`);

test('T17200:C1 a new account at 390x844 sees "Start with your game video" and a single primary button', async ({ page }) => {
  await openNewAccountHome(page, { coachEnabled: false });
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Start with your game video');
  const upload = page.getByTestId('home-upload-game');
  await expect(upload).toBeVisible();
  await expect(upload).toHaveText('Upload game');
  await expect(page.getByRole('button', { name: /Skip ahead/ })).toHaveCount(0);
  // Every button in the empty Games block: Upload game is the only filled (primary) one;
  // the other is the small text link.
  const block = upload.locator('xpath=..');
  const labels = await block.getByRole('button').allTextContents();
  expect(labels).toEqual(['Upload game', 'Only have short videos? Upload a play']);
  const linkClass = await block.getByRole('button', { name: 'Only have short videos? Upload a play' }).getAttribute('class');
  expect(linkClass).not.toMatch(/\bbg-/);
});

test('T17200:C2 the free-credits sentence is readable on first arrival with Guidance on and off, and appears once', async ({ page }) => {
  // Guidance on: the Home coach's first sentence carries it.
  let balance = await openNewAccountHome(page, { coachEnabled: true });
  const onLine = page.getByText(creditLine(balance));
  await expect(onLine).toHaveCount(1, { timeout: 60000 });
  await expect(onLine).toBeVisible();
  await expect(onLine).toContainText('Upload your game to start.');
  await expect(page.getByTestId('home-credits-line')).toHaveCount(0);
  await expect(page.getByTestId('credit-first-run-hint')).toHaveCount(0);
  await expect(page.getByTestId('credit-balance')).toBeVisible();

  // Guidance off: the same sentence as plain text in the empty Games state (a fresh tab,
  // same session, so it is a first arrival again).
  const off = await page.context().newPage();
  balance = await openNewAccountHome(off, { coachEnabled: false, login: false });
  const offLine = off.getByText(creditLine(balance));
  await expect(offLine).toHaveCount(1);
  await expect(off.getByTestId('home-credits-line')).toBeVisible();
  await expect(off.getByTestId('home-credits-line')).toHaveText(creditLine(balance));
  await off.unrouteAll({ behavior: 'ignoreErrors' });
});

test('T17200:C3 the upload window mentions zips only in the "Have a zip of plays?" link', async ({ page }) => {
  await openNewAccountHome(page, { coachEnabled: false });
  await page.getByTestId('home-upload-game').click();
  const panel = page.locator('[data-guide-panel]');
  await expect(panel.getByTestId('upload-dropzone')).toBeVisible({ timeout: 30000 });
  const zipTexts = await panel.evaluate((root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent.trim();
      if (/zip/i.test(t)) out.push(t);
    }
    return out;
  });
  expect(zipTexts).toEqual(['Have a zip of plays?']);
});
