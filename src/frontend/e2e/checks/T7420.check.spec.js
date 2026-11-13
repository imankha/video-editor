import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T7420:C1 - the admin panel answers, on demand, "what % of a month's sign-ups shared
 * (and exported) within 14 days": every monthly cohort row shows the endpoint's own
 * pct (hit of aged) figures, maturing cohorts read "--". Scope shrunk 2026-10-30
 * (owner-approved): "where did the rest stop" lives in the Journey tab's step
 * inspector (T14020), asserted here only as present on the same panel.
 * Admin-only panel, so this logs in as the real admin account (T15690 precedent).
 */
test.setTimeout(180000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T7420:C1 Activation section shows each signup month\'s export and share <=14d figures', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  await page.goto('/admin');
  const section = page.getByRole('button', { name: 'Activation', exact: true });
  await expect(section).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Journey', exact: true })).toBeVisible();
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load activation/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  // Wait from the click, not from page.goto: the admin page's own load can take most of a minute.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/activation') && r.request().method() === 'GET', { timeout: 90000 }).catch(() => null),
    loadButton.click(),
  ]);
  expect(response, 'the activation endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/activation -> ${response.status()}`).toBeTruthy();
  const body = await response.json();

  // The admin account's dev data has signup cohorts; an empty report is a failure, not a pass.
  expect(body.cohorts?.length, 'the endpoint returns signup cohorts').toBeGreaterThan(0);
  const rows = page.getByTestId('activation-cohort-row');
  await expect(rows).toHaveCount(body.cohorts.length, { timeout: 30000 });
  const table = page.locator('table', { has: rows.first() });
  await expect(table.getByRole('columnheader', { name: 'Export <=14d' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Share <=14d' })).toBeVisible();

  const pct = (v) => `${Number(v).toFixed(2)}%`;
  const cellText = (m) => (m ? `${pct(m.pct)} (${m.hit} of ${m.aged})` : '--');
  let measuredShare = 0;
  for (let i = 0; i < body.cohorts.length; i++) {
    const c = body.cohorts[i];
    const cells = rows.nth(i).locator('td');
    await expect(cells.nth(0)).toContainText(c.cohort_month);
    await expect(cells.nth(1)).toHaveText(String(c.signups));
    // Export and share are each the cohort's own figure, never a neighbour's or a blank.
    await expect(cells.nth(2)).toHaveText(cellText(c.export_completed));
    await expect(cells.nth(3)).toHaveText(cellText(c.share_completed));
    if (c.share_completed) {
      measuredShare++;
      expect(c.share_completed.aged, `${c.cohort_month}: aged equals the cohort size once matured`).toBe(c.signups);
      expect(c.share_completed.pct).toBeCloseTo((100 * c.share_completed.hit) / c.share_completed.aged, 2);
    }
  }
  expect(measuredShare, 'at least one matured month shows a measured share-within-14d figure').toBeGreaterThan(0);
});
