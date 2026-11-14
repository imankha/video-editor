import { readFileSync } from 'node:fs';
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
let firstBody; // the chart response the section's first load drew (Cohorts, weekly)

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
  firstBody = await response.json();
});

// Click the Retention Chart section's own Refresh and return the chart response it drew.
async function refreshChart() {
  const section = page.getByPlaceholder('export_completed').locator('xpath=ancestor::div[contains(@class,"space-y-4")][1]');
  const refresh = section.getByRole('button', { name: 'Refresh' });
  const [response] = await Promise.all([chartResponse(page), refresh.click()]);
  expect(response.ok(), `${CHART_URL} -> ${response.status()}`).toBeTruthy();
  return response;
}

const pct = (v) => `${Number(v).toFixed(2)}%`;

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

  // Classic vs unbounded redraws the curves. Compare every drawn curve, not the first: a
  // group whose members never left and came back has identical curves in both views
  // (T16440: staging's first drawn cohort had 1 signup and identical rates). The chart
  // draws the first 8 groups (RetentionView MAX_CURVES).
  const differs = firstBody.triangle.cohorts.slice(0, 8).some((row) => Object.values(row.weeks)
    .some((c) => c && c.classic?.pct !== c.unbounded?.pct));
  expect(differs, 'live data has a drawn group whose classic and unbounded rates differ').toBe(true);
  const allPoints = () => page.getByTestId('retention-curve')
    .evaluateAll((els) => els.map((el) => el.getAttribute('points')).join('|'));
  const unboundedPoints = await allPoints();
  await page.getByLabel('Classic').check();
  await expect.poll(allPoints).not.toBe(unboundedPoints);

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

test('T7430:C2 low-volume weeks are visibly shaded with the detection rule printed; a dormant-through-low-volume user is not churned in unbounded', async () => {
  // The backend half (a user dormant exactly through detected low-volume weeks reads
  // 100% retained unbounded, 0% classic) is TestLowVolumeDormantUser, run by the same
  // check command. This half reads the live data the section drew.
  const { wau, low_volume_rule: rule } = firstBody;
  const flagged = wau.filter((w) => w.low_volume);
  expect(flagged.length, 'live WAU series has detected low-volume weeks to shade').toBeGreaterThan(0);

  await expect(page.getByText(
    `WAU below ${Math.round(rule.ratio * 100)}% of the trailing ${rule.trailing_weeks}-week median is shaded as low-volume`,
  )).toBeVisible();

  const bars = page.getByTestId('wau-bar');
  await expect(bars).toHaveCount(wau.length);
  const shaded = page.locator('[data-testid="wau-bar"][data-low-volume="true"]');
  await expect(shaded).toHaveCount(flagged.length);
  for (const [i, w] of flagged.entries()) {
    await expect(shaded.nth(i)).toHaveAttribute('title', new RegExp(`^${w.week}: WAU ${w.wau}\\b`));
  }
  const color = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plain = page.locator('[data-testid="wau-bar"][data-low-volume="false"]').first();
  expect(await color(shaded.first()), 'a low-volume week is shaded differently').not.toBe(await color(plain));

  // Live consequence of the unbounded definition: a weekly cohort's unbounded curve never
  // dips for a dormant stretch (the cohort's members are counted while they are away).
  for (const row of firstBody.triangle.cohorts) {
    const hits = Object.keys(row.weeks).sort((a, b) => a - b)
      .map((w) => row.weeks[w].unbounded).filter(Boolean).map((c) => c.hit);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i], `${row.group} unbounded week ${i} vs ${i - 1}`).toBeLessThanOrEqual(hits[i - 1]);
    }
  }
});

