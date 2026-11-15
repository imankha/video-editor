import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16480 - a failed Spotlight (Overlay) data load never replaces the saved spotlights.
 * The network drops the overlay-data request (page.route abort, a real network blip as
 * the browser sees it); the editor must show an error with Retry and no default circle.
 * Retry with the network back must bring the saved spotlights and a working editor.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16480.check.spec.js --reporter=line
 */
test.setTimeout(240000);

const OVERLAY_DATA = '**/api/export/projects/*/overlay-data*';

async function findProjectWithSavedSpotlights(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const projects = (Array.isArray(body) ? body : body.projects || []).filter((p) => p.has_working_video);
  for (const project of projects.slice(0, 10)) {
    const r = await page.request.get(checkApi(`/export/projects/${project.id}/overlay-data`));
    if (!r.ok()) continue;
    const data = await r.json();
    if (data.has_data && data.highlights_data?.length > 0) return { project, saved: data.highlights_data };
  }
  return null;
}

async function openWithOverlayDataBlocked(page, found) {
  await page.route(OVERLAY_DATA, (route) => route.abort('internetdisconnected'));
  const at = (found.saved[0].start_time + 0.2).toFixed(2);
  await page.goto(`/overlay/p/${found.project.id}?t=${at}`);
}

test.describe('T16480 failed Spotlight load', () => {
  test('T16480:C1 with the Spotlight data request failing, an error with Retry shows and no default circle', async ({ context, page }) => {
    await loginForCheck(context);
    const found = await findProjectWithSavedSpotlights(page);
    expect(found, 'a project with a framed video and saved spotlights').toBeTruthy();

    await openWithOverlayDataBlocked(page, found);
    await expect(page.getByText("We couldn't load your spotlights")).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    // No editor and no spotlight (default or otherwise) while the saved ones are missing.
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('overlay-video-stage')).toHaveCount(0);
    await expect(page.locator('[data-testid^="region-lever-start-"]')).toHaveCount(0);
  });

  test('T16480:C2 after Retry succeeds the saved circles appear and editing works', async ({ context, page }) => {
    await loginForCheck(context);
    const found = await findProjectWithSavedSpotlights(page);
    expect(found, 'a project with a framed video and saved spotlights').toBeTruthy();

    await openWithOverlayDataBlocked(page, found);
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible({ timeout: 60000 });

    await page.unroute(OVERLAY_DATA);
    await retry.click();
    await page.getByTestId('overlay-video-stage').waitFor({ timeout: 90000 });
    await expect.poll(() => page.locator('[data-testid^="region-lever-start-"]').count(), { timeout: 60000 })
      .toBe(found.saved.length);
    await disableGuidanceForCheck(page);

    // Editing works: flipping the spotlight shape and back (net no change) each sends an
    // accepted overlay action.
    const actionOk = () => page.waitForResponse(
      (r) => /\/overlay\/actions/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30000 },
    );
    const around = page.getByRole('button', { name: 'Around athlete', exact: true });
    const under = page.getByRole('button', { name: 'Under athlete', exact: true });
    await expect(around).toBeVisible({ timeout: 30000 });
    const aroundActive = /bg-blue-600/.test(await around.getAttribute('class'));
    const [current, other] = aroundActive ? [around, under] : [under, around];
    for (const target of [other, current]) {
      const response = actionOk();
      await target.click();
      expect((await response).ok(), 'shape action accepted').toBeTruthy();
      await expect(target).toHaveClass(/bg-blue-600/);
    }
  });
});
