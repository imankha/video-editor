/**
 * T15400 - per-criterion acceptance checks (group checks protocol).
 *
 * The fixed bottom ActionBand (Sharpen my highlight / Trim and slow motion / Preview,
 * ~226-230px tall) used to cover the Frame/Spotlight video, crop box, timeline and the
 * "Switch to landscape?" dialog at short-ish viewports. Fixed by:
 *  - App.jsx's Framing/Overlay scroll container now reserves `--cta-bar-h` (the band's
 *    real measured height) as scroll padding instead of a guessed constant, so content
 *    below the stage (the timeline/keyframe row) can be scrolled above the band.
 *  - FocusModeView/OverlayModeView's SHORT_DESKTOP floor override now applies at every
 *    `min-width:1024px` height (was gated to `max-height:850px`, missing 1440x900).
 *  - FrameShapeChoice's "Switch to landscape?" modal is now portaled to document.body so
 *    an ancestor's `backdrop-filter` (which establishes a containing block for
 *    `position:fixed`) can no longer clip its backdrop short of the real viewport.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15400.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

const VIEWPORTS = [
  { label: '1366x660', width: 1366, height: 660 },
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x664', width: 390, height: 664 },
];

async function listProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

/** Scroll whatever ancestor actually scrolls the editor content to its bottom. */
async function scrollEditorToBottom(page) {
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('.overflow-auto'));
    const scroller = candidates.find((el) => el.scrollHeight > el.clientHeight + 1) || candidates[0];
    scroller?.scrollTo(0, scroller.scrollHeight);
  });
  await page.waitForTimeout(150);
}

function rectBelow(rectA, rectB) {
  // true when rectA's bottom edge is at or above rectB's top edge (no vertical overlap).
  return rectA.y + rectA.height <= rectB.y + 0.5;
}

async function openFrameProject(page) {
  const projects = await listProjects(page);
  const candidate = projects.find((p) => (p.clip_count || 0) > 0);
  test.skip(!candidate, '[T15400] no project with a clip in this account');
  await page.goto(`/focus/p/${candidate.id}`);
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
  return candidate;
}

async function openOverlayProject(page) {
  const projects = await listProjects(page);
  const candidate = projects.find((p) => p.has_working_video);
  test.skip(!candidate, '[T15400] no project with a working (framed) video in this account');
  await page.goto(`/overlay/p/${candidate.id}`);
  await page.getByTestId('overlay-video-stage').waitFor({ timeout: 90000 });
  return candidate;
}

for (const vp of VIEWPORTS) {
  test.describe(`T15400 checks @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`T15400:C1 - Frame video and crop box fully visible and draggable above the action bar @ ${vp.label}`, async ({ context, page }) => {
      await loginForCheck(context);
      await openFrameProject(page);
      // The T15400 scroll-fit effect (ResizeObserver-driven) can still be settling the
      // stage into position right after the crop handle first appears -- measure once
      // the layout has stopped moving, or `before`/`stage` below read a transient position.
      await page.waitForTimeout(400);

      const band = await page.getByTestId('action-band').boundingBox();
      expect(band, 'action band present').not.toBeNull();

      const stage = await page.getByTestId('focus-video-stage').boundingBox();
      expect(stage, 'focus video stage present').not.toBeNull();
      expect(rectBelow(stage, band), `video stage (bottom ${stage.y + stage.height}) clipped by the action band (top ${band.y})`).toBe(true);

      const cropBox = page.locator('[data-testid="focus-video-stage"] .cursor-move').first();
      await expect(cropBox).toBeVisible();
      const before = await cropBox.boundingBox();
      expect(rectBelow(before, band), 'crop box clipped by the action band').toBe(true);

      // Draggable: a real pointer drag actually moves the box. Drag TOWARD the stage
      // centre (not a fixed +50,+40) so the box always has room to move regardless of
      // where this account's real keyframe placed it -- a box already pinned against
      // one edge (common for a wide crop on a narrow video) can't move further that way,
      // which isn't a bug, just an unlucky fixed delta (T15400).
      const stageCx = stage.x + stage.width / 2;
      const stageCy = stage.y + stage.height / 2;
      const boxCx = before.x + before.width / 2;
      const boxCy = before.y + before.height / 2;
      const dx = Math.sign(stageCx - boxCx) * 40 || 40;
      const dy = Math.sign(stageCy - boxCy) * 30 || 30;
      await page.mouse.move(boxCx, boxCy);
      await page.mouse.down();
      await page.mouse.move(boxCx + dx, boxCy + dy, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(150); // let React flush onCropComplete + re-render (T5380b pattern)
      const after = await cropBox.boundingBox();
      expect(after.x !== before.x || after.y !== before.y, 'dragging the crop box moved it').toBe(true);
    });
  });
}

test.describe('T15400 checks: Switch to landscape dialog reachability on iPhone 14', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 664 } });

  test('T15400:C2 - every "Switch to landscape?" dialog button is tappable (elementFromPoint hits the button)', async ({ context, page }) => {
    await loginForCheck(context);
    const projects = await listProjects(page);
    const candidate = projects.find((p) => p.has_crop_keyframes);
    test.skip(!candidate, '[T15400] no project with crop keyframes placed (needed for the shape chip)');

    await page.goto(`/focus/p/${candidate.id}`);
    await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

    const chip = page.getByTestId('focus-shape-chip');
    await expect(chip).toBeVisible();
    await chip.evaluate((el) => el.click());

    const dialog = page.getByTestId('focus-shape-switch-confirm');
    await expect(dialog).toBeVisible();

    for (const testId of ['focus-shape-switch-confirm-button', 'focus-shape-switch-keep']) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeVisible();
      const hit = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === el || el.contains(top));
      });
      expect(hit, `elementFromPoint at ${testId}'s centre is the button, not the action band`).toBe(true);
    }
  });
});

for (const vp of VIEWPORTS) {
  test.describe(`T15400 checks (Overlay) @ ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`T15400:C3 - Spotlight/Overlay video and timeline not clipped by the action bar @ ${vp.label}`, async ({ context, page }) => {
      await loginForCheck(context);
      await openOverlayProject(page);

      const band = await page.getByTestId('action-band').boundingBox();
      expect(band, 'action band present').not.toBeNull();

      const stage = await page.getByTestId('overlay-video-stage').boundingBox();
      expect(stage, 'overlay video stage present').not.toBeNull();
      expect(rectBelow(stage, band), `overlay video stage (bottom ${stage.y + stage.height}) clipped by the action band (top ${band.y})`).toBe(true);

      await scrollEditorToBottom(page);
      const timeline = page.getByTestId('timeline-playhead').first();
      await expect(timeline).toBeVisible();
      const timelineBox = await timeline.boundingBox();
      const bandAfterScroll = await page.getByTestId('action-band').boundingBox();
      expect(
        rectBelow(timelineBox, bandAfterScroll),
        `timeline (bottom ${timelineBox.y + timelineBox.height}) clipped by the action band (top ${bandAfterScroll.y}) even after scrolling`,
      ).toBe(true);
    });
  });
}
