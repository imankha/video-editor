import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T7430:C1 - the admin panel's "Retention Chart" section renders the weekly cohort
 * triangle on demand, and the classic/unbounded toggle changes the displayed rate
 * (never silently fails/no-ops). Admin-only panel, so this logs in as the real admin
 * account (dev-preset accounts have no admin flag -- T15690 precedent).
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T7430:C1 Retention Chart triangle renders and the classic/unbounded toggle works', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/retention-chart') && r.request().method() === 'GET', { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.goto('/admin');
      const section = page.getByRole('button', { name: 'Retention Chart' });
      await expect(section).toBeVisible({ timeout: 60000 });
      await section.click();
      const loadButton = page.getByRole('button', { name: /Load retention chart/ });
      await expect(loadButton).toBeVisible();
      await loadButton.click();
    })(),
  ]);
  expect(response, 'the retention-chart endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/retention-chart -> ${response.status()}`).toBeTruthy();

  const hasRows = await page.getByTestId('retention-triangle-row').first().isVisible().catch(() => false);
  if (!hasRows) {
    await expect(page.getByText('No signup cohorts available.')).toBeVisible();
    return;
  }

  const firstRow = page.getByTestId('retention-triangle-row').first();
  const unboundedCellText = await firstRow.locator('td').nth(2).innerText();

  await page.getByLabel('Classic').check();
  await expect.poll(async () => firstRow.locator('td').nth(2).innerText()).not.toBe(unboundedCellText);
});
