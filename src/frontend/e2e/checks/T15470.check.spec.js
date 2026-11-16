/**
 * T15470 - per-criterion acceptance check (group checks protocol).
 *
 * On an iPad-portrait-sized viewport (810x1080), a Spotlight (Overlay) portrait highlight's
 * video stage already fit above the fixed ActionBand (T15400's `max-h-[calc(100dvh-...)]`
 * fix on the stage box) -- but the playback Controls row (play/step/timeline) renders as the
 * stage's NEXT SIBLING in the same scroll column, and the T15400 scroll-fit effect only
 * measured the STAGE's bottom edge against the band, not the Controls row below it. So the
 * stage could clear the band while Controls still stuck out underneath it. Fixed by measuring
 * the deficit from the stage's parent column (stage + Controls) instead of the stage alone.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15470.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);
test.use({ viewport: { width: 810, height: 1080 } });

/**
 * T16630: the editor opens at the top (nothing scrolls it on load), so at a short viewport
 * the parent scrolls the stage up clear of the action band. Do the same: scroll App's
 * editor scroller just far enough that `testId`'s bottom edge sits above the band.
 */
async function scrollClearOfBand(page, testId) {
  // Polled: the stage keeps growing until its video has loaded, so re-scroll until clear.
  await expect.poll(() => page.getByTestId(testId).first().evaluate((el) => {
    const scroller = el.closest('.flex-1.overflow-auto');
    const band = document.querySelector('[data-testid="action-band"]');
    if (!scroller || !band) return 'no scroller or action band';
    const deficit = el.getBoundingClientRect().bottom - band.getBoundingClientRect().top + 8;
    if (deficit > 0) scroller.scrollTop += deficit;
    return el.getBoundingClientRect().bottom <= band.getBoundingClientRect().top + 0.5;
  }), { message: `scroll ${testId} clear of the action band`, timeout: 60000 }).toBe(true);
  await page.waitForTimeout(150);
}

test('T15470:C1 - Spotlight video and controls fit above the action band on iPad portrait', async ({ context, page }) => {
  await loginForCheck(context);

  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const projects = Array.isArray(body) ? body : body.projects || [];
  const candidate = projects.find((p) => p.has_working_video);
  test.skip(!candidate, '[T15470] no project with a working (framed) video in this account');

  await page.goto(`/overlay/p/${candidate.id}`);
  await page.getByTestId('overlay-video-stage').waitFor({ timeout: 90000 });
  // Let the layout settle, then scroll the stage and its controls clear of the band the
  // way a parent would (T16630: the screen opens at the top). Controls sit below the stage.
  await page.waitForTimeout(500);
  await scrollClearOfBand(page, 'play-button');

  const band = await page.getByTestId('action-band').boundingBox();
  expect(band, 'action band present').not.toBeNull();

  const stage = await page.getByTestId('overlay-video-stage').boundingBox();
  expect(stage, 'overlay video stage present').not.toBeNull();
  expect(
    stage.y + stage.height <= band.y + 0.5,
    `video stage (bottom ${stage.y + stage.height}) clipped by the action band (top ${band.y})`,
  ).toBe(true);

  const playButton = page.getByTestId('play-button');
  await expect(playButton).toBeVisible();
  const play = await playButton.boundingBox();
  expect(
    play.y + play.height <= band.y + 0.5,
    `play control (bottom ${play.y + play.height}) clipped by the action band (top ${band.y})`,
  ).toBe(true);

  const hit = await playButton.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
  expect(hit, 'elementFromPoint at the play control centre is the control, not the action band').toBe(true);
});
