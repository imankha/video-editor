import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5644 — REAL BROWSER (chromium) proof that the overlay timeline region begin/end
 * trim levers are draggable with a fingertip on mobile, driven through a dev-only
 * harness (/regiondiag.html) that mounts the REAL RegionLayer + the REAL
 * useHighlightRegions hook.
 *
 * The bug: the levers used `onMouseDown` + document `mousemove`, which on touch only
 * synthesize AFTER touchend (never during a drag) — so the lever never moved on a
 * phone. jsdom can't catch this (a synthetic mouse drag "works" there); this spec is
 * the authoritative proof, per memory `real_browser_for_pointer_fixes`.
 *
 * Coverage:
 *   - coarse (touch): a REAL touch drag (CDP Input.dispatchTouchEvent -> chromium
 *     emits pointerType:'touch' pointer events) moves the start/end boundary. This
 *     is the exact failure mode the fix targets.
 *   - fine (mouse): the same drag via a real mouse still works (no desktop regression).
 *   - coarse: the lever hit-target measures >=44px (comfortable fingertip target).
 *
 * Run: cd src/frontend && npx playwright test e2e/T5644-region-lever-touch.qa.spec.js
 */

const HARNESS = 'http://localhost:5173/regiondiag.html';
const STATUS = '[data-testid="status"]';
const START_LEVER = '[data-testid="region-lever-start-0"]';
const END_LEVER = '[data-testid="region-lever-end-0"]';

async function centerOf(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}

/** Parse "start=3.000 end=5.000" from the status readout. */
async function readRegion(page) {
  const text = await page.locator(STATUS).textContent();
  const m = text.match(/start=([\d.]+)\s+end=([\d.]+)/);
  if (!m) throw new Error(`status not ready: "${text}"`);
  return { start: parseFloat(m[1]), end: parseFloat(m[2]) };
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

async function waitForRegion(page) {
  await expect(page.locator(START_LEVER)).toBeVisible();
  await expect(page.locator(END_LEVER)).toBeVisible();
  // Region seeded at [3, 5].
  await expect.poll(async () => (await readRegion(page)).start).toBeCloseTo(3, 1);
}

test.describe('T5644 region levers — coarse (touch)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('a REAL touch drag moves the START boundary right (region shrinks from left)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    const before = await readRegion(page);

    await touchDrag(page, page.locator(START_LEVER), 120, 0); // drag right

    const after = await readRegion(page);
    expect(after.start, 'touch drag moved the start boundary right').toBeGreaterThan(before.start + 0.5);
    expect(after.end, 'end boundary untouched').toBeCloseTo(before.end, 1);
  });

  test('a REAL touch drag moves the END boundary left (region shrinks from right)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    const before = await readRegion(page);

    await touchDrag(page, page.locator(END_LEVER), -120, 0); // drag left

    const after = await readRegion(page);
    expect(after.end, 'touch drag moved the end boundary left').toBeLessThan(before.end - 0.5);
    expect(after.start, 'start boundary untouched').toBeCloseTo(before.start, 1);
  });

  test('lever hit-target is >=44px on coarse pointers', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    const start = await page.locator(START_LEVER).boundingBox();
    const end = await page.locator(END_LEVER).boundingBox();
    expect(start.width, 'start lever width').toBeGreaterThanOrEqual(44);
    expect(end.width, 'end lever width').toBeGreaterThanOrEqual(44);
  });
});

test.describe('T5644 region levers — evidence artifacts (coarse mobile)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('capture before/after touch-drag screenshots for each acceptance criterion', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    // Criterion: begin/end levers present & draggable on a coarse (touch) device.
    await saveEvidence(page, 'T5644-c1-levers-visible-coarse');

    // START lever: drag right on a fresh [3,5] region.
    const before = await readRegion(page);
    await touchDrag(page, page.locator(START_LEVER), 120, 0);
    await saveEvidence(page, 'T5644-c1-after-touch-drag-start');
    expect((await readRegion(page)).start).toBeGreaterThan(before.start + 0.5);

    // Reset to a fresh region so the END drag isn't limited by the min-duration
    // clamp against the already-moved start.
    await page.goto(HARNESS);
    await waitForRegion(page);
    const mid = await readRegion(page);
    await touchDrag(page, page.locator(END_LEVER), -120, 0);
    await saveEvidence(page, 'T5644-c1-after-touch-drag-end');
    expect((await readRegion(page)).end).toBeLessThan(mid.end - 0.5);
  });
});

test.describe('T5644 region levers — fine (mouse) — no desktop regression', () => {
  test('a real mouse drag still moves the START boundary right', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    const before = await readRegion(page);

    await mouseDrag(page, page.locator(START_LEVER), 120, 0);

    const after = await readRegion(page);
    expect(after.start, 'mouse drag moved the start boundary right').toBeGreaterThan(before.start + 0.5);
  });

  test('a real mouse drag still moves the END boundary left', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForRegion(page);
    const before = await readRegion(page);

    await mouseDrag(page, page.locator(END_LEVER), -120, 0);

    const after = await readRegion(page);
    expect(after.end, 'mouse drag moved the end boundary left').toBeLessThan(before.end - 0.5);
  });
});
