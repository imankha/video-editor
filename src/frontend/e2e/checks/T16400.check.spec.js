/**
 * T16400 - per-criterion acceptance checks (group checks protocol).
 *
 * C3: with the API unreachable, the loading screen shows "Still connecting" and a Retry
 * button within 20 seconds. "Unreachable" is the owner's 2026-11-13 case: the request is
 * sent and nothing ever answers. The check holds every /api/auth/me request at the network
 * (never answered, never failed), so only the app's own time limit can end the wait. The
 * 20 s are counted from the app's first /api/auth/me request (the loading screen is up by
 * then; on prod the page itself loaded in 0.3 s, a cold dev server takes longer).
 *
 * C4: once /api/auth/me answers again, pressing Retry opens the app on the same page: a
 * marker set on `window` before the press is still there after the app opens.
 *
 * Service workers are blocked so page.route sees the app's requests on staging too.
 */
import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

test.use({ serviceWorkers: 'block' });
test.setTimeout(180000);

const STILL_CONNECTING = /Still connecting/;

async function openWithApiUnreachable(page) {
  await loginForCheck(page);
  const held = [];
  await page.route('**/api/auth/me', (route) => { held.push(route); }); // never answered
  const firstAsk = page.waitForRequest((r) => r.url().includes('/api/auth/me'), { timeout: 120000 });
  await page.goto('/', { waitUntil: 'commit' });
  await firstAsk;
  return held;
}

test('T16400:C3 API unreachable: loading screen says Still connecting with Retry within 20 s', async ({ page }) => {
  await openWithApiUnreachable(page);
  const askedAt = Date.now();
  await expect(page.locator('#preloader')).toContainText(STILL_CONNECTING, { timeout: 20000 });
  await expect(page.locator('#preloader').getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(Date.now() - askedAt).toBeLessThan(20000);
});

test('T16400:C4 Retry after the API is back opens the app without a reload', async ({ page }) => {
  await openWithApiUnreachable(page);
  const retry = page.locator('#preloader').getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible({ timeout: 20000 });

  await page.unroute('**/api/auth/me');
  await page.evaluate(() => { window.__t16400SamePage = true; });
  const answered = page.waitForResponse((r) => r.url().includes('/api/auth/me'), { timeout: 60000 });
  await retry.click();
  expect((await answered).status()).toBe(200);

  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  expect(await page.evaluate(() => window.__t16400SamePage === true)).toBe(true);
});
