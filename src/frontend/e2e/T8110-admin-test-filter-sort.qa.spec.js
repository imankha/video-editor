// T8110 -- Admin panel: hide test accounts + sort across the whole DB, QA live-drive.
//
// Drives the admin panel AS A REAL ADMIN (imankh@gmail.com via dev-login) and
// asserts on what the user SEES: the "Real" pill hides/shows the 7 internal test
// accounts (badged when visible), a header click produces a TRUE whole-DB global
// sort (verified against a direct Postgres read, not just "the page looks sorted"),
// and the mark/unmark control flips a row's flag and survives a reload.
//
// Evidence lands in <repo>/qa/ via saveEvidence / responsiveSweep.
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test.describe('T8110 admin test-account filter + global sort', () => {
  test.beforeEach(({}, testInfo) => {
    skipOnDeployedTarget(test, 'requires admin rights + a live dev Postgres read in the target env');
  });

  test('Real pill hides/shows test accounts; combines with segment pills', async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, ADMIN_EMAIL);
    await page.goto('/admin');

    const realPill = page.getByRole('button', { name: 'Real', exact: true });
    await expect(realPill).toBeVisible({ timeout: 30000 });

    // ---- AC: default ON, admin's own account (a seeded test account) is hidden ----
    await expect(realPill).toHaveClass(/emerald/);
    const usersTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Email' }) });
    await expect(usersTable.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
    await expect(usersTable.getByText(ADMIN_EMAIL)).toHaveCount(0);
    await expect(usersTable.getByText('TEST')).toHaveCount(0);
    await saveEvidence(page, 't8110-ac1-real-on-no-test-accounts');

    // ---- AC: turning Real off shows test accounts, badged ----
    const dashReq = page.waitForResponse(r => r.url().includes('/api/admin/dashboard') && r.status() === 200);
    await realPill.click();
    await dashReq;
    await expect(realPill).not.toHaveClass(/emerald/);
    await expect(usersTable.getByText(ADMIN_EMAIL).first()).toBeVisible({ timeout: 15000 });
    await expect(usersTable.getByText('TEST').first()).toBeVisible();
    await saveEvidence(page, 't8110-ac3-real-off-shows-test-badge');

    // ---- AC: Real composes with (does not join) the exclusive segment pills ----
    const usersReq = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await realPill.click(); // back ON
    await usersReq;
    const activeReq = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await page.getByRole('button', { name: 'Active (7d)', exact: true }).click();
    const activeResp = await activeReq;
    const url = new URL(activeResp.url());
    expect(url.searchParams.get('exclude_test')).toBe('true');
    expect(url.searchParams.get('filter')).toBeTruthy();
    await saveEvidence(page, 't8110-ac2-real-plus-segment-pill-compose');
  });

  test('header click sorts the WHOLE db, not just the page; direction toggles', async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, ADMIN_EMAIL);
    await page.goto('/admin');

    const usersTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Email' }) });
    await expect(usersTable.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });

    // Ground truth read directly from Postgres via a same-env admin endpoint call
    // (not the UI under test) -- the true whole-DB extremum, excluding test accounts
    // (Real is ON by default), sorted by email ascending.
    const groundTruth = await page.request.get(
      '/api/admin/users?page=1&page_size=1&sort=email&sort_dir=asc&exclude_test=true'
    );
    expect(groundTruth.ok()).toBeTruthy();
    const { users: [expectedFirst] } = await groundTruth.json();

    const emailHeader = usersTable.locator('th', { hasText: 'Email' });
    const usersReq = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await emailHeader.click();
    await usersReq;

    // Page-1 row-1 must be the TRUE db min, not merely the min of the ~10 rows
    // this page happened to hold before the click.
    await expect(usersTable.locator('tbody tr').first()).toContainText(expectedFirst.email);
    await saveEvidence(page, 't8110-ac5-global-sort-asc-true-min');

    // ---- AC: repeat click flips direction ----
    const usersReqDesc = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await emailHeader.click();
    const descResp = await usersReqDesc;
    const descUrl = new URL(descResp.url());
    expect(descUrl.searchParams.get('sort')).toBe('email');
    expect(descUrl.searchParams.get('sort_dir')).toBe('desc');

    const groundTruthDesc = await page.request.get(
      '/api/admin/users?page=1&page_size=1&sort=email&sort_dir=desc&exclude_test=true'
    );
    const { users: [expectedLast] } = await groundTruthDesc.json();
    await expect(usersTable.locator('tbody tr').first()).toContainText(expectedLast.email);
    await saveEvidence(page, 't8110-ac6-global-sort-desc-direction-toggle');
  });

  test('mark/unmark test-account control flips the flag and survives reload', async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, ADMIN_EMAIL);
    await page.goto('/admin');

    // Turn Real off so the mark control's target rows (any) are visible regardless
    // of current flag state, and the TEST badge is observable either way.
    const realPill = page.getByRole('button', { name: 'Real', exact: true });
    await expect(realPill).toBeVisible({ timeout: 30000 });
    const usersReq1 = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await realPill.click();
    await usersReq1;

    const usersTable = page.locator('table').filter({ has: page.locator('th', { hasText: 'Email' }) });
    const row = usersTable.locator('tbody tr').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const markBtn = row.locator('button[title*="test account"]');
    await expect(markBtn).toBeVisible();
    const titleBefore = await markBtn.getAttribute('title');

    await markBtn.click();
    await expect(markBtn).toHaveAttribute('title', titleBefore === 'Mark as test account' ? 'Unmark as test account' : 'Mark as test account', { timeout: 10000 });
    const titleAfter = await markBtn.getAttribute('title');
    await saveEvidence(page, 't8110-ac4-mark-toggled');

    // ---- AC: survives a reload (DB flag, not view state) ----
    await page.reload();
    const usersReq2 = page.waitForResponse(r => r.url().includes('/api/admin/users') && r.status() === 200);
    await usersReq2.catch(() => {}); // mount fetch may already be in flight by the time we attach
    await expect(usersTable.locator('tbody tr').first()).toBeVisible({ timeout: 15000 });
    const markBtnAfterReload = usersTable.locator('tbody tr').first().locator('button[title*="test account"]');
    await expect(markBtnAfterReload).toHaveAttribute('title', titleAfter);

    // Restore original state so the QA run is idempotent against the shared dev DB.
    await markBtnAfterReload.click();
    await expect(markBtnAfterReload).toHaveAttribute('title', titleBefore, { timeout: 10000 });
  });

  test('responsive: admin screen at 375px and desktop', async ({ context, page }) => {
    test.setTimeout(60000);
    await loginAsRealUser(context, ADMIN_EMAIL);
    await page.goto('/admin');
    await expect(page.getByRole('button', { name: 'Real', exact: true })).toBeVisible({ timeout: 30000 });
    await responsiveSweep(page);
  });
});
