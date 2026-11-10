/**
 * T15650 - per-criterion acceptance checks (group checks protocol).
 *
 * Two bugs from the 2026-11-09 staging QA pass:
 *  - C1: Frame's "Preview highlight" toggle (FramingActionRow) showed the output-aspect
 *    preview box at ~165px wide on desktop (1440x900, portrait 9:16 output) with its time
 *    readout crowded out of the Controls bar below it. Root cause:
 *    `SHORT_DESKTOP_PREVIEW_WIDTH_CLASS` (FocusModeView.jsx) floored only an intermediate
 *    HEIGHT term at 320px before multiplying by the (sub-1) output aspect ratio, so a
 *    portrait output could still collapse to a tiny width once the taller ActionBand
 *    (T15400/T15470) shrank the available-height term. Separately, this class (and its
 *    height-floor sibling, SHORT_DESKTOP_BOX_HEIGHT_CLASS) interpolated a JS constant
 *    (`${SHORT_DESKTOP_MEDIA}`) into the Tailwind arbitrary-variant bracket -- Tailwind's
 *    content scanner reads raw source text, not evaluated template literals, so neither
 *    class ever matched the DOM in the browser; the un-floored plain `lg:` class silently
 *    won every time. Fixed by hardcoding the literal media text (matching the established
 *    AnnotateModeView/OverlayModeView SHORT_DESKTOP_STAGE_CLASS convention) and adding an
 *    explicit WIDTH floor of `max(50%, ...)`.
 *  - C2: on iPad portrait (810x1080) the FocusTimeline's zoom chip (`100%`) rendered
 *    entirely behind the sticky ActionBand on load. The stage-fit scroll effect
 *    (FocusModeView's stageRef useLayoutEffect) only measured the STAGE's own bottom edge
 *    against the band -- the timeline block (trim-guide-scope) renders as a SIBLING below
 *    the stage, so clearing the stage alone left the timeline (and its zoom chip) still
 *    behind the band even though plenty of scroll room existed. Fixed by measuring the
 *    deficit from whichever of the stage or the timeline block's bottom edge sits lower.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15650.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

async function firstClipProject(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const projects = Array.isArray(body) ? body : body.projects || [];
  return projects.find((p) => p.clip_count > 0);
}

test('T15650:C1 - Frame preview is at least half the editor width with a readable time', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginForCheck(context);
  const candidate = await firstClipProject(page);
  test.skip(!candidate, '[T15650] no clip project in this account');

  await page.goto(`/focus/p/${candidate.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);

  const toggle = page.getByTestId('framing-preview-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.waitForTimeout(500);

  // Editor width proxy, measured in the SAME (post-toggle, settled) layout pass as the
  // stage below: the settings rail mounts asynchronously shortly after first paint, so
  // measuring the column before the toggle can catch it pre-rail-mount and overstate the
  // available width. The stage's own direct parent (after the rail has claimed its gutter)
  // is the real "editor width" a user sees.
  const editorWidth = (await page.getByTestId('trim-guide-scope').boundingBox()).width;

  const stage = await page.getByTestId('focus-video-stage').boundingBox();
  expect(stage, 'focus video stage present while previewing').not.toBeNull();
  expect(
    stage.width >= editorWidth / 2 - 1,
    `preview stage width (${stage.width}) is less than half the editor width (${editorWidth})`,
  ).toBe(true);

  const timeDisplay = page.locator('.controls-container .font-mono').first();
  await expect(timeDisplay).toBeVisible();
  const timeText = (await timeDisplay.textContent()) || '';
  expect(timeText, 'time readout shows a real clock value').toMatch(/\d+:\d{2}/);

  const controls = await page.locator('.controls-container').first().boundingBox();
  const timeBox = await timeDisplay.boundingBox();
  expect(
    timeBox.x >= controls.x - 0.5 && timeBox.x + timeBox.width <= controls.x + controls.width + 0.5,
    'time readout is fully inside the Controls bar, not clipped',
  ).toBe(true);
});

test('T15650:C2 - the timeline zoom pill is fully visible on iPad portrait', async ({ context, page }) => {
  await page.setViewportSize({ width: 810, height: 1080 });
  await loginForCheck(context);
  const candidate = await firstClipProject(page);
  test.skip(!candidate, '[T15650] no clip project in this account');

  await page.goto(`/focus/p/${candidate.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
  await page.waitForTimeout(500);

  const zoomChip = page.getByTestId('timeline-zoom-chip');
  await expect(zoomChip).toBeVisible();
  const zoomBox = await zoomChip.boundingBox();
  const band = await page.getByTestId('action-band').boundingBox();
  expect(band, 'action band present').not.toBeNull();

  expect(
    zoomBox.y + zoomBox.height <= band.y + 0.5,
    `zoom chip (bottom ${zoomBox.y + zoomBox.height}) is clipped by the action band (top ${band.y})`,
  ).toBe(true);

  const hit = await zoomChip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === el || el.contains(top));
  });
  expect(hit, 'elementFromPoint at the zoom chip centre is the chip, not the action band').toBe(true);
});
