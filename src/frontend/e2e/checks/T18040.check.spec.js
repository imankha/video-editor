import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T18040:C3 - "Use my videos to help test and improve ReelBallers" under "Your privacy
 * rights" in Account settings turns the internal-testing use off and on; each change is
 * one write, and the value survives a reload. The check leaves the switch where it found it.
 */
test.setTimeout(240000);

const LABEL = 'Use my videos to help test and improve ReelBallers';

async function openSettings(page, email) {
  await page.getByTitle(email, { exact: true }).first().click({ timeout: 60000 });
  await page.getByRole('button', { name: 'Account settings' }).click();
  await expect(page.getByText('Your privacy rights')).toBeVisible({ timeout: 30000 });
  const toggle = page.getByRole('switch', { name: LABEL });
  await expect(toggle).toBeEnabled({ timeout: 30000 });
  return toggle;
}

test('T18040:C3 the testing switch turns off and on, one write each, and survives a reload', async ({ page }) => {
  await loginForCheck(page, { devPreset: 'empty' });
  const me = await page.request.get(checkApi('/auth/me'));
  expect(me.ok()).toBe(true);
  const { email, use_for_testing: startedOn } = await me.json();
  await page.request.delete(checkApi('/me/resume-point'));

  const writes = [];
  page.on('request', (r) => {
    if (r.url().includes('/auth/testing-consent')) writes.push([r.method(), r.postDataJSON()]);
  });

  await page.goto('/');
  // Guidance's shade would swallow the clicks on the account menu (checkAuth.js).
  await expect(page.getByTestId('guidance-toggle').first()).toBeVisible({ timeout: 60000 });
  await disableGuidanceForCheck(page);
  let toggle = await openSettings(page, email);
  const before = startedOn ? 'true' : 'false';
  const flipped = startedOn ? 'false' : 'true';
  await expect(toggle).toHaveAttribute('aria-checked', before);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', flipped, { timeout: 30000 });
  expect(writes).toEqual([['PUT', { use_for_testing: !startedOn }]]);

  await page.reload();
  toggle = await openSettings(page, email);
  await expect(toggle).toHaveAttribute('aria-checked', flipped);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', before, { timeout: 30000 });
  expect(writes).toEqual([
    ['PUT', { use_for_testing: !startedOn }],
    ['PUT', { use_for_testing: startedOn }],
  ]);

  await page.reload();
  toggle = await openSettings(page, email);
  await expect(toggle).toHaveAttribute('aria-checked', before);
});