test('T7430:C3 return-after-gap rate (active again 120+ days later) is displayed with cohort sizes', async () => {
  const gap = firstBody.return_after_gap;
  expect(gap.gap_days).toBe(120);
  const measured = gap.cohorts.filter((c) => c.pct != null);
  expect(measured.length, 'live data has months matured past the gap').toBeGreaterThan(0);

  const line = page.getByTestId('return-after-gap');
  await expect(line).toContainText('Active again 120+ days later');
  for (const c of measured) {
    // rate, returners and the month's cohort size, exactly as the API computed them
    await expect(line).toContainText(`${c.month.slice(0, 7)} ${pct(c.pct)} (${c.hit} of ${c.cohort_size})`);
  }
  // A month not yet 120 days past its end never shows a rate.
  for (const c of gap.cohorts.filter((x) => x.pct == null)) {
    await expect(line).not.toContainText(`${c.month.slice(0, 7)} `);
  }
});

test('T7430:C4 clip-library retention is viewable in the admin panel from the T7400 rollup', async () => {
  const actionBox = page.getByPlaceholder('export_completed');
  await actionBox.fill('collection_viewed');

  // Live: the request names the action and the panel states the rollup's honest state
  // (no T7450 clip-library events exist yet), never an error.
  const live = await refreshChart();
  expect(new URL(live.url()).searchParams.get('action')).toBe('collection_viewed');
  const liveAction = (await live.json()).action;
  expect(liveAction.action).toBe('collection_viewed');
  await expect(page.getByText(/^Error:/)).toHaveCount(0);
  if (!liveAction.available) {
    await expect(page.getByText('Run the action rollup first (Analytics > Run rollup).')).toBeVisible();
  } else if (!liveAction.cohorts.length) {
    await expect(page.getByText('No cohorts yet for collection_viewed.')).toBeVisible();
  }

  // Once the rollup holds clip-library rows: the panel draws them as dashed curves with a
  // legend entry and an exact hover. The payload is the shape the backend computes from
  // rollup_action_weekly (TestActionRetention::test_endpoint_serves_a_clip_library_action_curve_from_the_rollup,
  // run by this check's command).
  const cohort = {
    cohort_week: '2026-06-01', base: 10,
    weeks: { 0: { pct: 100, hit: 10, aged: 10 }, 2: { pct: 50, hit: 5, aged: 10 } },
  };
  await page.route((url) => url.pathname.endsWith(CHART_URL), async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.action = { action: 'collection_viewed', available: true, partial: false, cohorts: [cohort] };
    await route.fulfill({ response: res, json: body });
  });
  try {
    await refreshChart();
    const curve = page.getByTestId('retention-action-curve');
    await expect(curve).toHaveCount(1);
    await expect(page.getByTestId('retention-legend')).toContainText('collection_viewed 2026-06-01 (10)');
    // The action curves paint last, so the last point is this curve's week 2.
    const hover = await hoverLastPoint();
    await expect(hover).toContainText('collection_viewed 2026-06-01');
    await expect(hover).toContainText('10 signups');
    await expect(hover).toContainText('Week 2: 50.00% (5 of 10)');
  } finally {
    await page.unroute((url) => url.pathname.endsWith(CHART_URL));
    await actionBox.fill('');
  }
});

test('T7430:C5 CSV export downloads the chart data; no new stored data', async () => {
  // No new stored data: the chart's service only reads (T7400's rollup is the one store).
  const service = readFileSync(new URL('../../../backend/app/services/analytics_retention_chart.py', import.meta.url), 'utf8');
  expect(service).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE|UPSERT)\b/i);

  const body = await (await refreshChart()).json();
  await page.getByLabel('Unbounded').check();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^retention-unbounded-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync(await download.path(), 'utf8');
  const lines = text.split('\r\n');
  const weeks = body.triangle.weeks_tracked;
  expect(lines[0].split(',').slice(1)).toEqual(['Signups', ...Array.from({ length: weeks }, (_, i) => `Week ${i}`)]);
  expect(lines.length - 1, 'one row per group').toBe(body.triangle.cohorts.length);
  const row = body.triangle.cohorts[0];
  const expected = [row.label, String(row.signups),
    ...Array.from({ length: weeks }, (_, i) => { const c = row.weeks[String(i)]?.unbounded; return c ? String(c.pct) : ''; })];
  expect(lines[1].split(',')).toEqual(expected);
});
