import { test, expect } from '@playwright/test';

/**
 * T5380b — REAL BROWSER (chromium) regression proof for the CropOverlay first-drag
 * drop, driven through a minimal dev-only harness (/cropdiag.html) that mounts the
 * REAL VideoPlayer + CropOverlay + useCrop keyframe parent.
 *
 * ROOT CAUSE (found here, not where T5380 first looked): while the video is still
 * buffering, VideoPlayer renders the detailed <VideoLoadingOverlay> — an `absolute
 * inset-0 z-40` element that (unlike its simple-mode sibling) was MISSING
 * `pointer-events-none`. The crop reticule renders off metadata (before the video
 * finishes buffering), so during that window the z-40 overlay sits on top of the crop
 * box and swallows the user's FIRST mousedown. The box looks draggable but the gesture
 * never reaches CropOverlay, so the first crop-adjust after opening a draft is silently
 * dropped; once buffering ends the overlay unmounts and every later drag works. This is
 * why the original "listener race" fix (refs in CropOverlay) couldn't help — the events
 * never reached CropOverlay at all — and why no isolated component harness reproduced it
 * (no real buffering state). Fix: `pointer-events-none` on the detailed overlay so the
 * dim/spinner still paints but input passes through to the crop reticule.
 *
 * The harness reads params from window.__CROPDIAG (captured by an inline script in
 * cropdiag.html before an imported app module pushState-redirects to /framing).
 */

const HARNESS = 'http://localhost:5173/cropdiag.html';
const BOX = '.cursor-move';

async function boxBox(page) {
  const b = await page.locator(BOX).first().boundingBox();
  if (!b) throw new Error('crop box not found / not visible');
  return b;
}

/** One real-browser drag by (dx, dy) from the box center; returns screen delta moved. */
async function dragBox(page, dx, dy) {
  const before = await boxBox(page);
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(60); // let React flush onCropComplete + re-render
  const after = await boxBox(page);
  return { movedX: Math.round(after.x - before.x), movedY: Math.round(after.y - before.y) };
}

test.describe('T5380b crop overlay first-drag (real chromium)', () => {
  // THE regression: video still buffering (VideoLoadingOverlay up) is the exact staging
  // condition. Pre-fix, the z-40 overlay eats the first mousedown -> first drag = 0,0.
  test('first drag moves the crop box even while the video-loading overlay is up', async ({ page }) => {
    await page.goto(`${HARNESS}#loading`);
    await expect(page.locator(BOX).first()).toBeVisible();

    // Confirm we are actually testing the buggy condition: the loading overlay is present.
    await expect(page.locator('.z-40')).toBeVisible();

    // FIRST gesture — no warm-up prime. This is the one the bug dropped.
    const first = await dragBox(page, -40, -30);
    const second = await dragBox(page, 40, 30);
    const third = await dragBox(page, -25, 20);
    console.log('T5380b(loading) drags:', JSON.stringify({ first, second, third }));

    // The crux: the FIRST drag must actually move the box (was 0,0 before the fix).
    expect(Math.abs(first.movedX), 'first drag moved X').toBeGreaterThan(20);
    expect(Math.abs(first.movedY), 'first drag moved Y').toBeGreaterThan(10);
    expect(first.movedX).toBeLessThan(0);
    expect(first.movedY).toBeLessThan(0);
    // No regression on later drags.
    expect(second.movedX).toBeGreaterThan(20);
    expect(third.movedX).toBeLessThan(-10);
  });

  // Sanity: with no loading overlay, the CropOverlay component itself has always been
  // fine on the first gesture (proves the component was never the defect).
  test('first drag moves the crop box with no loading overlay', async ({ page }) => {
    await page.goto(`${HARNESS}`);
    await expect(page.locator(BOX).first()).toBeVisible();
    const first = await dragBox(page, -40, -30);
    console.log('T5380b(no-loading) first drag:', JSON.stringify(first));
    expect(Math.abs(first.movedX)).toBeGreaterThan(20);
    expect(Math.abs(first.movedY)).toBeGreaterThan(10);
  });
});
