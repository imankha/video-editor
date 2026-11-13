import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T16070:C1 (ruling 2026-11-13) - there is no separate "Day N Retention" section;
 * hovering a cohort in the Retention Chart shows that cohort's day 1/3/7/14/28
 * figures (day 0, the signup day itself, is never a checkpoint). Admin-only panel,
 * so this logs in as the real admin account the way the existing T15690 admin
 * check does (a dev-preset account has no admin flag).
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T16070:C1 no Day N section; Retention Chart hover shows the day 1/3/7/14/28 figures', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  await page.goto('/admin');
  const section = page.getByRole('button', { name: 'Retention Chart' });
  await expect(section).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Day N Retention' })).toHaveCount(0);
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load retention chart/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  // Wait from the click, not from page.goto: the admin page's own load can take most of a minute.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/retention-chart') && r.request().method() === 'GET', { timeout: 60000 }).catch(() => null),
    loadButton.click(),
  ]);
  expect(response, 'the retention-chart endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/retention-chart -> ${response.status()}`).toBeTruthy();
  const body = await response.json();
  expect(body.day_n?.checkpoints, 'the chart response carries the day-N checkpoints').toEqual([1, 3, 7, 14, 28]);

  const curves = page.getByTestId('retention-curve');
  if (!(await curves.count())) {
    await expect(page.getByText('No signup cohorts available.')).toBeVisible();
    return;
  }

  // The last-painted point is never covered (week-0 points coincide at 100% across cohorts).
  await page.getByTestId('retention-point').last().hover();
  const hover = page.getByTestId('retention-hover');
  await expect(hover).toBeVisible();
  for (const n of [1, 3, 7, 14, 28]) {
    await expect(hover.getByText(`Day ${n}`, { exact: true })).toBeVisible();
  }
  await expect(hover.getByText('Day 0', { exact: true })).toHaveCount(0);
});
