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

// The admin page loads its dashboard on mount, and a dev build mounts twice (StrictMode), so
// two dashboard answers can arrive with the picker already on screen after the first. An
// admin's pick must survive a later dashboard answer: the check delays every dashboard answer
// after the first, picks as soon as it can, and asserts only after every answer has landed
// (the reset the verifier hit on a slow stack).
async function delayLaterDashboards(page) {
  const dashboards = { seen: 0, pending: 0 };
  await page.route((url) => url.pathname.endsWith('/admin/dashboard'), async (route) => {
    const later = dashboards.seen++ > 0;
    dashboards.pending++;
    try {
      const response = await route.fetch();
      if (later) await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.fulfill({ response });
    } finally {
      dashboards.pending--;
    }
  });
  return dashboards;
}

async function openCampaigns(page) {
  if (process.env.E2E_BASE_URL) {
    await loginAsRealUser(page, ADMIN_EMAIL);
  } else {
    await loginForCheck(page);
  }
  const dashboards = await delayLaterDashboards(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  const picker = page.getByLabel('Group by');
  await expect(picker).toBeVisible({ timeout: 60000 });
  return { picker, dashboards };
}

async function groupBy(page, picker, by, label, dashboards) {
  const response = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname.endsWith('/admin/analytics/channels') && url.searchParams.get('by') === by;
  }, { timeout: 90000 });
  await picker.selectOption({ label });
  const res = await response;
  expect(res.ok(), `channels?by=${by} answered ${res.status()}`).toBe(true);
  const rows = (await res.json()).channels;
  expect(rows.length, `${label}: the window has sign-ups to group`).toBeGreaterThan(0);
  await expect.poll(() => dashboards.pending, { message: 'every dashboard answer has landed', timeout: 90000 }).toBe(0);
  await expect(picker, `${label}: the pick is still selected`).toHaveValue(by);
  const table = page.locator('table', { has: page.getByRole('columnheader', { name: label, exact: true }) });
  await expect(table).toBeVisible({ timeout: 60000 });
  return { rows, table };
}

test('T16900:C4 Campaigns groups by medium and by referring website, blanks as unknown', async ({ page }) => {
  const { picker, dashboards } = await openCampaigns(page);

  for (const [by, label] of [['utm_medium', 'Medium'], ['referrer_host', 'Referring website']]) {
    const { rows, table } = await groupBy(page, picker, by, label, dashboards);
    // Blank is never its own row: it is grouped as "unknown".
    for (const row of rows) expect(row[by], `${label} row value`).toBeTruthy();
    expect(rows.map((r) => r[by]), `${label}: sign-ups with no value group as unknown`).toContain('unknown');
    for (const row of rows) {
      await expect(table.getByText(row[by], { exact: true }).first()).toBeVisible();
    }
  }
});
