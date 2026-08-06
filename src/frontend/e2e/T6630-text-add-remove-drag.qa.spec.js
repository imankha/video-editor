// T6630 — QA on the REAL Overlay screen with an EXISTING DB-loaded record.
//
// HARD RULES honoured here (see the task kickoff):
//  - Drives the real /overlay screen, NOT /textdiag.html or /textspecdiag.html,
//    and NEVER skipOnDeployedTarget. Two criteria shipped falsely green on
//    2026-08-05 by driving those harness pages; this spec refuses that path.
//  - Re-measures element geometry immediately before EVERY pointer interaction
//    and asserts document.elementFromPoint(x,y) is the intended element before
//    pressing (stale coords look exactly like a broken feature).
//  - The DEAD-ZONE test clicks LOW in the lane (below the h-10 track strip, in
//    the ~72px band that was inert before T6630) — a click on the top strip
//    would pass on the old broken code and prove nothing.
//  - Runs at 500% zoom AND default zoom. At 500% the lane is ~5x wider than the
//    viewport, so every click x is clamped into the scroll container's visible
//    range and confirmed via elementFromPoint before pressing.
//  - Counts persist POSTs: exactly ONE move_text_edge per completed body drag.
//
// Run against the running dev app:  E2E_BASE_URL=http://localhost:5173

import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { probeOverlayDrafts } from './helpers/overlayDraft';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

test.describe.configure({ mode: 'serial' });

const OVERLAY_ACTIONS_RE = /\/overlay\/actions$/;

// ---- shared page (loading a real draft is expensive; do it once) ----
let page;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();

  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.goto('/');
  const { loadable, dangling } = await probeOverlayDrafts(page);
  expect(loadable.length, `no loadable overlay draft (dangling=${JSON.stringify(dangling)})`).toBeGreaterThan(0);

  await page.evaluate((id) => {
    sessionStorage.setItem('pendingProjectId', String(id));
    sessionStorage.setItem('pendingProjectMode', 'overlay');
  }, loadable[0]);
  await page.goto('/overlay');
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 120000 });
  // The text lane renders once the overlay stage is hydrated.
  await page.locator('.text-track').first().waitFor({ timeout: 120000 });
  // The Add Text control appears once the overlay handlers are wired; wait for it
  // so no test races an un-hydrated screen.
  await page.getByRole('button', { name: /add text/i }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(500);
  await pauseVideo();

  await deleteAllBlocks();
});

test.afterAll(async () => {
  await page?.context()?.close();
});

// ---------------------------------------------------------------- helpers

async function pauseVideo() {
  await page.evaluate(() => {
    document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch { /* noop */ } });
  });
}

function blockCount() {
  return page.locator('[data-testid^="text-block-body-"]').count();
}

// Remove every text block via the KEYBOARD (focus + Delete) — programmatic focus
// needs no hit-testing, so overlapping/stacked blocks (all added at the same
// playhead x) can't intercept the gesture the way a pointer click would.
async function deleteAllBlocks() {
  for (let i = 0; i < 80; i++) {
    if ((await blockCount()) === 0) break;
    await page.getByTestId('text-block-body-0').focus();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(120);
  }
  expect(await blockCount(), 'clean slate reached').toBe(0);
}

// Clean slate + exactly one fresh block (added at the playhead via the Add Text
// button), so a test manipulating "the block" never fights an overlapping stack.
async function resetToSingleBlock() {
  await deleteAllBlocks();
  await page.getByRole('button', { name: /add text/i }).click();
  await page.waitForTimeout(300);
  expect(await blockCount()).toBe(1);
}

