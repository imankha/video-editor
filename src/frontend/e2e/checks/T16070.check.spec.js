import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T16070:C1 (ruling 2026-11-13) - there is no separate "Day N Retention" section;
 * hovering a cohort in the Retention Chart shows that cohort's day 1/3/7/14/28
 * figures (day 0, the signup day itself, is never a checkpoint). Admin-only panel,
 * so this logs in as the real admin account the way the existing T15690 admin
 * check does (a dev-preset account has no admin flag).
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

test('T16070:C1 no Day N section; Retention Chart hover shows the day 1/3/7/14/28 figures', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  await page.goto('/admin');
  const section = page.getByRole('button', { name: 'Retention Chart' });
  await expect(section).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: 'Day N Retention' })).toHaveCount(0);
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load retention chart/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  // Wait from the click, not from page.goto: the admin page's own load can take most of a minute.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/analytics/retention-chart') && r.request().method() === 'GET', { timeout: 60000 }).catch(() => null),
    loadButton.click(),
  ]);
  expect(response, 'the retention-chart endpoint responded').toBeTruthy();
  expect(response.ok(), `/api/admin/analytics/retention-chart -> ${response.status()}`).toBeTruthy();
  const body = await response.json();
  expect(body.day_n?.checkpoints, 'the chart response carries the day-N checkpoints').toEqual([1, 3, 7, 14, 28]);

  // The admin account's dev data has signup cohorts; an empty chart is a failure, not a pass.
  const curves = page.getByTestId('retention-curve');
  await expect(curves.first()).toBeVisible({ timeout: 30000 });

  const pct = (v) => `${Number(v).toFixed(2)}%`;
  const groupByLabel = new Map(body.triangle.cohorts.map((c) => [c.label, c.group]));
  const hover = page.getByTestId('retention-hover');
  let measurableSeen = 0;
  const curveCount = await curves.count();
  for (let i = 0; i < curveCount; i++) {
    // Hover the curve's last point; whatever group the card names is the one checked
    // (a covering point from another curve is fine: the card says which group it is).
    await curves.nth(i).locator('xpath=..').getByTestId('retention-point').last().hover({ force: true });
    await expect(hover).toBeVisible();
    const label = (await hover.locator('p').first().innerText()).trim();
    expect(groupByLabel.has(label), `hover card names a chart group (got "${label}")`).toBeTruthy();
    const dayN = body.day_n.cohorts.find((c) => c.group === groupByLabel.get(label));
    expect(dayN, `day_n carries figures for hovered group "${label}"`).toBeTruthy();

    await expect(hover.locator('dt')).toHaveText([1, 3, 7, 14, 28].map((n) => `Day ${n}`));
    await expect(hover.getByText('Day 0', { exact: true })).toHaveCount(0);
    // Each figure is the HOVERED group's own day-N cell, never another group's or a blank.
    const expected = [1, 3, 7, 14, 28].map((n) => {
      const cell = dayN.days[String(n)];
      if (cell) measurableSeen++;
      return cell ? `${pct(cell.pct)} (${cell.hit} of ${cell.aged})` : 'not yet measurable';
    });
    await expect(hover.locator('dd')).toHaveText(expected);
  }
  expect(measurableSeen, 'at least one hovered group shows a measured day-N figure').toBeGreaterThan(0);
});
