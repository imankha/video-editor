import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17260:C1: the Manage profiles list and the Add profile window both say a profile
 * is for each athlete, sport and season. Opens the sport-and-profile chip, reads the
 * list, presses Add profile and reads the window (subtitle, name hint, placeholder),
 * then cancels so the account is left unchanged.
 */
test.setTimeout(120000);

const MEANING = 'One profile for each athlete, sport and season.';

test('T17260:C1 the profile list and the Add profile window say a profile is per athlete, sport and season', async ({ page }) => {
  await loginForCheck(page);
  // '/home', not '/': a bare '/' restores the account's resume point (T14980/T16910).
  await page.goto('/home');
  await disableGuidanceForCheck(page);

  // The title, not the name: with no sport picked the chip's name is "Pick your sport for play tags"
  // (SPORT_PICK.CHIP_ARIA), while its title says "Switch sport or profile" in both states.
  await page.getByTitle(/switch sport or profile/i).first().click({ timeout: 60000 });
  const manage = page.getByRole('heading', { name: 'Manage profiles' });
  await expect(manage).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(MEANING, { exact: true })).toBeVisible();

  await page.getByTestId('manage-profiles-add').click();
  await expect(page.getByRole('heading', { name: 'Add profile' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(MEANING, { exact: true })).toBeVisible();
  await expect(page.getByText(`${MEANING} Games and highlights stay separate in each.`, { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(/^e\.g\. Maya, Fall .+ 2026$/)).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(manage).toBeVisible();
});
