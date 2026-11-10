import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T15410:C1 - cold-loading /focus/p/<id> from a closed tab shows the Frame editor within
 * 10s, no reload needed. The resume point is written by the app itself (the exit beacon on
 * pagehide), never set through the API.
 *
 * Regression for the gap fixed in resumePointRestore.js: that path called
 * useProjectsStore.selectProject() alone, which only fetches the project record -- never
 * projectDataStore's clips/working video, which is what FocusScreen actually renders from.
 * Before the fix the editor hung on "Loading..." well past 10s (observed 35-50s on staging).
 */
test.setTimeout(120000);

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1));
}

test('T15410:C1 cold-loading a play from a closed tab shows Frame within 10s', async ({ context, page }) => {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const projects = (await res.json()).projects || (await res.json());
  const project = Array.isArray(projects) ? projects.find((p) => p.clip_count > 0) : null;
  expect(project, 'a project with at least one clip').toBeTruthy();

  const path = `/focus/p/${project.id}`;
  await page.goto(path);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(path);
  await expect.poll(() => videoTime(page), { timeout: 60000 }).toBeGreaterThanOrEqual(0);

  // Close the tab (pagehide fires the exit beacon that writes the resume point) and
  // reopen cold at the root -- the scenario this criterion names.
  await page.close({ runBeforeUnload: true });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const fresh = await context.newPage();
  const start = Date.now();
  await fresh.goto('/');
  await expect.poll(() => new URL(fresh.url()).pathname, { timeout: 10000 }).toBe(path);
  await expect.poll(() => videoTime(fresh), { timeout: 10000 }).toBeGreaterThanOrEqual(0);
  expect(Date.now() - start, 'Frame editor loaded within 10s of the cold reopen').toBeLessThan(10000);
});
