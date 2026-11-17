/**
 * T16710 - per-criterion acceptance checks (group checks protocol).
 *
 * The staging check for T16640:C2 failed at 1280x800: opening Trim left the Normal speed
 * track 1px under the action band ("speed-track bottom 728 is under the action band (top
 * 727)") and nothing scrolled. Opening Trim scrolled the timeline with
 * scrollIntoView({block: 'nearest'}) and a scroll-margin the size of the band, but Chromium
 * does nothing when the box already sits inside the scroller's viewport, and the band is
 * drawn over that viewport. On the dev stack the timeline happened to cross the viewport
 * edge, so it scrolled and the check passed; on staging it stopped short of the edge. A
 * taller desktop window reproduces the staging case on any stack, so this check opens Trim
 * at several desktop heights, 1280x800 first.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16710.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);
test.use({ viewport: { width: 1280, height: 800 } });

async function listProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

/** 'ok' when the element is fully inside the viewport and fully above the action band. */
async function placement(page, testId) {
  return page.getByTestId(testId).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const band = document.querySelector('[data-testid="action-band"]').getBoundingClientRect();
    if (r.height === 0) return `${el.dataset.testid} has no height`;
    if (r.top < -0.5) return `${el.dataset.testid} top ${Math.round(r.top)} is above the viewport`;
    if (r.bottom > band.top + 0.5) return `${el.dataset.testid} bottom ${Math.round(r.bottom)} is under the action band (top ${Math.round(band.top)})`;
    return 'ok';
  });
}

test('T16710:C1 - in Trim mode the Normal speed track is fully visible (T16640:C2), at 1280x800 and taller desktop windows', async ({ context, page }) => {
  await loginForCheck(context);
  const projects = await listProjects(page);
  const candidate = projects.find((p) => (p.clip_count || 0) > 0);
  expect(candidate, 'a project with a clip').toBeTruthy();
  await page.goto(`/focus/p/${candidate.id}`);
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
  await page.getByTestId('crop-track').waitFor({ timeout: 60000 });

  const trim = page.getByTestId('trim-slowmo-button');
  const speed = page.getByTestId('speed-track');
  for (const height of [800, 1100, 1440]) {
    await page.setViewportSize({ width: 1280, height });
    // The parent arrives at the top of the screen with Trim closed.
    await stage.evaluate((el) => { el.closest('.flex-1.overflow-auto').scrollTop = 0; });
    await page.waitForTimeout(1500);
    await trim.click();
    await expect(speed).toBeVisible({ timeout: 30000 });
    await expect(speed.getByText('Normal speed').first()).toBeVisible();
    await expect.poll(() => placement(page, 'speed-track'), { message: `speed track fully visible at 1280x${height}`, timeout: 15000 }).toBe('ok');
    await trim.click();
    await expect(speed).toHaveCount(0, { timeout: 30000 });
  }
});
