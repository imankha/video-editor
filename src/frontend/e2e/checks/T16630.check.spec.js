/**
 * T16630 - per-criterion acceptance checks (group checks protocol).
 *
 * The Frame and Spotlight screens opened already scrolled ~250px down: the T15400
 * "stage fit" layout effects (FocusModeView / OverlayModeView) scrolled App's
 * `flex-1 overflow-auto` editor scroller on load to pull the video above the action
 * band, pushing the header, mode tabs and Portrait/Landscape chooser off the top.
 * Fixed by removing those on-load scrolls: the screen opens at the top.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16630.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

const VIEWPORTS = [
  { label: 'desktop 1280x800', width: 1280, height: 800 },
  { label: 'phone 390x844', width: 390, height: 844 },
];

async function listProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

/** scrollTop of App's editor scroller (the `flex-1 overflow-auto` ancestor of the header's back button). */
async function editorScrollTop(page) {
  return page.getByTestId('editor-home').evaluate((el) => {
    const scroller = el.closest('.flex-1.overflow-auto');
    return scroller ? scroller.scrollTop : null;
  });
}

/** The element is inside the viewport and is what a tap at its centre hits. */
async function expectShownWithoutScrolling(page, locator, name) {
  await expect(locator, `${name} rendered`).toBeVisible();
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box.y >= 0 && box.y + box.height <= vp.height, `${name} (y=${box.y}) is inside the ${vp.width}x${vp.height} viewport`).toBe(true);
  // Polled: on a slow dev stack the boot-time "Connecting..." banner can sit over the
  // header until the server answers; it clears itself on its next retry.
  await expect.poll(() => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  }), { message: `${name} is not covered by anything`, timeout: 60000 }).toBe(true);
}

/**
 * The editor has finished opening: the loading overlay (#preloader) and the
 * "Connecting..." banner are gone and the stage's video has loaded (the stage only
 * reaches its real height, and the layout settles, once the video has its size).
 */
async function waitForEditor(page, stageTestId) {
  const stage = page.getByTestId(stageTestId);
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Connecting...')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
}

/** Wait well past the stage's layout settling, then require the scroller still at the top. */
async function expectOpensAtTop(page) {
  await page.waitForTimeout(2000);
  await expect.poll(() => editorScrollTop(page), { timeout: 5000 }).toBe(0);
  await page.waitForTimeout(1000);
  expect(await editorScrollTop(page), 'editor scroller stayed at the top after load').toBe(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`T16630 @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`T16630:C1 - Frame opens at the top with header, mode tabs and Portrait/Landscape chooser shown @ ${vp.label}`, async ({ context, page }) => {
      await loginForCheck(context);
      const projects = await listProjects(page);
      const candidate = projects.find((p) => (p.clip_count || 0) > 0);
      test.skip(!candidate, '[T16630] no project with a clip in this account');

      await page.goto(`/focus/p/${candidate.id}`);
      await waitForEditor(page, 'focus-video-stage');
      await expectOpensAtTop(page);

      await expectShownWithoutScrolling(page, page.getByTestId('editor-home'), 'header back/home button');
      await expectShownWithoutScrolling(page, page.getByTestId('mode-framing'), 'Frame mode tab');
      // T17910 (owner ruling 2026-11-19): on a computer the chooser is not rendered; the
      // Settings rail's Shape row asks that question instead. Phones keep the chooser.
      if (vp.width >= 1024) {
        await expect(page.getByTestId('focus-shape-choice')).toHaveCount(0);
        await expect(page.getByText('Shape', { exact: true }).first()).toBeVisible();
      } else {
        await expectShownWithoutScrolling(page, page.getByTestId('focus-shape-choice').first(), 'Portrait/Landscape chooser');
      }
    });

    test(`T16630:C2 - Spotlight opens at the top with header and mode tabs shown @ ${vp.label}`, async ({ context, page }) => {
      await loginForCheck(context);
      const projects = await listProjects(page);
      const candidate = projects.find((p) => p.has_working_video);
      test.skip(!candidate, '[T16630] no project with a framed video in this account');

      await page.goto(`/overlay/p/${candidate.id}`);
      await waitForEditor(page, 'overlay-video-stage');
      await expectOpensAtTop(page);

      await expectShownWithoutScrolling(page, page.getByTestId('editor-home'), 'header back/home button');
      await expectShownWithoutScrolling(page, page.getByTestId('mode-overlay'), 'Spotlight mode tab');
    });
  });
}

test.describe('T16630 scroll position is the parent\'s', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('T16630:C3 - a screen the parent scrolled stays where they scrolled it', async ({ context, page }) => {
    await loginForCheck(context);
    const projects = await listProjects(page);
    const candidate = projects.find((p) => (p.clip_count || 0) > 0);
    test.skip(!candidate, '[T16630] no project with a clip in this account');

    await page.goto(`/focus/p/${candidate.id}`);
    await waitForEditor(page, 'focus-video-stage');
    await page.waitForTimeout(2000);

    // Wheel over the header (the crop stage takes the wheel for its own zoom).
    const home = await page.getByTestId('editor-home').boundingBox();
    await page.mouse.move(home.x + home.width / 2, home.y + home.height / 2);
    await page.mouse.wheel(0, 200);
    await expect.poll(() => editorScrollTop(page), { timeout: 5000 }).toBeGreaterThan(0);
    const scrolled = await editorScrollTop(page);
    await page.waitForTimeout(2000);
    expect(await editorScrollTop(page), 'the parent\'s scroll position was not reset').toBe(scrolled);
  });
});
