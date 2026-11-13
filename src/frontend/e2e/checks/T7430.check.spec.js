import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T7430 (owner ruling 2026-11-13): the Retention chart is the only retention view --
 * one large chart, no table on screen, hover shows each point's exact percent and
 * counts (C1), and its curves follow the dashboard's Dimension pill (C6). Admin-only
 * panel, so this logs in as the real admin account (dev-preset accounts have no admin
 * flag -- T15690 precedent). The admin page alone can take most of a minute to load,
 * so both criteria share one page load.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(150000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const CHART_URL = '/api/admin/analytics/retention-chart';

let page;

function chartResponse(p) {
  return p.waitForResponse((r) => r.url().includes(CHART_URL) && r.request().method() === 'GET', { timeout: 60000 });
}

// The rate text a hover shows for the last-painted point (never covered by another curve).
async function hoverLastPoint() {
  await page.getByTestId('retention-point').last().hover();
  const hover = page.getByTestId('retention-hover');
  await expect(hover).toBeVisible();
  return hover;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await loginAsRealUser(context, ADMIN_EMAIL);
  page = await context.newPage();
  await page.goto('/admin');
  // Start from the Cohorts pill so C1's weekly/monthly toggle applies.
  const cohortsPill = page.getByRole('button', { name: 'Cohorts', exact: true });
  await expect(cohortsPill).toBeVisible({ timeout: 90000 });
  await cohortsPill.click();
  const section = page.getByRole('button', { name: 'Retention Chart' });
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load retention chart/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  const [response] = await Promise.all([chartResponse(page), loadButton.click()]);
  expect(response.ok(), `${CHART_URL} -> ${response.status()}`).toBeTruthy();
  expect(new URL(response.url()).searchParams.get('group')).toBe('cohorts');
});

test.afterAll(async () => {
  await page?.context().close();
});

test('T7430:C1 one large Retention chart, no table; hover shows exact percent and counts; classic/unbounded and weekly/monthly toggles work', async () => {
  const chart = page.getByRole('img', { name: 'Retention curves' });
  await expect(chart).toBeVisible();
  await expect(page.getByTestId('retention-curve').first()).toBeVisible();

  // No table anywhere in the Retention Chart section (the chart is the only thing on screen).
  const sectionBody = chart.locator('xpath=ancestor::div[contains(@class,"space-y-4")][1]');
  await expect(sectionBody.locator('table')).toHaveCount(0);

  // Large: (nearly) the full width of the admin panel, and tall enough to read.
  const box = await chart.boundingBox();
  const panel = await sectionBody.boundingBox();
  expect(box.width, 'chart spans the panel width').toBeGreaterThan(panel.width * 0.9);
  expect(box.height, 'chart is tall').toBeGreaterThanOrEqual(400);

  // Hover any point: its exact percent and hit-of-aged counts (or the small-N raw fraction).
  const hover = await hoverLastPoint();
  const rate = hover.getByText(/^Week \d+: (\d+\.\d+% \(\d+ of \d+\)|\d+\/\d+)$/);
  await expect(rate).toBeVisible();

  // Classic vs unbounded redraws the curves.
  const curve = page.getByTestId('retention-curve').first();
  const unboundedPoints = await curve.getAttribute('points');
  await page.getByLabel('Classic').check();
  await expect.poll(() => curve.getAttribute('points')).not.toBe(unboundedPoints);

  // Weekly -> monthly re-bins the signup cohorts.
  const [monthly] = await Promise.all([chartResponse(page), page.getByLabel('Monthly').check()]);
  expect(new URL(monthly.url()).searchParams.get('cohort_bin')).toBe('month');
  const body = await monthly.json();
  for (const row of body.triangle.cohorts) {
    expect(row.group, 'monthly cohorts start on the 1st').toMatch(/-01$/);
  }
  await expect(page.getByTestId('retention-legend')).toContainText(body.triangle.cohorts[0].label);
});

test('T7430:C6 the chart compares whatever the Dimension pill selects; changing the pill changes the chart', async () => {
  for (const [pill, group, noun] of [['Campaigns', 'campaigns', 'campaigns'], ['Builds', 'builds', 'signup builds'], ['Cohorts', 'cohorts', 'signup cohorts']]) {
    const [response] = await Promise.all([
      chartResponse(page),
      page.getByRole('button', { name: pill, exact: true }).click(),
    ]);
    expect(response.ok(), `${CHART_URL} (${group}) -> ${response.status()}`).toBeTruthy();
    expect(new URL(response.url()).searchParams.get('group')).toBe(group);
    const body = await response.json();
    await expect(page.getByText(`Comparing ${noun}`)).toBeVisible();
    if (body.triangle.cohorts.length) {
      // The legend names this grouping's groups (campaign names, build numbers, cohort dates).
      await expect(page.getByTestId('retention-legend')).toContainText(body.triangle.cohorts[0].label);
    }
  }
});
