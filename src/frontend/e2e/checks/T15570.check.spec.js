import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T15570:C1 - closing the tab on a Framing play writes a resume point whose `left_at` and
 * playhead `t` are both set (the fields the admin "Where they left off" panel reads). Framing's
 * route is `/focus/p/{id}` (header verb "Frame", URL unchanged, T9860) and is written by the
 * same exit beacon T15360 proved for Annotate/Overlay -- this is the Framing variant of that
 * check, scoped to T15570's own criterion so it is this task's acceptance evidence.
 */
test.setTimeout(240000);

async function videoTime(page) {
  return page.locator('video').first().evaluate((v) => (v.readyState >= 1 ? v.currentTime : -1));
}

async function listedProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `/projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

test.describe('T15570 resume point after closing the tab on Framing', () => {
  test('T15570:C1 Framing: left_at and playhead t are both set after a real exit', async ({ context, page }) => {
    await loginForCheck(context);

    const list = await listedProjects(page);
    const project = list.find((p) => p.clip_count > 0) || list[0];
    expect(project, 'a project to open in Framing').toBeTruthy();

    const path = `/focus/p/${project.id}`;
    await page.goto(`${path}?t=4`);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(path);
    await expect.poll(() => videoTime(page), { timeout: 60000 }).toBeGreaterThan(1);

    await page.close({ runBeforeUnload: true }); // pagehide -> the exit beacon writes left_at/t
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const fresh = await context.newPage();
    const meRes = await fresh.request.get(checkApi('/auth/me'));
    expect(meRes.ok(), `/auth/me -> ${meRes.status()}`).toBeTruthy();
    const point = (await meRes.json()).resume_point;
    expect(point, 'a resume point written by the exit beacon').toBeTruthy();
    expect(point.left_at, 'left_at set by the exit beacon').toBeTruthy();
    expect(point.t, 'playhead t set by the exit beacon').not.toBeNull();
  });
});
