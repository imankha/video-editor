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
 * C6: each app load records how long it took to become usable, readable later. A dev
 * account loads the app until the loading screen is gone; then a separate session (the
 * admin account, request only, no app load) reads that account's action log through the
 * admin user-actions API and finds this load's app_load row, with ready_ms no longer than
 * the load the check itself timed. Nothing is stubbed: the app sends its own report.
 *
 * Service workers are blocked so page.route sees the app's requests on staging too.
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';

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

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T16400:C6 each app load records how long it took to become usable, readable later', async ({ page, browser }) => {
  const { user_id: userId } = await loginForCheck(page);
  const loadedAfter = new Date().toISOString();

  const started = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 120000 });
  const loadMs = Date.now() - started;

  // Read it back from a different session, the way someone explaining a slow load would.
  const admin = await browser.newContext();
  await loginAsRealUser(admin, ADMIN_EMAIL);
  let row;
  await expect.poll(async () => {
    const res = await admin.request.get(checkApi(`/admin/analytics/user/${userId}/actions?page_size=50`));
    if (!res.ok()) return `HTTP ${res.status()}`;
    const { actions } = await res.json();
    row = actions.find((a) => a.action === 'app_load' && a.created_at >= loadedAfter);
    return row ? 'found' : 'no app_load row yet';
  }, { timeout: 30000 }).toBe('found');
  await admin.close();

  const { ready_ms: readyMs, first_answer_ms: firstAnswerMs, me_attempts: meAttempts, retries } = row.context;
  expect(readyMs).toBeGreaterThan(0);
  expect(readyMs).toBeLessThanOrEqual(loadMs + 1000); // the page cannot have taken longer than the check waited
  expect(firstAnswerMs).toBeGreaterThan(0);
  expect(firstAnswerMs).toBeLessThanOrEqual(readyMs);
  expect(meAttempts).toBe(1);
  expect(retries).toBe(0);
});
