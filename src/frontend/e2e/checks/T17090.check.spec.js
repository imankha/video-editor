import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T17090: the "You start with N free credits" bubble under the credit chip is a
 * brand new account's welcome. A second profile on an existing account has no
 * games yet, but its credits are the account's own, so it must not show there.
 * Setup adds a fresh profile and makes it current; it is deleted afterwards and
 * the original profile restored.
 */
test.setTimeout(180000);

// In-page fetch: on staging, page.request after the app has started its own session gets 401 (T16100).
async function pageApi(page, apiPath, init = {}) {
  return page.evaluate(async ({ url, init: i }) => {
    const res = await fetch(url, {
      credentials: 'include',
      ...i,
      headers: { 'Content-Type': 'application/json', ...(i.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  }, { url: checkApi(apiPath), init });
}

test('T17090:C1 a new second profile on an existing account shows no free-credits bubble at 1440x900', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const listed = await pageApi(page, '/profiles');
  expect(listed.status, 'GET /profiles').toBe(200);
  const original = (listed.body.profiles || []).find((p) => p.isCurrent) || listed.body.profiles[0];
  let created = null;
  try {
    const made = await pageApi(page, '/profiles', {
      method: 'POST',
      body: JSON.stringify({ name: `T17090 ${Date.now().toString(36)}`, color: '#3b82f6' }),
    });
    expect(made.status, 'POST /profiles').toBe(200);
    created = made.body.id;
    await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: created }) });

    await page.goto('/');
    // No clicks before the assertion: any click dismisses the bubble for the session.
    const games = await pageApi(page, '/games');
    expect(games.status, 'GET /games').toBe(200);
    expect(games.body.games.length, 'new profile has no games').toBe(0);

    // The credit chip is up (the bubble would render under it once credits load).
    await expect(page.locator('button[title]').filter({ has: page.locator('svg.lucide-coins') }).first())
      .toBeVisible({ timeout: 60000 });
    // Absence check: give the games list time to load (the bubble keys off it) first.
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('credit-first-run-hint')).toHaveCount(0);
    await expect(page.getByText(/free credits/i)).toHaveCount(0);
  } finally {
    if (original) await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: original.id }) });
    if (created) await pageApi(page, `/profiles/${created}`, { method: 'DELETE' });
    await context.close();
  }
});