// Live viewport-space geometry of the text lane, the h-10 track strip inside it,
// and the timeline's horizontally-scrolling container. All in client (viewport)
// coordinates so they line up with document.elementFromPoint and page.mouse.
async function laneMetrics() {
  return page.evaluate(() => {
    const track = document.querySelector('.text-track');
    if (!track) return null;
    const lane = track.parentElement; // T6630: the full-height (h-28) click target
    const t = track.getBoundingClientRect();
    const l = lane.getBoundingClientRect();
    // Nearest horizontally-scrollable ancestor = the timeline scroll container.
    let sc = lane.parentElement;
    while (sc && sc.scrollWidth <= sc.clientWidth) sc = sc.parentElement;
    const s = sc ? sc.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    return {
      track: { left: t.left, right: t.right, top: t.top, bottom: t.bottom, width: t.width },
      lane: { left: l.left, right: l.right, top: l.top, bottom: l.bottom, width: l.width },
      scroll: { left: s.left, right: s.right },
      visLeft: Math.max(l.left, s.left, 0),
      visRight: Math.min(l.right, s.right, window.innerWidth),
    };
  });
}

async function elementInfoAt(x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    const body = el.closest('[data-testid^="text-block-body-"]');
    const lever = el.closest('.lever-handle');
    const button = el.closest('button');
    return {
      tag: el.tagName,
      testid: el.getAttribute('data-testid'),
      inBlockBody: !!body,
      inLever: !!lever,
      inButton: !!button,
      cls: (el.className && el.className.toString) ? el.className.toString().slice(0, 90) : '',
    };
  }, [x, y]);
}

// Find an x in the lane's VISIBLE lower band (below the h-10 track) where the
// topmost element is the empty lane itself — not a block, lever, or control.
// Returns { x, y } in viewport coords, or null if the band is fully occupied.
async function findEmptyLowerBandPoint() {
  const m = await laneMetrics();
  if (!m) return null;
  const y = Math.round(m.track.bottom + (m.lane.bottom - m.track.bottom) * 0.4); // ~40% into the lower band
  const from = Math.ceil(m.visLeft + 24);
  const to = Math.floor(m.visRight - 24);
  for (let x = from; x <= to; x += 12) {
    const info = await elementInfoAt(x, y);
    if (info && !info.inBlockBody && !info.inLever && !info.inButton) {
      return { x, y, info, metrics: m };
    }
  }
  return null;
}

async function selectLayerByIcon(iconClass) {
  await page.locator(`.${iconClass}`).first().click();
  await page.waitForTimeout(120);
}

async function currentZoomPercent() {
  // The TIMELINE zoom indicator (TimelineBase) is a `.text-blue-400` span inside
  // `.timeline-container`, rendered only above 100%. Do NOT match the ZoomControls
  // VIDEO-zoom widget (its concatenated text is "Zoom:100%", no space).
  const el = page.locator('.timeline-container span.text-blue-400').filter({ hasText: /Zoom:/ }).first();
  if ((await el.count()) === 0) return 100;
  const txt = await el.textContent();
  const m = txt && txt.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : 100;
}

// Timeline zoom is driven ONLY by a non-passive wheel listener on the scroll
// container, and only when the playhead layer is selected. Playwright's
// page.mouse.wheel does not reliably reach that listener, so dispatch a real
// WheelEvent on the container element directly (sensitivity 0.25 -> -1500 deltaY
// is +375%/step, so 2 steps clamp 100 -> 500).
async function wheelZoomStep(deltaY) {
  await page.evaluate((dy) => {
    const sc = document.querySelector('.timeline-scroll-container');
    if (sc) sc.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
  }, deltaY);
}

async function zoomTo500() {
  await selectLayerByIcon('lucide-film'); // wheel-zoom only fires when playhead layer is selected
  for (let i = 0; i < 12 && (await currentZoomPercent()) < 500; i++) {
    await wheelZoomStep(-1500);
    await page.waitForTimeout(80);
  }
  const z = await currentZoomPercent();
  expect(z, 'timeline should reach 500% zoom').toBe(500);
  await pauseVideo();
}

async function resetZoom() {
  await selectLayerByIcon('lucide-film');
  for (let i = 0; i < 30 && (await currentZoomPercent()) > 100; i++) {
    await wheelZoomStep(1500);
    await page.waitForTimeout(50);
  }
  expect(await currentZoomPercent()).toBe(100);
}

