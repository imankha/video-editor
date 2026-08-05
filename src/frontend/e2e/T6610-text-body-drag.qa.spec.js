import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6610 — REAL BROWSER (chromium) proof that an Overlay text element can be
 * DRAGGED BY ITS BODY to a new time with its DURATION PRESERVED (the task's one
 * genuine gap), snapping the leading edge to a clip boundary, clamped inside the
 * reel, and persisting EXACTLY ONCE per completed drag (never mid-drag). Also
 * pins the resize-vs-move hit-test (a lever press still resizes; a body press
 * moves) and the click-in-place-selects-without-moving behaviour.
 *
 * Drives the SAME dev-only /textdiag.html harness T5225 used — it mounts the REAL
 * TextLayer + REAL useTextOverlays hook, and (T6610) exposes `commits=N` in the
 * status readout: the count of commit=true body-move calls, i.e. the single
 * surgical persist a real drag fires (OverlayScreen.wrappedMoveTextBody). That is
 * how "exactly one write per drag" is verified without a network tap.
 *
 * jsdom (TextLayer.test.jsx) covers the pointer WIRING; this is the required
 * real-browser proof of the drag ITSELF (T5380: jsdom gives false confidence for
 * pointer/touch fixes).
 *
 * Run: cd src/frontend && npx playwright test e2e/T6610-text-body-drag.qa.spec.js
 */

const HARNESS = '/textdiag.html';
const STATUS = '[data-testid="status"]';
const BODY = '[data-testid="text-block-body-0"]';
const START_LEVER = '[data-testid="text-lever-start-0"]';
const DELETE_BTN = '[title="Delete text block"]';

const EDGE_PADDING = 20;
const REEL_DURATION = 10;
const CLIP_BOUNDARY = 5.0; // the harness seeds one interior cut at 5.0s

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

async function trackBox(page) {
  const r = await page.locator('.text-track').boundingBox();
  if (!r) throw new Error('.text-track not visible');
  return r;
}
function pxToTime(r, x) { const usable = r.width - EDGE_PADDING * 2; return ((x - r.x - EDGE_PADDING) / usable) * REEL_DURATION; }
function timeToPx(r, t) { const usable = r.width - EDGE_PADDING * 2; return r.x + EDGE_PADDING + (t / REEL_DURATION) * usable; }

