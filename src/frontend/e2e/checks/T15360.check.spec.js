import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T15360:C1 - close the tab on a play, then cold-load `/`: the same play opens at the same
 * playhead on Annotate, Focus and Overlay. The resume point is written by the app itself
 * (the exit beacon on pagehide), never set through the API: a test that POSTed the point
 * without the `?profile=` query the app always adds passed while real restores never matched.
 */
test.setTimeout(240000);

async function listed(page, path) {
  const res = await page.request.get(checkApi(path));
  expect(res.ok(), `${path} -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.games || body.projects || [];
}

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1));
}

async function closeOnPlayThenColdLoad(context, page, path) {
  // ?t= seeks once (T15340), so the playhead the app records is not 0.
  await page.goto(`${path}?t=4`);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(path);
  await expect.poll(() => videoTime(page), { timeout: 60000 }).toBeGreaterThan(1);
  const before = await videoTime(page);
  await page.close({ runBeforeUnload: true }); // pagehide -> the exit beacon writes the point
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const fresh = await context.newPage();
  await fresh.goto('/');
  await expect.poll(() => new URL(fresh.url()).pathname, { timeout: 60000 }).toBe(path);
  await expect.poll(async () => Math.abs((await videoTime(fresh)) - before), { timeout: 60000 }).toBeLessThan(1.5);
}

test.describe('T15360 resume point after closing the tab', () => {
  test('T15360:C1 Annotate: the same game reopens at the same playhead', async ({ context, page }) => {
    await loginForCheck(context);
    const games = await listed(page, '/games');
    expect(games.length).toBeGreaterThan(0);
    await closeOnPlayThenColdLoad(context, page, `/annotate/g/${games[0].id}`);
  });

  test('T15360:C1 Focus: the same project reopens at the same playhead', async ({ context, page }) => {
    await loginForCheck(context);
    // A staging fixture's game video can expire ("Game video expired"): take a project that plays.
    let path = null;
    for (const project of (await listed(page, '/projects')).filter((p) => p.clip_count > 0).slice(0, 6)) {
      await page.goto(`/focus/p/${project.id}`);
      const plays = await expect.poll(() => videoTime(page), { timeout: 30000 }).toBeGreaterThanOrEqual(0)
        .then(() => true, () => false);
      if (plays && !(await page.getByText('Game video expired').isVisible())) {
        path = `/focus/p/${project.id}`;
        break;
      }
    }
    expect(path, 'a project whose game video still plays').toBeTruthy();
    await closeOnPlayThenColdLoad(context, page, path);
  });

  test('T15360:C1 Overlay: the same project reopens at the same playhead', async ({ context, page }) => {
    await loginForCheck(context);
    const project = (await listed(page, '/projects')).find((p) => p.has_working_video);
    expect(project, 'a project with a working video').toBeTruthy();
    await closeOnPlayThenColdLoad(context, page, `/overlay/p/${project.id}`);
  });
});
