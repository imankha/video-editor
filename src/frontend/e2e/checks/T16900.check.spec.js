import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T16900:C4 - Admin Campaigns can group by medium and by referring website; blank values
 * show as "unknown". Every sign-up before T16900 has no referring website stored, so the
 * referring-website view always has an "unknown" row on a stack with any sign-ups.
 * A dev-picker account is an admin on a dev stack (T16430); a deployed target's check account
 * is not, so there it logs in as the real admin account (T16660:C3 precedent).
 */
test.setTimeout(240000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

async function openCampaigns(page) {
  if (process.env.E2E_BASE_URL) {
    await loginAsRealUser(page, ADMIN_EMAIL);
  } else {
    await loginForCheck(page);
  }
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  const picker = page.getByLabel('Group by');
  await expect(picker).toBeVisible({ timeout: 60000 });
  return picker;
}

async function groupBy(page, picker, by, label) {
  const response = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname.endsWith('/admin/analytics/channels') && url.searchParams.get('by') === by;
  }, { timeout: 90000 });
  await picker.selectOption({ label });
  const res = await response;
  expect(res.ok(), `channels?by=${by} answered ${res.status()}`).toBe(true);
  const rows = (await res.json()).channels;
  const table = page.locator('table', { has: page.getByRole('columnheader', { name: label, exact: true }) });
  await expect(table).toBeVisible({ timeout: 60000 });
  return { rows, table };
}

test('T16900:C4 Campaigns groups by medium and by referring website, blanks as unknown', async ({ page }) => {
  const picker = await openCampaigns(page);

  for (const [by, label] of [['utm_medium', 'Medium'], ['referrer_host', 'Referring website']]) {
    const { rows, table } = await groupBy(page, picker, by, label);
    expect(rows.length, `${label}: the window has sign-ups to group`).toBeGreaterThan(0);
    // Blank is never its own row: it is grouped as "unknown".
    for (const row of rows) expect(row[by], `${label} row value`).toBeTruthy();
    expect(rows.map((r) => r[by]), `${label}: sign-ups with no value group as unknown`).toContain('unknown');
    for (const row of rows) {
      await expect(table.getByText(row[by], { exact: true }).first()).toBeVisible();
    }
  }
});
