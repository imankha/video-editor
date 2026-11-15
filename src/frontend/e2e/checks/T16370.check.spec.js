import { test, expect, devices } from '@playwright/test';
import { checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16370: staging is served from reelballers.com (app at staging.reelballers.com, API at
 * api-staging.reelballers.com), so the session cookie is first-party and Safari keeps it.
 *
 * Runs in WebKit (Safari's engine) with iPhone 14 emulation. Sign-in is a fetch from INSIDE
 * the page, not page.request, so the browser's own cookie rules decide whether the cookie is
 * stored (page.request writes the jar directly and would hide the Safari bug).
 *
 *   cd src/frontend && npx playwright install webkit   # once; needs WebKit's system libraries
 *   E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api \
 *     npx playwright test e2e/checks/T16370.check.spec.js --reporter=line
 *
 * C1 - sign in, still signed in after a reload and in a new browser context built from the
 *      saved cookies (closing and reopening the browser).
 * C2 - the same WebKit browser plays a game's video in Annotate.
 */
// Drop the descriptor's defaultBrowserType: test.use() does not accept it.
const { defaultBrowserType: _defaultBrowserType, ...iPhone14 } = devices['iPhone 14'];
test.use({ ...iPhone14, browserName: 'webkit' });
test.setTimeout(240000);

const EMAIL = process.env.E2E_CHECK_EMAIL || 'e2e-gate@test.local';

async function signInFromPage(page) {
  await page.goto('/');
  const status = await page.evaluate(async ({ url, email }) => {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
      body: JSON.stringify({ email }),
    });
    return res.status;
  }, { url: checkApi('/auth/dev-login'), email: EMAIL });
  expect(status, 'dev-login from inside the page').toBe(200);
}

async function meStatus(page) {
  return page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).status,
    checkApi('/auth/me'));
}

test('T16370:C1 WebKit iPhone 14 stays signed in on staging after a reload and a new context', async ({ browser, page }) => {
  await signInFromPage(page);
  expect(await meStatus(page), '/auth/me right after sign-in').toBe(200);

  await page.reload();
  expect(await meStatus(page), '/auth/me after a reload').toBe(200);

  const saved = await page.context().storageState();
  expect(saved.cookies.map((c) => c.name), 'session cookie stored by the browser').toContain('rb_session');

  const reopened = await browser.newContext({ ...iPhone14, storageState: saved });
  const reopenedPage = await reopened.newPage();
  await reopenedPage.goto('/');
  expect(await meStatus(reopenedPage), '/auth/me in a new context with the saved cookies').toBe(200);
  await reopened.close();
});

test('T16370:C2 WebKit iPhone 14 plays a game video in Annotate on staging', async ({ page }) => {
  await signInFromPage(page);
  const games = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return res.ok ? (await res.json()).games || [] : null;
  }, checkApi('/games'));
  expect(games, 'GET /games from inside the page').not.toBeNull();
  const target = games.find((g) => g.storage_status === 'active');
  expect(target, 'an active game on the check account').toBeTruthy();

  await page.evaluate((id) => sessionStorage.setItem('pendingGameId', String(id)), target.id);
  await page.goto('/annotate');
  await disableGuidanceForCheck(page);

  const video = page.locator('video').first();
  await expect(video).toBeVisible({ timeout: 90000 });
  await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
  const start = await video.evaluate((v) => v.currentTime);

  await page.getByTitle('Play', { exact: true }).locator('visible=true').first().click();
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 60000 }).toBeGreaterThan(start + 1);
});