async function bodyCenter(page) {
  const b = await page.locator(BODY).boundingBox();
  if (!b) throw new Error('block body not visible');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function waitForBlock(page) {
  await expect(page.locator(BODY)).toBeVisible();
  await expect.poll(async () => (await readStatus(page)).start).toBeCloseTo(2, 1);
}

/** Real MOUSE body drag: press at the block-body centre, move to targetX, release. */
async function mouseDragBodyToX(page, targetX, y) {
  const c = await bodyCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(targetX, y ?? c.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

test.describe('T6610 body drag — move the whole element (fine / mouse)', () => {
  skipOnDeployedTarget(test, 'drives the dev-only /textdiag.html harness page, which does not exist in a production BUILD');

  test('dragging the body moves the block, preserves duration, and persists ONCE', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);
    expect(before.commits).toBe(0);

    const r = await trackBox(page);
    // Move the body ~1.5s to the right, landing in free space (not near the 5s cut).
    const c = await bodyCenter(page);
    const targetX = c.x + 1.5 * ((r.width - EDGE_PADDING * 2) / REEL_DURATION);
    await mouseDragBodyToX(page, targetX);

    const after = await readStatus(page);
    expect(after.start, 'block moved right').toBeGreaterThan(before.start + 0.5);
    expect(after.duration, 'duration preserved').toBeCloseTo(before.duration, 1);
    expect(after.commits, 'EXACTLY one persist for one completed drag').toBe(before.commits + 1);
  });

  test('the LEADING (start) edge snaps to the clip boundary at 5.0s', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    const r = await trackBox(page);
    const c = await bodyCenter(page);
    const pressTime = pxToTime(r, c.x);
    const grabOffset = pressTime - before.start;
    // Aim the pointer so the block START lands ~0.05s past 5.0 -> inside SNAP_PX.
    const targetX = timeToPx(r, 5.0 + 0.05 + grabOffset);

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(targetX, c.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.start, 'start snapped onto the 5.0s clip boundary').toBeCloseTo(CLIP_BOUNDARY, 1);
    expect(after.duration, 'duration preserved through the snap').toBeCloseTo(before.duration, 1);
  });

  test('the block cannot be dragged off the end of the reel (clamped, duration kept)', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    const r = await trackBox(page);
    // Drag far past the reel end.
    await mouseDragBodyToX(page, r.x + r.width + 400);

    const after = await readStatus(page);
    expect(after.end, 'end clamped to the reel duration').toBeCloseTo(REEL_DURATION, 1);
    expect(after.duration, 'duration preserved at the clamp').toBeCloseTo(before.duration, 1);
    expect(after.start, 'start pushed back to keep the block on-timeline').toBeCloseTo(REEL_DURATION - before.duration, 1);
  });

  test('a click-in-place SELECTS the block without moving it or persisting', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    await page.locator(BODY).click();
    await page.waitForTimeout(40);

    const after = await readStatus(page);
    expect(after.selected, 'block is now selected').toBe(true);
    expect(after.start, 'a click did not move the block').toBeCloseTo(before.start, 2);
    expect(after.commits, 'a click did not persist').toBe(before.commits);
  });

  test('a LEVER press still RESIZES (duration changes) — resize-vs-move hit-test', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    const before = await readStatus(page);

    // Drag the start lever right: the block shrinks from the left (duration drops),
    // and the body-move commit counter stays untouched (levers are their own path).
    const lever = page.locator(START_LEVER);
    const box = await lever.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.start, 'lever moved the start edge').toBeGreaterThan(before.start + 0.3);
    expect(after.duration, 'a lever RESIZES (duration changed)').toBeLessThan(before.duration - 0.2);
    expect(after.commits, 'lever is not the body-move path').toBe(before.commits);
  });
});

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

test.describe('T6610 — keyboard equivalent + evidence', () => {
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

  test('capture body-drag before/after evidence at desktop', async ({ page }) => {
    await page.goto(HARNESS);
    await waitForBlock(page);
    await saveEvidence(page, 'T6610-c1-desktop-before-body-drag');

    const r = await trackBox(page);
    const c = await bodyCenter(page);
    await mouseDragBodyToX(page, c.x + 1.2 * ((r.width - EDGE_PADDING * 2) / REEL_DURATION));
    await saveEvidence(page, 'T6610-c1-desktop-after-body-drag-duration-preserved');
  });

  // NOTE on 375px: the /textdiag.html harness hard-codes a 1000px host so lever
  // hit-tests + snap-pixel math are deterministic (see textdiag/main.jsx), so a
  // no-horizontal-overflow assertion here would measure the harness, not the
  // component. The change is VERTICAL-only (lane height h-14 -> h-28); the lane
  // itself is full-width (inset-x-0) in the real app and gains no horizontal
  // extent. We still capture 375px evidence that the block is present + the drag
  // works at a phone width; the app-level responsive layout is unchanged by this
  // task and covered by the existing overlay-screen responsiveness specs.
  test('375px: block visible and body-draggable at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(HARNESS);
    await waitForBlock(page);
    await saveEvidence(page, 'T6610-c1-375px-block-visible');

    const before = await readStatus(page);
    const c = await bodyCenter(page);
    await mouseDragBodyToX(page, c.x + 120);
    const after = await readStatus(page);
    expect(after.start, 'body drag works at 375px').toBeGreaterThan(before.start + 0.3);
    expect(after.duration, 'duration preserved at 375px').toBeCloseTo(before.duration, 1);
    await saveEvidence(page, 'T6610-c1-375px-after-body-drag');
  });
});
