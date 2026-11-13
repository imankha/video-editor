import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T7420:C1 - the admin panel answers, on demand, "what % of a month's sign-ups shared
 * (and exported) within 14 days": with the Cohorts pill selected, every signup-month row
 * shows the endpoint's own pct (hit of aged) figures, maturing months read "--". Scope
 * shrunk 2026-10-30 (owner-approved): "where did the rest stop" lives in the Journey
 * tab's step inspector (T14020), asserted here only as present on the same panel.
 * T7420:C5 (ruling 2026-11-13) - the report compares whatever the Dimension pill selects:
 * one row per campaign, signup cohort or signup build; changing the pill changes it.
 * Admin-only panel, so this logs in as the real admin account (T15690 precedent).
 * Serial: both tests share ONE admin page load (it can take most of a minute).
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const URL_PART = '/api/admin/analytics/activation';
const GROUP_HEADERS = { cohorts: 'Cohort month', campaigns: 'Campaign', builds: 'Signup build' };

let page;
let cohortsBody;

const activationResponse = (p) => p.waitForResponse(
  (r) => r.url().includes(URL_PART) && r.request().method() === 'GET', { timeout: 90000 },
);
const pct = (v) => `${Number(v).toFixed(2)}%`;
const cellText = (m) => (m ? `${pct(m.pct)} (${m.hit} of ${m.aged})` : '--');

// Every row on screen is the response's own row, in order: label, signups, export, share.
async function expectRowsMatch(body) {
  const rows = page.getByTestId('activation-cohort-row');
  await expect(rows).toHaveCount(body.cohorts.length, { timeout: 30000 });
  const table = page.locator('table', { has: rows.first() });
  await expect(table.getByRole('columnheader', { name: GROUP_HEADERS[body.group], exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Export <=14d' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Share <=14d' })).toBeVisible();
  for (let i = 0; i < body.cohorts.length; i++) {
    const c = body.cohorts[i];
    const cells = rows.nth(i).locator('td');
    await expect(cells.nth(0)).toContainText(c.label);
    await expect(cells.nth(0).getByTestId('maturing-label')).toHaveCount(c.maturing ? 1 : 0);
    await expect(cells.nth(1)).toHaveText(String(c.signups));
    await expect(cells.nth(2)).toHaveText(cellText(c.export_completed));
    await expect(cells.nth(3)).toHaveText(cellText(c.share_completed));
    // A group counts only once every member has had the 14 days; a younger one is maturing.
    if (c.maturing) {
      expect(c.export_completed, `${c.label}: maturing is never averaged in`).toBeNull();
    } else if (c.export_completed) {
      expect(c.export_completed.aged, `${c.label}: aged equals the group size once matured`).toBe(c.signups);
    }
  }
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await loginAsRealUser(context, ADMIN_EMAIL);
  page = await context.newPage();
  await page.goto('/admin');
  const cohortsPill = page.getByRole('button', { name: 'Cohorts', exact: true });
  await expect(cohortsPill).toBeVisible({ timeout: 90000 });
  await cohortsPill.click();
  const section = page.getByRole('button', { name: 'Activation', exact: true });
  await expect(section).toBeVisible({ timeout: 90000 });
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load activation/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  // Wait from the click, not from page.goto: the admin page's own load can take most of a minute.
  const [response] = await Promise.all([activationResponse(page), loadButton.click()]);
  expect(response.ok(), `${URL_PART} -> ${response.status()}`).toBeTruthy();
  expect(new URL(response.url()).searchParams.get('group')).toBe('cohorts');
  cohortsBody = await response.json();
});

test('T7420:C1 Activation section shows each signup month\'s export and share <=14d figures', async () => {
  await expect(page.getByRole('button', { name: 'Journey', exact: true })).toBeVisible();
  // The admin account's dev data has signup cohorts; an empty report is a failure, not a pass.
  expect(cohortsBody.cohorts?.length, 'the endpoint returns signup cohorts').toBeGreaterThan(0);
  expect(cohortsBody.group).toBe('cohorts');
  await expectRowsMatch(cohortsBody);
  let measuredShare = 0;
  for (const c of cohortsBody.cohorts) {
    expect(c.cohort_month, 'a Cohorts row is a signup month').toMatch(/^\d{4}-\d{2}-01$/);
    expect(c.label).toBe(c.cohort_month);
    if (c.share_completed) {
      measuredShare++;
      expect(c.share_completed.pct).toBeCloseTo((100 * c.share_completed.hit) / c.share_completed.aged, 2);
    }
  }
  expect(measuredShare, 'at least one matured month shows a measured share-within-14d figure').toBeGreaterThan(0);
});

test('T7420:C5 the report groups by whatever the Dimension pill selects; changing the pill changes the report', async () => {
  const cohortLabels = cohortsBody.cohorts.map((c) => c.label).join('|');
  for (const [pill, group] of [['Campaigns', 'campaigns'], ['Builds', 'builds'], ['Cohorts', 'cohorts']]) {
    const [response] = await Promise.all([
      activationResponse(page),
      page.getByRole('button', { name: pill, exact: true }).click(),
    ]);
    expect(response.ok(), `${URL_PART} (${group}) -> ${response.status()}`).toBeTruthy();
    expect(new URL(response.url()).searchParams.get('group')).toBe(group);
    const body = await response.json();
    expect(body.group).toBe(group);
    expect(body.cohorts.length, `${pill}: the report has groups`).toBeGreaterThan(0);
    // One entry per group: no group appears twice.
    expect(new Set(body.cohorts.map((c) => c.group)).size).toBe(body.cohorts.length);
    if (group === 'builds') {
      for (const c of body.cohorts) expect(c.group, 'a Builds row is a build number').toMatch(/^(\d+|unrecorded)$/);
    }
    if (group !== 'cohorts') {
      expect(body.cohorts.map((c) => c.label).join('|'), `${pill}: groups differ from signup months`).not.toBe(cohortLabels);
      expect(body.cohorts.some((c) => 'cohort_month' in c), `${pill}: rows are not signup months`).toBe(false);
    }
    // Every group's members sum to the same sign-ups as the signup-month view.
    const total = (b) => b.cohorts.reduce((n, c) => n + c.signups, 0);
    expect(total(body), `${pill}: every sign-up lands in exactly one group`).toBe(total(cohortsBody));
    await expect(page.getByText(new RegExp(`Export \\(primary, 14d\\) and share \\(value-moment, 14d\\) by ${
      { campaigns: 'campaign', builds: 'signup build', cohorts: 'monthly signup cohort' }[group]}`))).toBeVisible();
    await expectRowsMatch(body);
  }
});
