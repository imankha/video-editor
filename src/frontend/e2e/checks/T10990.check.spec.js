import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T10990 - switching a highlight between portrait and landscape in Frame is one request, and
 * the frame changes shape before that request answers (reverting with a message if it fails).
 * The switch is the user's click on the ratio selector; the POST is held or failed with
 * page.route, never replaced by an API call.
 */
test.setTimeout(240000);

const ASPECT_POST = '**/api/clips/projects/*/aspect-ratio';

/** A project whose play has a saved crop, so the box on screen is the stored one. */
async function projectWithCrop(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `/projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const projects = (Array.isArray(body) ? body : body.projects || []).filter((p) => p.clip_count > 0);
  for (const project of projects.slice(0, 10)) {
    const clipsRes = await page.request.get(checkApi(`/clips/projects/${project.id}/clips`));
    if (!clipsRes.ok()) continue;
    const clips = await clipsRes.json();
    if (clips.some((c) => Array.isArray(c.crop_data) && c.crop_data.length > 0)) return project;
  }
  return null;
}

/** 'portrait' | 'landscape' from the crop box drawn on the video. */
async function boxShape(page) {
  const box = await page.getByTestId('crop-rect').first().boundingBox();
  if (!box || !box.width || !box.height) return null;
  return box.height > box.width ? 'portrait' : 'landscape';
}

/** The ratio button that is not selected; its click is the switch. */
function otherRatioButton(page) {
  return page.locator('[role="group"][aria-label^="Highlight aspect ratio"] button[aria-pressed="false"]').first();
}

async function openFrame(page) {
  await loginForCheck(page.context());
  const project = await projectWithCrop(page);
  expect(project, 'a project whose play has a saved crop').toBeTruthy();
  await page.goto(`/focus/p/${project.id}`);
  await disableGuidanceForCheck(page);
  await expect.poll(() => boxShape(page), { timeout: 60000 }).not.toBeNull();
  await expect(otherRatioButton(page)).toBeVisible({ timeout: 60000 });
  return project;
}

test.describe('T10990 portrait/landscape switch in one step', () => {
  test('T10990:C1 switching portrait and landscape sends exactly one request', async ({ page }) => {
    const project = await openFrame(page);
    const before = await boxShape(page);

    const requests = [];
    page.on('request', (req) => {
      if (req.url().includes(`/projects/${project.id}`)) requests.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });
    await otherRatioButton(page).click();
    await expect.poll(() => boxShape(page), { timeout: 60000 }).not.toBe(before);
    // Let any follow-up refetch (the old clips + project GETs) arrive before counting.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    expect(requests, `requests for project ${project.id}`).toEqual([
      `POST /api/clips/projects/${project.id}/aspect-ratio`,
    ]);

    // Put the reel back the way it was.
    await otherRatioButton(page).click();
    await expect.poll(() => boxShape(page), { timeout: 60000 }).toBe(before);
  });

  test('T10990:C2 the frame changes shape before the request answers, and reverts with a message if it fails', async ({ page }) => {
    await openFrame(page);
    const before = await boxShape(page);

    // Hold the POST: the box must change shape while it is still unanswered.
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let answered = false;
    await page.route(ASPECT_POST, async (route) => {
      await held;
      answered = true;
      await route.continue();
    });
    await otherRatioButton(page).click();
    await expect.poll(() => boxShape(page), { timeout: 15000 }).not.toBe(before);
    expect(answered, 'the shape changed while the POST was still held').toBe(false);
    release();
    await expect.poll(() => answered, { timeout: 30000 }).toBe(true);
    await page.unroute(ASPECT_POST);
    const switched = await boxShape(page);
    expect(switched).not.toBe(before);

    // A failed switch puts the old shape back and says so.
    await page.route(ASPECT_POST, (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'boom' }),
    }));
    await otherRatioButton(page).click();
    await expect(page.getByText("We couldn't change the shape. Try again.")).toBeVisible({ timeout: 30000 });
    await expect.poll(() => boxShape(page), { timeout: 30000 }).toBe(switched);
    await page.unroute(ASPECT_POST);

    // Put the reel back the way it was.
    await otherRatioButton(page).click();
    await expect.poll(() => boxShape(page), { timeout: 60000 }).toBe(before);
  });
});
