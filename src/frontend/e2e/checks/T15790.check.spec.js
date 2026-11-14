import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T15790:C1 - after a cold reopen (open /focus/p/<id>, close the tab, open / in a fresh tab)
 * the Frame editor at the resumed path renders with its video ready within 10s.
 *
 * Regression for the stall T15790 fixed: the resume-point routes (POST/DELETE
 * /api/me/resume-point, the /api/auth/me read) ran blocking psycopg2 inside `async def`,
 * freezing the event loop so every concurrent restore request finished together 3.6-6s late
 * and Frame settled 6.4-9.9s after '/' (often past 10s). The check also records how long the
 * restore's own API requests took, so a failure says whether the backend stalled.
 */
test.setTimeout(120000);

async function videoReady(page) {
  return page.locator('video').first().evaluate((v) => v.readyState).catch(() => -1);
}

test('T15790:C1 cold reopen of /focus/p/<id> restores the Frame editor with its video within 10s', async ({ context, page }) => {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const projects = Array.isArray(body) ? body : body.projects;
  const project = (projects || []).find((p) => p.clip_count > 0);
  expect(project, 'a project with at least one clip').toBeTruthy();

  const path = `/focus/p/${project.id}`;
  await page.goto(path);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(path);
  await expect.poll(() => videoReady(page), { timeout: 60000 }).toBeGreaterThanOrEqual(1);

  // Closing the tab fires the app's own exit beacon, which writes the resume point.
  await page.close({ runBeforeUnload: true });
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const fresh = await context.newPage();
  const apiTimes = [];
  fresh.on('requestfinished', (req) => {
    if (req.url().includes('/api/')) {
      const t = req.timing();
      apiTimes.push(`${req.method()} ${new URL(req.url()).pathname} ${Math.round(t.responseEnd)}ms`);
    }
  });
  const start = Date.now();
  await fresh.goto('/');
  await expect.poll(() => new URL(fresh.url()).pathname, { timeout: 10000 }).toBe(path);
  // readyState >= 1 (as T15410): the Frame editor's video has loaded its source. Playwright's
  // bundled Chromium stalls at 1 on the local stack's H.264, so 2 is not reachable everywhere.
  await expect.poll(() => videoReady(fresh), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
  const elapsed = Date.now() - start;
  expect(elapsed, `Frame editor + video ready within 10s of the cold reopen; restore API: ${apiTimes.join(', ')}`).toBeLessThan(10000);
});
