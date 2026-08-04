import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5225 — REAL BROWSER (chromium) proof that the Overlay text layer's begin/end
 * range levers are draggable (mouse + touch), SNAP to clip boundaries within
 * threshold, free-park otherwise, and that add/delete/toggle work — driven
 * through a dev-only harness (/textdiag.html) that mounts the REAL TextLayer +
 * the REAL useTextOverlays hook. Mirrors T5644's harness pattern exactly
 * (regiondiag.html / RegionLayer) for the analogous text-range levers.
 *
 * jsdom (TextLayer.test.jsx) already covers the pointer-event WIRING in
 * isolation with a mocked getBoundingClientRect; this spec is the required
 * real-browser proof for the DRAG ITSELF (T5380: jsdom gives false confidence
 * for pointer/touch fixes) plus the snap-vs-free-park behavior end-to-end
 * through the real hook's clamp logic.
 *
 * Run: cd src/frontend && npx playwright test e2e/T5225-text-lever-drag.qa.spec.js
 */

const HARNESS = '/textdiag.html';
const STATUS = '[data-testid="status"]';
const START_LEVER = '[data-testid="text-lever-start-0"]';
const END_LEVER = '[data-testid="text-lever-end-0"]';

async function centerOf(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

/** Parse "count=1 start=2.000 end=4.000 enabled=true" from the status readout. */
async function readStatus(page) {
  const text = await page.locator(STATUS).textContent();
  const m = text.match(/count=(\d+)\s+start=([\d.]+)\s+end=([\d.]+)\s+enabled=(\w+)/);
  if (!m) return { count: text.startsWith('count=') ? parseInt(text.match(/count=(\d+)/)[1], 10) : 0, start: null, end: null, enabled: null };
  return { count: parseInt(m[1], 10), start: parseFloat(m[2]), end: parseFloat(m[3]), enabled: m[4] === 'true' };
}

/** Real MOUSE drag by (dx,dy) from a locator's center. */
async function mouseDrag(page, locator, dx, dy) {
  const c = await centerOf(locator);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

/** Real TOUCH drag by (dx,dy) — CDP touch events => chromium pointerType:'touch'. */
async function touchDrag(page, locator, dx, dy) {
  const c = await centerOf(locator);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: c.x, y: c.y }],
  });
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: c.x + (dx * i) / steps, y: c.y + (dy * i) / steps }],
    });
    await page.waitForTimeout(8);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
}

async function waitForBlock(page) {
  await expect(page.locator(START_LEVER)).toBeVisible();
  await expect(page.locator(END_LEVER)).toBeVisible();
  // Block seeded at [2, 4].
  await expect.poll(async () => (await readStatus(page)).start).toBeCloseTo(2, 1);
}

test.describe('T5225 text levers — coarse (touch)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  // /textdiag.html is a Vite-dev-only harness page: not an input to the production
  // build, so on a deployed target this RELATIVE path resolves against the Pages
  // origin and the SPA catch-all serves index.html instead — the harness never mounts.
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('a REAL touch drag moves the START lever right (block shrinks from left)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    await touchDrag(page, page.locator(START_LEVER), 90, 0); // drag right, away from the 5.0s boundary

    const after = await readStatus(page);
    expect(after.start, 'touch drag moved the start boundary right').toBeGreaterThan(before.start + 0.3);
    expect(after.end, 'end boundary untouched').toBeCloseTo(before.end, 1);
  });

  test('a REAL touch drag moves the END lever right (block grows)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    await touchDrag(page, page.locator(END_LEVER), 250, 0); // drag well past the 5.0s clip boundary

    const after = await readStatus(page);
    expect(after.end, 'touch drag moved the end boundary right').toBeGreaterThan(before.end + 0.5);
  });

  test('lever hit-target is >=44px on coarse pointers', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const start = await page.locator(START_LEVER).boundingBox();
    const end = await page.locator(END_LEVER).boundingBox();
    expect(start.width, 'start lever width').toBeGreaterThanOrEqual(44);
    expect(end.width, 'end lever width').toBeGreaterThanOrEqual(44);
  });
});

// Pixel targets are derived from the track's REAL bounding box, never assumed.
// The track is NOT flush with the viewport (it renders at x~40), so page-absolute
// constants land ~40px off target. That is what previously made the snap test drag
// to 40px away from the boundary -- outside SNAP_PX -- so it never snapped and the
// component was blamed for a defect in the test's arithmetic.
const EDGE_PADDING = 20;
const REEL_DURATION = 10;

async function timeToPageX(page, t) {
  const r = await page.locator('.text-track').boundingBox();
  const usable = r.width - EDGE_PADDING * 2;
  return r.x + EDGE_PADDING + (t / REEL_DURATION) * usable;
}

test.describe('T5225 text levers — fine (mouse) — clip-boundary SNAPPING', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('dragging the END lever near the clip boundary (5.0s) SNAPS onto it', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);

    // The clip boundary sits at 5.0s. Drag the end lever to 5px past that
    // boundary's true pixel position -- inside SNAP_PX=10, so it must snap.
    const end = page.locator(END_LEVER);
    const box = await end.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const boundaryX = await timeToPageX(page, 5.0);
    await page.mouse.move(boundaryX + 5, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.end, 'end snapped exactly onto the 5.0s clip boundary').toBeCloseTo(5.0, 1);
  });

  test('dragging the END lever FAR from the clip boundary free-parks (no snap)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);

    const end = page.locator(END_LEVER);
    const box = await end.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Drag to 7.0s -- far from both the 5.0s boundary and the 10s reel end.
    const parkX = await timeToPageX(page, 7.0);
    await page.mouse.move(parkX, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.end, 'free-parked away from the boundary').not.toBeCloseTo(5.0, 1);
    // Free-parked at the raw dragged time, not pulled to a boundary.
    expect(after.end).toBeCloseTo(7.0, 1);
  });

  test('a real mouse drag still moves the START lever', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    await mouseDrag(page, page.locator(START_LEVER), 90, 0);

    const after = await readStatus(page);
    expect(after.start, 'mouse drag moved the start boundary right').toBeGreaterThan(before.start + 0.3);
  });
});

test.describe('T5225 text blocks — add / toggle / delete', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('clicking empty track adds a second text block', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);

    // Click a point on the track well away from the seeded [2,4] block and its levers.
    const track = page.locator('.text-track');
    const box = await track.boundingBox();
    await track.click({ position: { x: box.width * 0.7, y: box.height / 2 } });

    await expect.poll(async () => (await readStatus(page)).count).toBe(2);
  });

  test('toggling a block flips enabled without deleting it', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);
    expect(before.enabled).toBe(true);

    await page.getByTitle('Hide text (keep block)').click();

    const after = await readStatus(page);
    expect(after.enabled).toBe(false);
    expect(after.count).toBe(1); // still present, just muted
  });

  test('deleting a block removes it', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);

    await page.getByTitle('Delete text block').click();

    await expect.poll(async () => (await readStatus(page)).count).toBe(0);
  });
});

test.describe('T5225 text levers — evidence artifacts', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('capture before/after drag + snap screenshots for each acceptance criterion', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    await saveEvidence(page, 'T5225-c1-text-block-and-levers-visible');

    await touchDrag(page, page.locator(START_LEVER), 90, 0);
    await saveEvidence(page, 'T5225-c1-after-touch-drag-start');

    await page.goto(HARNESS);
    await waitForBlock(page);
    await page.getByTitle('Hide text (keep block)').click();
    await saveEvidence(page, 'T5225-c1-block-muted-not-deleted');
  });
});
