import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T17100: on an empty profile, Home's Highlights tab shows a message saying how to
 * make a highlight and a next-step button, not just the "Your highlights" heading.
 * Setup (not the asserted gesture) adds a fresh profile and makes it current; it is
 * deleted afterwards and the original profile restored.
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

for (const [id, viewport] of [['T17100:C1', { width: 1440, height: 900 }], ['T17100:C2', { width: 390, height: 844 }]]) {
  test(`${id} empty Highlights tab shows a message and a next-step button at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
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
        body: JSON.stringify({ name: `T17100 ${Date.now().toString(36)}`, color: '#3b82f6' }),
      });
      expect(made.status, 'POST /profiles').toBe(200);
      created = made.body.id;
      await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: created }) });

      await page.goto('/');
      await page.getByRole('button', { name: /^Highlights/ }).first().click({ timeout: 60000 });
      await expect(page.getByRole('heading', { name: 'Your highlights' })).toBeVisible({ timeout: 60000 });

      const message = page.getByTestId('highlights-empty-message');
      await expect(message).toBeVisible({ timeout: 30000 });
      await expect(message).toContainText(/highlight/i);
      const next = page.getByRole('button', { name: 'Go to Games' });
      await expect(next).toBeVisible();
      await next.click();
      await expect(page.getByRole('heading', { name: 'Review your game' })).toBeVisible({ timeout: 30000 });
    } finally {
      if (original) await pageApi(page, '/profiles/current', { method: 'PUT', body: JSON.stringify({ profileId: original.id }) });
      if (created) await pageApi(page, `/profiles/${created}`, { method: 'DELETE' });
      await context.close();
    }
  });
}
