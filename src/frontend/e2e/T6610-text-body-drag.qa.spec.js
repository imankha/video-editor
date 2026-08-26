import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6610 — REAL BROWSER (chromium) proof of the text-element body-drag facets a
 * REAL-screen spec cannot exercise. T7770 REDUCED this file: its core
 * body-move / duration-preserved / one-persist / snap / clamp / click-select /
 * lever tests were a /textdiag.html-harness DUPLICATE of what now runs on the
 * REAL /overlay screen — T6630-round7-evidence's R7-8 (body drag moves the
 * region, duration preserved, EXACTLY ONE move_text_edge persist, default +
 * 500% zoom) and T5225's lever snap/free-park — so those were deleted here.
 *
 * What survives is ONLY the three micro-facets no real-screen spec covers and
 * that need real chromium input the harness gives deterministically:
 *   1. a REAL touch (coarse-pointer) body drag moves the block, duration
 *      preserved, exactly one persist;
 *   2. the delete control meets the 44px coarse-pointer hit floor;
 *   3. arrow-key nudge moves the block (keyboard a11y) and each keypress
 *      commits once.
 *
 * Drives the dev-only /textdiag.html harness (REAL TextLayer + REAL
 * useTextOverlays hook; exposes `commits=N` in the status readout). jsdom
 * (TextLayer.test.jsx) covers the pointer WIRING; this is the required
 * real-browser proof of touch/keyboard input (T5380: jsdom gives false
 * confidence for pointer/touch fixes).
 *
 * Run: cd src/frontend && npx playwright test e2e/T6610-text-body-drag.qa.spec.js
 */

const HARNESS = '/textdiag.html';
const STATUS = '[data-testid="status"]';
const BODY = '[data-testid="text-block-body-0"]';
const DELETE_BTN = '[title="Delete text block"]';

/** Parse the status readout into a struct. */
async function readStatus(page) {
  const text = await page.locator(STATUS).textContent();
  const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  return {
    count: num(/count=(\d+)/),
    start: num(/start=([\d.]+)/),
    end: num(/end=([\d.]+)/),
    enabled: /enabled=true/.test(text),
    selected: /selected=yes/.test(text),
    commits: num(/commits=(\d+)/),
    duration: (() => { const s = num(/start=([\d.]+)/), e = num(/end=([\d.]+)/); return s == null || e == null ? null : e - s; })(),
  };
}

async function bodyCenter(page) {
  const b = await page.locator(BODY).boundingBox();
  if (!b) throw new Error('block body not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function waitForBlock(page) {
  await expect(page.locator(BODY)).toBeVisible();
  await expect.poll(async () => (await readStatus(page)).start).toBeCloseTo(2, 1);
}

test.describe('T6610 body drag — coarse (touch) + 44px delete hit box', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('a REAL touch drag on the body moves the block, duration preserved, ONE persist', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    const c = await bodyCenter(page);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    const steps = 10, dx = 120;
    for (let i = 1; i <= steps; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + (dx * i) / steps, y: c.y }] });
      await page.waitForTimeout(8);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.start, 'touch body drag moved the block').toBeGreaterThan(before.start + 0.3);
    expect(after.duration, 'duration preserved').toBeCloseTo(before.duration, 1);
    expect(after.commits, 'one persist per touch drag').toBe(before.commits + 1);
  });

  test('the delete control meets the 44px coarse-pointer hit floor', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const box = await page.locator(DELETE_BTN).boundingBox();
    expect(box.width, 'delete hit box width').toBeGreaterThanOrEqual(44);
    expect(box.height, 'delete hit box height').toBeGreaterThanOrEqual(44);
  });
});

test.describe('T6610 — keyboard equivalent', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('arrow keys nudge the block (accessibility) and each commits', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    await page.locator(BODY).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);

    const after = await readStatus(page);
    expect(after.start, 'ArrowRight nudged the block forward').toBeGreaterThan(before.start);
    expect(after.duration, 'nudge preserves duration').toBeCloseTo(before.duration, 2);
    expect(after.commits, 'each keypress commits once').toBe(before.commits + 2);
  });
});
