import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17090: the "You have N free credits" sentence (T17200: the Home first-run coach line, or its plain-text twin with Guidance off) is a
 * brand new account's welcome. A second profile on an existing account has no
 * games yet, but its credits are the account's own, so it must not show there.
 * The profile is added and switched to through the UI (Sport and profile chip,
 * Add profile, Create), in-app with no reload; it is deleted afterwards and the
 * original profile restored.
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
  const before = listed.body.profiles || [];
  const original = before.find((p) => p.isCurrent) || before[0];
  const ownGames = await pageApi(page, '/games');
  expect(ownGames.status, 'GET /games').toBe(200);
  // An existing account: its current profile has games, so the bubble is not up and the
  // clicks below cannot dismiss it (the dismiss listener only runs while it shows).
  expect(ownGames.body.games.length, 'starting profile has games').toBeGreaterThan(0);
  const name = `T17090 ${Date.now().toString(36)}`;
  try {
    await disableGuidanceForCheck(page);
    await expect(page.getByTestId('home-credits-line')).toHaveCount(0);

    // Record every moment the bubble is in the DOM from here on, so a flash during the
    // in-app switch (stores cleared, profile list not yet refetched) is caught too.
    await page.evaluate(() => {
      window.__t17090HintSeen = 0;
      const seen = () => {
        if (/free credits/i.test(document.body.textContent || '')) window.__t17090HintSeen += 1;
      };
      new MutationObserver(seen).observe(document.body, { childList: true, subtree: true });
    });

    // The real gesture: Sport and profile chip -> Add profile -> name -> Create.
    // createProfile switches to the new profile in-app (no reload).
    await page.getByRole('button', { name: /switch sport or profile/i }).first().click();
    await page.getByRole('heading', { name: 'Manage profiles' }).waitFor({ timeout: 10000 });
    await page.getByTestId('manage-profiles-add').click();
    await page.getByPlaceholder(/^e\.g\. /).fill(name);
    await page.getByTestId('profile-form-submit').click();
    await expect(page.getByRole('heading', { name: 'Manage profiles' })).toHaveCount(0, { timeout: 20000 });

    // Now on the new, empty profile: the Games tab counts 0 (the app reads games with the
    // tab's own profile header, so the in-app state is the truth here, not a bare fetch).
    await expect(page.locator('button, [role="tab"]').filter({ hasText: /^Games/ }).getByTestId('tab-badge').first())
      .toHaveText('0', { timeout: 30000 });
    // The observer's counter survives only if the document was never reloaded.
    expect(await page.evaluate(() => typeof window.__t17090HintSeen), 'the switch happens in-app, without a page reload').toBe('number');

    // The credit chip is up (the bubble would render under it once credits load).
    await expect(page.locator('button[title]').filter({ has: page.locator('svg.lucide-coins') }).first())
      .toBeVisible({ timeout: 60000 });
    // Absence check: give the games list time to load (the bubble keys off it) first.
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => window.__t17090HintSeen), 'bubble never appeared during or after the switch').toBe(0);
    await expect(page.getByTestId('home-credits-line')).toHaveCount(0);
    await expect(page.getByText(/free credits/i)).toHaveCount(0);
  } finally {
    const now = await pageApi(page, '/profiles');
    const created = (now.body?.profiles || []).find((p) => p.name === name);
    if (original) await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: original.id }) });
    if (created) await pageApi(page, `/profiles/${created.id}`, { method: 'DELETE' });
    await context.close();
  }
});
