import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T17160 - on the Admin Panel at 1440x900, Esc closes the "Manage Campaigns" window and the
 * "View journey" window. A dev-picker account is an admin on a dev stack (T16430); a deployed
 * target logs in as the real admin account, like the other admin checks (T16660, T16070).
 * The dev login is the empty preset: the admin windows need no data of the account's own, and the
 * full preset's first session start (migrations, finishing a stranded export, archiving) once took
 * 53s, so the Admin Panel was not up within the 60s wait.
 */
test.setTimeout(180000);
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T17160:C1 Esc closes Manage Campaigns and View journey', async ({ page }) => {
  if (process.env.E2E_BASE_URL) {
    await loginAsRealUser(page, ADMIN_EMAIL);
  } else {
    await loginForCheck(page, { devPreset: 'empty' });
  }
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });

  // Manage Campaigns
  await page.getByRole('button', { name: 'Manage Campaigns' }).click();
  const campaigns = page.getByRole('heading', { name: 'Manage Campaigns' });
  await expect(campaigns).toBeVisible({ timeout: 60000 });
  await page.keyboard.press('Escape');
  await expect(campaigns).toHaveCount(0, { timeout: 10000 });

  // View journey (Users section is open by default)
  const journeyButton = page.getByTitle('View journey').first();
  await expect(journeyButton).toBeVisible({ timeout: 60000 });
  await journeyButton.click();
  const journey = page.getByText(/Joined .* sessions/);
  await expect(journey).toBeVisible({ timeout: 60000 });
  await page.keyboard.press('Escape');
  await expect(journey).toHaveCount(0, { timeout: 10000 });
});