// Live box of a specific block body (viewport coords), scrolled into view.
async function blockBox(index) {
  const el = page.getByTestId(`text-block-body-${index}`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  return el.boundingBox();
}

// Perform a body drag from the block's current on-screen center by dx px, in
// small steps that clear BODY_DRAG_THRESHOLD_PX. Re-measures + asserts
// elementFromPoint is the block body immediately before pressing. Returns the
// count of move_text_edge POSTs observed during the gesture.
// Drag a block body and return GROUND-TRUTH state, not pixel-x (which is a lie at
// 500% zoom: a block wider than the viewport is clipped, and re-measuring after a
// scrollIntoView masks the move). The block body's aria-valuenow IS its startTime,
// and its rendered width IS its duration at fixed zoom — both read straight from
// the model. Returns { posts, startBefore, startAfter, widthBefore, widthAfter }.
async function dragBlockBody(index, magnitude) {
  const el = page.getByTestId(`text-block-body-${index}`);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  expect(box, `block ${index} must be visible to drag`).toBeTruthy();
  const m = await laneMetrics();
  // Grab the CENTRE OF THE VISIBLE PORTION so at 500% zoom (block partly
  // off-screen) the grab point is guaranteed both over the block and inside the
  // scroll container's visible range.
  const bx0 = Math.max(box.x, m.visLeft + 4);
  const bx1 = Math.min(box.x + box.width, m.visRight - 4);
  expect(bx1 - bx0, 'block must have a visible span to grab').toBeGreaterThan(8);
  const gx = Math.round((bx0 + bx1) / 2);
  const gy = Math.round(box.y + box.height / 2);

  // Assert the intended element is under the cursor immediately before pressing.
  const at = await elementInfoAt(gx, gy);
  expect(at?.inBlockBody, `grab point must be over block body (got ${JSON.stringify(at)})`).toBe(true);

  const roomRight = (m.visRight - 6) - gx;
  const roomLeft = gx - (m.visLeft + 6);
  const dx = roomRight >= magnitude ? magnitude : -Math.min(magnitude, roomLeft);
  expect(Math.abs(dx), 'must have room to drag well past the 4px click threshold').toBeGreaterThan(20);

  const startBefore = Number(await el.getAttribute('aria-valuenow'));
  const widthBefore = await el.evaluate((n) => n.getBoundingClientRect().width);

  let posts = 0;
  const onReq = (req) => {
    if (req.method() === 'POST' && OVERLAY_ACTIONS_RE.test(req.url())) {
      try {
        if (JSON.parse(req.postData() || '{}').action === 'move_text_edge') posts += 1;
      } catch { /* ignore */ }
    }
  };
  page.on('request', onReq);

  await page.mouse.move(gx, gy);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(gx + (dx * i) / steps, gy);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(400); // let the single commit POST settle
  page.off('request', onReq);

  const startAfter = Number(await el.getAttribute('aria-valuenow'));
  const widthAfter = await el.evaluate((n) => n.getBoundingClientRect().width);
  return { posts, startBefore, startAfter, widthBefore, widthAfter };
}

// ---------------------------------------------------------------- criteria

test('C1: explicit "Add Text" control adds a block (no lane discovery needed)', async () => {
  const before = await blockCount();
  const btn = page.getByRole('button', { name: /add text/i });
  await expect(btn, 'a visible Add Text control must exist').toBeVisible();
  await btn.click();
  await page.waitForTimeout(300);
  expect(await blockCount(), 'Add Text button adds exactly one block').toBe(before + 1);
  // It selects the new block -> Edit Text rail opens.
  await expect(page.getByRole('heading', { name: 'Edit Text' })).toBeVisible();
  await saveEvidence(page, 'C1-add-text-button');
});

test('C2 (default zoom): clicking LOW in the lane adds a block (dead-zone fixed)', async () => {
  await resetZoom().catch(() => {});
  const before = await blockCount();
  const pt = await findEmptyLowerBandPoint();
  expect(pt, 'must find an empty spot in the lower band (the previously-inert region)').toBeTruthy();
  // Prove we are BELOW the h-10 track strip — i.e. the region that was inert.
  expect(pt.y, 'click y must be below the 40px track strip').toBeGreaterThan(pt.metrics.track.bottom);
  // Confirm the topmost element under the cursor is the empty lane, then click.
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  expect(await blockCount(), 'a low-lane click adds a block').toBe(before + 1);
  await saveEvidence(page, 'C2-deadzone-default-zoom');
});

test('C2 (500% zoom): clicking LOW in the lane adds a block', async () => {
  await zoomTo500();
  const before = await blockCount();
  const pt = await findEmptyLowerBandPoint();
  expect(pt, 'must find an empty lower-band spot within the visible range at 500%').toBeTruthy();
  expect(pt.y).toBeGreaterThan(pt.metrics.track.bottom);
  // The x must be inside the scroll container's visible range (off-screen clicks hit nothing).
  expect(pt.x).toBeGreaterThanOrEqual(pt.metrics.visLeft);
  expect(pt.x).toBeLessThanOrEqual(pt.metrics.visRight);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  expect(await blockCount(), 'a low-lane click adds a block at 500% zoom').toBe(before + 1);
  await saveEvidence(page, 'C2-deadzone-500-zoom');
  await resetZoom();
});

test('C3: the clickable-lane affordance stays visible when blocks exist', async () => {
  if ((await blockCount()) === 0) {
    await page.getByRole('button', { name: /add text/i }).click();
    await page.waitForTimeout(300);
  }
  expect(await blockCount(), 'at least one block present').toBeGreaterThan(0);
  await expect(page.getByText('Click empty lane to add text')).toBeVisible();
  await saveEvidence(page, 'C3-persistent-hint');
});

test('C4a: delete from the Edit Text rail', async () => {
  await resetZoom().catch(() => {});
  await resetToSingleBlock();
  // Select the block (sub-threshold click on its body selects, never moves).
  const box = await blockBox(0);
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  const at = await elementInfoAt(cx, cy);
  expect(at?.inBlockBody).toBe(true);
  await page.mouse.click(cx, cy);
  await expect(page.getByRole('heading', { name: 'Edit Text' })).toBeVisible();

  const before = await blockCount();
  // Exact name targets the RAIL button ("Delete text"); the per-block trash
  // buttons carry the accessible name "Delete text block" and must not match.
  const del = page.getByRole('button', { name: 'Delete text', exact: true });
  await expect(del).toBeVisible();
  await del.click();
  await page.waitForTimeout(300);
  expect(await blockCount(), 'rail delete removes one block').toBe(before - 1);
  // Selection cleared -> rail closes.
  await expect(page.getByRole('heading', { name: 'Edit Text' })).toHaveCount(0);
  await saveEvidence(page, 'C4a-delete-from-rail');
});

test('C4b: delete from the per-block trash control', async () => {
  await resetToSingleBlock(); // one block -> its trash is unobstructed
  const trash = page.getByTitle('Delete text block').first();
  await trash.scrollIntoViewIfNeeded().catch(() => {});
  await trash.click();
  await page.waitForTimeout(300);
  expect(await blockCount(), 'per-block trash removes the block').toBe(0);
  await saveEvidence(page, 'C4b-delete-per-block');
});

test('C4c: Delete/Backspace on the focused block removes it', async () => {
  await resetToSingleBlock();
  await page.getByTestId('text-block-body-0').focus();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  expect(await blockCount(), 'Delete removes the focused block').toBe(0);

  // Backspace path too.
  await page.getByRole('button', { name: /add text/i }).click();
  await page.waitForTimeout(300);
  expect(await blockCount()).toBe(1);
  await page.getByTestId('text-block-body-0').focus();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  expect(await blockCount(), 'Backspace removes the focused block').toBe(0);
  await saveEvidence(page, 'C4c-delete-keyboard');
});

test('C5 (default zoom): body drag moves the block, duration preserved, ONE persist', async () => {
  await resetZoom().catch(() => {});
  await resetToSingleBlock();
  const r = await dragBlockBody(0, 150);
  expect(r.startAfter, `block start moved (${r.startBefore} -> ${r.startAfter})`).not.toBeCloseTo(r.startBefore, 3);
  expect(Math.abs(r.widthAfter - r.widthBefore), 'duration (pixel width) preserved at fixed zoom').toBeLessThan(3);
  expect(r.posts, 'exactly ONE move_text_edge persist per completed drag').toBe(1);
  await saveEvidence(page, 'C5-drag-default-zoom');
});

test('C5 (500% zoom): body drag moves the block, duration preserved, ONE persist', async () => {
  await resetZoom().catch(() => {});
  await resetToSingleBlock();
  await zoomTo500();
  const r = await dragBlockBody(0, 150);
  expect(r.startAfter, `block start moved at 500% (${r.startBefore} -> ${r.startAfter})`).not.toBeCloseTo(r.startBefore, 3);
  expect(Math.abs(r.widthAfter - r.widthBefore), 'duration (pixel width) preserved at 500% zoom').toBeLessThan(4);
  expect(r.posts, 'exactly ONE move_text_edge persist per completed drag at 500%').toBe(1);
  await saveEvidence(page, 'C5-drag-500-zoom');
  await resetZoom();
});

test('C6: a lever still resizes and a plain click still selects (no move persist)', async () => {
  await resetZoom().catch(() => {});
  await resetToSingleBlock();
  // --- click selects, does not move ---
  const box = await blockBox(0);
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  let movePosts = 0;
  const onReq = (req) => {
    if (req.method() === 'POST' && OVERLAY_ACTIONS_RE.test(req.url())) {
      try { if (JSON.parse(req.postData() || '{}').action === 'move_text_edge') movePosts += 1; } catch { /* */ }
    }
  };
  page.on('request', onReq);
  const at = await elementInfoAt(cx, cy);
  expect(at?.inBlockBody).toBe(true);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(250);
  await expect(page.getByRole('heading', { name: 'Edit Text' })).toBeVisible();
  expect(movePosts, 'a plain click must not fire a move persist').toBe(0);

  // --- start lever resizes (width changes) ---
  const widthBefore = (await blockBox(0)).width;
  const lever = page.getByTestId('text-lever-start-0');
  const lb = await lever.boundingBox();
  const lx = Math.round(lb.x + lb.width / 2);
  const ly = Math.round(lb.y + lb.height / 2);
  await page.mouse.move(lx, ly);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(lx + (40 * i) / 5, ly); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForTimeout(300);
  page.off('request', onReq);
  const widthAfter = (await blockBox(0)).width;
  expect(Math.abs(widthAfter - widthBefore), 'start lever resizes the block (width changes)').toBeGreaterThan(8);
  await saveEvidence(page, 'C6-lever-resize-and-click-select');
});

test('C7: per-block controls stay clear of the horizontal scrollbar at 500% zoom', async () => {
  await resetZoom().catch(() => {});
  await resetToSingleBlock();
  await zoomTo500();
  const trash = page.getByTitle('Delete text block').first();
  await trash.scrollIntoViewIfNeeded().catch(() => {});
  const tb = await trash.boundingBox();
  expect(tb, 'a per-block control is present').toBeTruthy();
  const cx = Math.round(tb.x + tb.width / 2);
  const cy = Math.round(tb.y + tb.height / 2);
  // The control must be the topmost element at its center (not clipped/occluded
  // by the scrollbar or an overflow edge).
  const info = await elementInfoAt(cx, cy);
  expect(info?.inButton, `control must be hit-testable, not occluded (got ${JSON.stringify(info)})`).toBe(true);
  // And it must sit within the reserved lane height.
  const m = await laneMetrics();
  expect(tb.y + tb.height, 'control bottom stays within the h-28 lane').toBeLessThanOrEqual(m.lane.bottom + 1);
  await saveEvidence(page, 'C7-controls-clear-of-scrollbar-500');
  await resetZoom();
});

test('C8: responsive — desktop + 375px, no horizontal overflow, evidence saved', async () => {
  await responsiveSweep(page);
});
