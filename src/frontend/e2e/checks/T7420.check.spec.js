import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T7420:C1 - the admin panel's "Activation" section renders the per-monthly-cohort
 * export/share <=14d table on demand (scope shrunk 2026-10-30, owner-approved: the
 * per-stage drop-off view lives in the Journey tab's step inspector instead).
 * Admin-only panel, so this logs in as the real admin account (T15690 precedent).
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T7420:C1 Activation section renders the cohort table with export and share columns', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/activation') && r.request().method() === 'GET', { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.goto('/admin');
      const section = page.getByRole('button', { name: 'Activation' });
      await expect(section).toBeVisible({ timeout: 60000 });
      await section.click();
      const loadButton = page.getByRole('button', { name: /Load activation/ });
      await expect(loadButton).toBeVisible();
      await loadButton.click();
    })(),
  ]);
  expect(response, 'the activation endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/activation -> ${response.status()}`).toBeTruthy();

  const hasRows = await page.getByTestId('activation-cohort-row').first().isVisible().catch(() => false);
  if (hasRows) {
    await expect(page.getByRole('columnheader', { name: /Export/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Share/ })).toBeVisible();
  } else {
    await expect(page.getByText('No signup cohorts available.')).toBeVisible();
  }
});
