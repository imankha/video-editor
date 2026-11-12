import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T15690:C1 - Every Journey control (conversion window / inactive after / platform /
 * sport pills, and the full-screen toggle) stays reachable -- fully within the
 * viewport, not clipped by an ancestor -- at 390px (iPhone 14 class) and 810px
 * (iPad class). Reproduces the staging QA finding: at 390px the control row was
 * 918px wide and got clipped by CollapsibleSection's rounded-corner `overflow-hidden`
 * wrapper (AdminScreen.jsx), making the Sport pills from "Rugby" on and the Platform
 * pills unreachable.
 */
test.setTimeout(120000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

async function assertControlsReachable(page) {
  const controls = page.getByTestId('journey-controls');
  await expect(controls).toBeVisible();
  const vw = await page.evaluate(() => window.innerWidth);
  const buttons = controls.locator('button');
  const n = await buttons.count();
  expect(n, 'journey-controls has buttons to check').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const btn = buttons.nth(i);
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    const label = (await btn.textContent())?.trim() || (await btn.getAttribute('aria-label'));
    expect(box, `${label} has a bounding box`).toBeTruthy();
    expect(box.x, `${label} left edge within the ${vw}px viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label} right edge within the ${vw}px viewport`).toBeLessThanOrEqual(vw + 1);
  }
}

test('T15690:C1 Journey controls stay reachable at 390px and 810px', async ({ context, page }) => {
  await loginAsRealUser(context, ADMIN_EMAIL);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await expect(page.getByTestId('journey-root')).toBeVisible({ timeout: 60000 });
  await assertControlsReachable(page);

  await page.setViewportSize({ width: 810, height: 1080 });
  await page.waitForTimeout(250); // let the responsive layout settle
  await assertControlsReachable(page);
});
