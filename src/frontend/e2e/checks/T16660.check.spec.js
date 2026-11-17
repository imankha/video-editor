import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

/**
 * T16660 - a signed-in account that is not an admin and opens /admin sees a short not-available
 * screen, never the Admin Panel (filters, roadmap line, build id), and the page makes none of the
 * admin data requests the server would refuse.
 *
 * A dev-picker account is an admin on a dev stack (T16430), so the check answers the app's own
 * "am I an admin" question (GET /api/admin/me) with is_admin:false: the account is then a normal
 * account to the app on every target. On staging the gate account is not an admin anyway.
 */
test.setTimeout(180000);

test('T16660:C1 T16660:C2 a normal account on /admin sees no admin screen and makes no admin data request', async ({ page }) => {
  await loginForCheck(page);
  await page.route('**/api/admin/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ is_admin: false, environment: null }),
  }));

  const adminDataRequests = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (pathname.includes('/api/admin/') && !pathname.endsWith('/api/admin/me')) {
      adminDataRequests.push(pathname);
    }
  });

  await page.goto('/admin');
  await expect(page.getByTestId('admin-not-available')).toBeVisible({ timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // C1: none of the Admin Panel is drawn.
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toHaveCount(0);
  await expect(page.getByText(/\d+ steps, \d+ tasks/)).toHaveCount(0);
  await expect(page.getByText('Loading journey...')).toHaveCount(0);

  // C2: no admin data request went out (GET /api/admin/me is how the app learns it is not an admin).
  expect(adminDataRequests).toEqual([]);

  // The way out goes Home.
  await page.getByTestId('admin-not-available').getByRole('button', { name: /home/i }).click();
  await expect(page.getByTestId('admin-not-available')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).not.toBe('/admin');
});

test('T16660:C3 an admin account on /admin still sees the Admin Panel', async ({ page }) => {
  // No stub: a dev-picker account is an admin on a dev stack (T16430), so the real
  // GET /api/admin/me answers is_admin:true and the real AdminScreen mounts through App.jsx.
  await loginForCheck(page);
  const adminMe = page.waitForResponse((res) => new URL(res.url()).pathname.endsWith('/api/admin/me'), { timeout: 60000 });
  await page.goto('/admin');
  const meBody = await (await adminMe).json();
  expect(meBody.is_admin).toBe(true);

  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Manage Campaigns' })).toBeVisible();
  await expect(page.getByText(/\d+ steps, \d+ tasks/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('admin-not-available')).toHaveCount(0);
});
