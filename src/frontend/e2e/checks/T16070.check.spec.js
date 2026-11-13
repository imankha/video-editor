import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T16070:C1 - the admin panel's "Day N Retention" section renders a table with
 * Day 1/3/7/14/28 columns and a pooled "All weeks" row (day 0, the signup day
 * itself, is never one of the columns). Admin-only panel, so this logs in as the
 * real admin account the way the existing T15690 admin check does (a dev-preset
 * account has no admin flag).
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T16070:C1 Day N Retention table renders with the five checkpoint columns + All weeks', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/retention') && r.request().method() === 'GET', { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.goto('/admin');
      const section = page.getByRole('button', { name: 'Day N Retention' });
      await expect(section).toBeVisible({ timeout: 60000 });
      await section.click();
      const loadButton = page.getByRole('button', { name: /Load retention/ });
      await expect(loadButton).toBeVisible();
      await loadButton.click();
    })(),
  ]);
  expect(response, 'the retention endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/retention -> ${response.status()}`).toBeTruthy();

  // Day 0 is the signup day itself and must never appear as a checkpoint column,
  // whether the dev DB has signup cohorts to show or only the honest empty state.
  await expect(page.getByRole('columnheader', { name: 'Day 0' })).toHaveCount(0);

  const hasRows = await page.getByRole('columnheader', { name: 'Day 1' }).isVisible().catch(() => false);
  if (hasRows) {
    for (const n of [1, 3, 7, 14, 28]) {
      await expect(page.getByRole('columnheader', { name: `Day ${n}` })).toBeVisible();
    }
    await expect(page.getByText('All weeks')).toBeVisible();
  } else {
    await expect(page.getByText('No signup cohorts available.')).toBeVisible();
  }
});
