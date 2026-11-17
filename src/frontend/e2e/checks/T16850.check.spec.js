import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T16850 - one Sport filter at the top of Admin.
 * C1: the Sport control sits in the top filter bar above Pulse, not in Journey's controls, and
 *     picking a sport there re-reads Journey and the Users list with that sport.
 * C4: R2 Usage and By Sport say the Sport filter does not apply to them.
 * A dev-picker account is an admin on a dev stack (T16430); a deployed target's check account
 * is not, so there it logs in as the real admin account (T16660:C3 precedent).
 */
test.setTimeout(240000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

async function openAdmin(page) {
  if (process.env.E2E_BASE_URL) {
    await loginAsRealUser(page, ADMIN_EMAIL);
  } else {
    await loginForCheck(page);
  }
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });
}

test('T16850:C1 the Sport control is at the top above Pulse and filters Journey and Users', async ({ page }) => {
  await openAdmin(page);
  const sport = page.getByTestId('admin-sport-filter').getByRole('group', { name: 'Sport' });
  await expect(sport).toBeVisible({ timeout: 60000 });
  await expect(sport.getByRole('button', { name: 'All sports' })).toHaveAttribute('aria-pressed', 'true');

  // Above Pulse.
  const pulse = page.getByTestId('pulse-card').first();
  await expect(pulse).toBeVisible({ timeout: 60000 });
  const sportBox = await sport.boundingBox();
  const pulseBox = await pulse.boundingBox();
  expect(sportBox.y + sportBox.height).toBeLessThanOrEqual(pulseBox.y);

  // Not inside Journey's controls any more.
  const journeyControls = page.getByTestId('journey-controls');
  await expect(journeyControls).toBeVisible({ timeout: 60000 });
  await expect(journeyControls.getByRole('group', { name: 'Sport' })).toHaveCount(0);

  // Picking a sport re-reads the Journey map and the Users list with it.
  const sportParam = (part) => page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname.endsWith(part) && url.searchParams.get('sport') === 'hockey' && r.ok();
  }, { timeout: 90000 });
  const journey = sportParam('/api/admin/analytics/journey');
  const users = sportParam('/api/admin/users');
  await sport.getByRole('button', { name: 'Hockey' }).click();
  await Promise.all([journey, users]);
  await expect(sport.getByRole('button', { name: 'Hockey' })).toHaveAttribute('aria-pressed', 'true');
});

test('T16850:C4 sections the Sport filter cannot split say so', async ({ page }) => {
  await openAdmin(page);
  for (const title of ['R2 Usage', 'By Sport']) {
    const header = page.getByRole('button', { name: new RegExp(`^${title}`) });
    await expect(header).toBeVisible({ timeout: 60000 });
    await expect(header).toContainText('Sport filter does not apply');
  }
});
