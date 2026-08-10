import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6720 — REAL BROWSER (chromium) proof that the currently-SELECTED Overlay text
 * element can be DRAGGED on the live video preview to reposition `spec.position`
 * (the same fractional anchor the align/position presets write, and the same
 * field text_render.py burns in — so preview == export by construction).
 *
 * Verifies, against the REAL <TextOverlayPreview> + REAL useTextOverlays hook via
 * the dev-only /textpreviewdiag.html harness:
 *  - the FIRST gesture is not dropped (T5380 landmine: a useEffect-gated listener
 *    races the first pointermove; this drags the very first press and asserts it
 *    moved);
 *  - the drag is CLAMPED so the rendered box stays on-frame, verified for a SHORT
 *    and a LONG string (a wider box must stop sooner — the differential a fixed
 *    maxWidth assumption would get wrong);
 *  - EXACTLY ONE surgical persist fires per completed drag (commit=true), never
 *    mid-drag, and a click-in-place persists nothing.
 *
 * jsdom gives false confidence for pointer/layout fixes (TextOverlayPreview.test
 * covers the pure clamp math only); this is the required real-browser proof.
 *
 * Run: cd src/frontend && npx playwright test e2e/T6720-text-spatial-drag.qa.spec.js
 */

const HARNESS = '/textpreviewdiag.html';
const STATUS = '[data-testid="status"]';
const FRAME = '[data-testid^="text-drag-frame-"]';

async function readStatus(page) {
  const text = await page.locator(STATUS).textContent();
  const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  return {
    // Allow a leading '-' -- a negative anchor is exactly the BLOCKING bug this
    // spec guards; a sign-blind class would parse "y=-0.006" as 0.006 and false-pass.
    x: num(/x=(-?[\d.]+)/),
    y: num(/y=(-?[\d.]+)/),
    textlen: num(/textlen=(\d+)/),
    commits: num(/commits=(\d+)/),
    selected: /selected=yes/.test(text),
  };
}

async function frameCenter(page) {
  const b = await page.locator(FRAME).boundingBox();
  if (!b) throw new Error('drag frame not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

async function containerBox(page) {
  const b = await page.locator('.video-container').boundingBox();
  if (!b) throw new Error('.video-container not visible');
  return b;
}

/**
 * The RENDERED TEXT box (the <span> inside the preview element) — this is what
 * the clamp keeps on-frame. The grab FRAME is a padded (GRAB_PAD) affordance
 * that intentionally extends a few px past the ink, so on-frame assertions must
 * measure the text, not the frame.
 */
async function textBox(page) {
  const b = await page.locator('[data-testid^="text-preview-element-"] span').first().boundingBox();
  if (!b) throw new Error('text span not visible');
  return b;
}

/** Real MOUSE drag from the grab-frame centre to (targetX,targetY), release. */
async function dragFrameTo(page, targetX, targetY) {
  const c = await frameCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

async function waitForFrame(page) {
  await expect(page.locator(FRAME)).toBeVisible();
  await expect.poll(async () => (await readStatus(page)).selected).toBe(true);
}

test.describe('T6720 spatial drag — reposition selected Overlay text (fine / mouse)', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textpreviewdiag.html harness page, which does not exist in a production BUILD');

  test('the FIRST gesture moves the block and persists EXACTLY once (T5380: first drag not dropped)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForFrame(page);
    const before = await readStatus(page);
    expect(before.commits, 'no writes before any drag').toBe(0);
    expect(before.x).toBeCloseTo(0.5, 2);

    const cb = await containerBox(page);
    // Drag ~20% of frame width to the right and ~15% down — well inside bounds.
    const c = await frameCenter(page);
    await dragFrameTo(page, c.x + cb.width * 0.2, c.y + cb.height * 0.15);

    const after = await readStatus(page);
    expect(after.x, 'x moved right on the very first gesture').toBeGreaterThan(before.x + 0.1);
    expect(after.y, 'y moved down on the very first gesture').toBeGreaterThan(before.y + 0.08);
    expect(after.commits, 'EXACTLY one persist for one completed drag').toBe(1);
    await saveEvidence(page, 'T6720-criterion1-first-gesture-moves-and-persists-once');
  });

  test('a click-in-place selects without moving or persisting', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForFrame(page);
    const before = await readStatus(page);

    const c = await frameCenter(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up(); // no movement -> a tap
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.x, 'position unchanged by a tap').toBeCloseTo(before.x, 3);
    expect(after.y, 'position unchanged by a tap').toBeCloseTo(before.y, 3);
    expect(after.commits, 'a tap writes nothing').toBe(0);
  });

  test('the drag is clamped so the box stays on-frame — SHORT vs LONG string differ (task: measure live box)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForFrame(page);
    const cb = await containerBox(page);
    // A target far past the bottom-right corner so the raw pointer fraction would
    // push the text off-frame — the clamp must pull it back on.
    const farX = cb.x + cb.width + 300;
    const farY = cb.y + cb.height + 300;

    // SHORT string.
    await page.locator('[data-testid="set-short"]').click();
    await page.locator('[data-testid="reset-pos"]').click();
    await page.waitForTimeout(40);
    await dragFrameTo(page, farX, farY);
    const shortAfter = await readStatus(page);
    expect(shortAfter.x, 'short: x clamped strictly inside the frame').toBeLessThan(1);
    expect(shortAfter.x, 'short: not pinned to 0 either').toBeGreaterThan(0.5);
    expect(shortAfter.y, 'short: y clamped strictly inside the frame').toBeLessThan(1);
    // The clamped RENDERED TEXT box must stay on-frame (span right <= frame right).
    const shortText = await textBox(page);
    expect(shortText.x + shortText.width, 'short text right edge on-frame').toBeLessThanOrEqual(cb.x + cb.width + 2);
    await saveEvidence(page, 'T6720-criterion4-clamp-short-string');

    // LONG string — a wider box must clamp to a SMALLER max x (stops sooner).
    await page.locator('[data-testid="set-long"]').click();
    await page.locator('[data-testid="reset-pos"]').click();
    await page.waitForTimeout(80); // let the wider span settle + re-measure
    await dragFrameTo(page, farX, farY);
    const longAfter = await readStatus(page);
    expect(longAfter.x, 'long: x clamped strictly inside the frame').toBeLessThan(1);
    const longText = await textBox(page);
    expect(longText.x + longText.width, 'long text right edge on-frame').toBeLessThanOrEqual(cb.x + cb.width + 2);

    expect(longAfter.x, 'a WIDER (long) string clamps to a smaller max x than a short one')
      .toBeLessThan(shortAfter.x);
    await saveEvidence(page, 'T6720-criterion4-clamp-long-string');
  });

  test('dragging the block UP-LEFT past the origin clamps to the top-left corner', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForFrame(page);
    await page.locator('[data-testid="set-short"]').click();
    await page.locator('[data-testid="reset-pos"]').click();
    await page.waitForTimeout(40);
    const cb = await containerBox(page);
    await dragFrameTo(page, cb.x - 300, cb.y - 300);

    const after = await readStatus(page);
    expect(after.x, 'x actually moved left toward the corner').toBeLessThan(0.5);
    expect(after.y, 'y actually moved up toward the corner').toBeLessThan(0.5);
    // BLOCKING-fix guard: the persisted anchor must never leave [0,1] (schemas.py
    // Position ge=0/le=1 -> an out-of-range value 400s on update_text_spec). The
    // sign-aware regex above would surface a negative here.
    expect(after.x, 'x never negative (schema 0..1)').toBeGreaterThanOrEqual(0);
    expect(after.y, 'y never negative (schema 0..1)').toBeGreaterThanOrEqual(0);
    const text = await textBox(page);
    expect(text.x, 'text left edge clamped on-frame').toBeGreaterThanOrEqual(cb.x - 2);
    expect(text.y, 'text top edge clamped on-frame').toBeGreaterThanOrEqual(cb.y - 2);
    expect(after.commits, 'one persist for the clamped drag').toBe(1);
    await saveEvidence(page, 'T6720-criterion4-clamp-top-left-corner');
  });
});
