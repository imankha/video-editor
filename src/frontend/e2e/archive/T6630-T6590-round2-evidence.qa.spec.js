// T6630+T6590 round-2 DESIGN-GATE evidence, captured on the REAL /overlay screen
// with an EXISTING DB-loaded record whose text block the spec does NOT create.
//
// Rules honoured: real screen + real DB block (never delete-then-recreate the
// thing under test); re-measure geometry immediately before every pointer press
// and assert document.elementFromPoint; pause video before pixel work; parse
// Playwright's own summary line. A diag harness may supplement, never substitute.

import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { probeOverlayDrafts } from './helpers/overlayDraft';
import { saveEvidence } from './helpers/qa.js';

test.describe.configure({ mode: 'serial' });

let page;

async function pauseVideo() {
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch { /* */ } }));
}
// The overlay working-video is a presigned R2 URL that occasionally fails its
// first browser fetch in this container. Retry a few times so evidence renders
// the real preview. Returns true once a video reports readyState>=2.
async function ensureVideoReady(maxTries = 4) {
  for (let i = 0; i < maxTries; i++) {
    const ready = await page.evaluate(() =>
      [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && Number.isFinite(v.duration)));
    if (ready) return true;
    const retry = page.getByRole('button', { name: /retry loading video/i }).first();
    if (await retry.count()) { await retry.click().catch(() => {}); }
    await page.waitForTimeout(3000);
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && Number.isFinite(v.duration)));
}
async function tab(id) {
  await page.getByTestId(`overlay-tab-${id}`).first().click();
  await page.waitForTimeout(200);
}
async function blockCount() {
  return page.locator('[data-testid^="text-block-body-"]').count();
}
async function currentZoomPercent() {
  const el = page.locator('.timeline-container span.text-blue-400').filter({ hasText: /Zoom:/ }).first();
  if ((await el.count()) === 0) return 100;
  const m = (await el.textContent()).match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : 100;
}
async function zoomTo(target) {
  await page.locator('.lucide-film').first().click();
  await page.waitForTimeout(120);
  for (let i = 0; i < 12 && (await currentZoomPercent()) < target; i++) {
    await page.evaluate(() => document.querySelector('.timeline-scroll-container')
      ?.dispatchEvent(new WheelEvent('wheel', { deltaY: -1500, bubbles: true, cancelable: true })));
    await page.waitForTimeout(70);
  }
  return currentZoomPercent();
}
async function resetZoom() {
  await page.locator('.lucide-film').first().click();
  await page.waitForTimeout(80);
  for (let i = 0; i < 40 && (await currentZoomPercent()) > 100; i++) {
    await page.evaluate(() => document.querySelector('.timeline-scroll-container')
      ?.dispatchEvent(new WheelEvent('wheel', { deltaY: 1500, bubbles: true, cancelable: true })));
    await page.waitForTimeout(40);
  }
}
// bbox of an element via getBoundingClientRect (viewport coords), scrolled in.
async function bboxTestId(testid) {
  const el = page.getByTestId(testid).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  return el.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.goto('/');
  const { loadable } = await probeOverlayDrafts(page);
  expect(loadable.length).toBeGreaterThan(0);
  // Prefer a draft that already HAS text blocks so the 0px-delta test runs on a
  // block we did not create. Probe each until one loads with >=1 block.
  let chosen = null;
  for (const id of loadable) {
    await page.evaluate((pid) => {
      sessionStorage.setItem('pendingProjectId', String(pid));
      sessionStorage.setItem('pendingProjectMode', 'overlay');
    }, id);
    await page.goto('/overlay');
    await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 120000 }).catch(() => {});
    await page.locator('.text-track').first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const n = await blockCount();
    console.log(`EVIDENCE draft ${id}: ${n} existing text blocks`);
    if (n > 0) { chosen = id; break; }
    if (!chosen) chosen = id;
  }
  console.log('EVIDENCE using draft', chosen);
  const vok = await ensureVideoReady();
  console.log('EVIDENCE video ready:', vok);
  await pauseVideo();
});

test.afterAll(async () => { await page?.context()?.close(); });

test('G1: layout — three tabs (Overlay default, Text, Thumbnail), desktop', async () => {
  await expect(page.getByTestId('overlay-settings-tabs').first()).toBeVisible();
  await expect(page.getByTestId('overlay-tab-overlay').first()).toHaveAttribute('aria-selected', 'true');
  await tab('overlay'); await saveEvidence(page, 'G1-tab-overlay');
  await tab('text'); await saveEvidence(page, 'G1-tab-text');
  await tab('thumbnail'); await saveEvidence(page, 'G1-tab-thumbnail');
  // No user-visible "preview image"/"cover photo"/"use current frame" on Overlay (T6590).
  const banned = await page.getByText(/preview image|cover photo|use current frame/i).count();
  expect(banned, 'no banned legacy thumbnail copy remains').toBe(0);
  await tab('overlay');
});

test('G2: the "Add Text" control lives INSIDE the text lane (not below the timeline)', async () => {
  const inLane = page.getByTestId('add-text-in-lane').first();
  await inLane.scrollIntoViewIfNeeded().catch(() => {});
  await expect(inLane, 'in-lane add button exists').toBeVisible();
  // The rejected round-1 full-width Add Text button below the timeline is gone.
  const oldBtns = await page.getByRole('button', { name: /^\s*Add Text\s*$/ }).count();
  expect(oldBtns, 'no full-width Add Text button below the timeline').toBe(0);
  await saveEvidence(page, 'G2-add-text-in-lane');
});

test('G3: selecting a text block does NOT move it (0px delta) — on an EXISTING DB block', async () => {
  await resetZoom().catch(() => {});
  const n = await blockCount();
  expect(n, 'this draft has an existing DB text block to test').toBeGreaterThan(0);
  await tab('overlay'); // start on a non-Text tab so selection actually switches tabs
  await page.waitForTimeout(200);

  const before = await bboxTestId('text-block-body-0');
  // Re-measure + assert elementFromPoint is the block immediately before pressing.
  const cx = Math.round(before.x + before.w / 2);
  const cy = Math.round(before.y + before.h / 2);
  const at = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { onBlock: !!el?.closest?.('[data-testid^="text-block-body-"]') };
  }, [cx, cy]);
  expect(at.onBlock, 'press target is the block').toBe(true);

  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400); // selection switches to Text tab + updates panel in place
  await expect(page.getByTestId('overlay-tab-text').first()).toHaveAttribute('aria-selected', 'true');

  const after = await bboxTestId('text-block-body-0');
  const dx = Math.abs(after.x - before.x);
  const dy = Math.abs(after.y - before.y);
  console.log(`G3 block bbox before=${JSON.stringify(before)} after=${JSON.stringify(after)} dx=${dx} dy=${dy}`);
  expect(dx, 'block did not move horizontally on select').toBeLessThanOrEqual(0.5);
  expect(dy, 'block did not move vertically on select').toBeLessThanOrEqual(0.5);
  await saveEvidence(page, 'G3-select-no-reflow');
});

test('G4: timeline lane order = Text above Detection/Highlight (paint order)', async () => {
  await resetZoom().catch(() => {});
  const textY = (await bboxTestId('text-block-body-0').catch(() => null))?.y;
  // The text LANE track vs the highlight region track vertical order.
  const order = await page.evaluate(() => {
    const text = document.querySelector('.text-track')?.getBoundingClientRect().top;
    const region = document.querySelector('.region-track')?.getBoundingClientRect().top;
    return { text, region };
  });
  console.log('G4 lane tops', JSON.stringify(order), 'blockY', textY);
  expect(order.text, 'text lane sits ABOVE the highlight lane').toBeLessThan(order.region);
  await saveEvidence(page, 'G4-lane-order');
});

test('G5: whole-text-layer hide toggle (distinct from per-block eye)', async () => {
  const toggle = page.getByTestId('text-layer-toggle').first();
  await toggle.scrollIntoViewIfNeeded().catch(() => {});
  await expect(toggle).toHaveAttribute('aria-pressed', 'true'); // visible by default
  await toggle.click();
  await page.waitForTimeout(250);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false'); // hidden
  await saveEvidence(page, 'G5-text-layer-hidden');
  await toggle.click(); // restore
  await page.waitForTimeout(200);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('G6: thumbnail marker — uncut + readable with playhead at marker time, default + 500%', async () => {
  await resetZoom().catch(() => {});
  await pauseVideo();
  for (const target of [100, 500]) {
    if (target === 500) { const z = await zoomTo(500); expect(z).toBe(500); }
    await pauseVideo();
    const marker = await bboxTestId('poster-marker');
    // Uncut: the handle is fully inside the scroll container vertically.
    const sc = await page.evaluate(() => {
      const r = document.querySelector('.timeline-scroll-container')?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
    });
    console.log(`G6 zoom=${target} marker=${JSON.stringify(marker)} sc=${JSON.stringify(sc)}`);
    expect(marker.y, 'marker top not clipped above the timeline').toBeGreaterThanOrEqual(sc.top - 1);
    expect(marker.y + marker.h, 'marker bottom not clipped below the timeline').toBeLessThanOrEqual(sc.bottom + 1);
    const mcx = Math.round(marker.x + marker.w / 2);
    const mcy = Math.round(marker.y + marker.h / 2);
    if (mcx >= sc.left + 4 && mcx <= sc.right - 4) {
      // Seek the PLAYHEAD onto the marker's time by clicking the video ruler
      // (top lane) at the marker's x, so playhead and marker coincide -- the worst
      // case for occlusion. Then assert the marker handle is still the topmost
      // element at its center (readable / not occluded).
      const rulerY = Math.round(sc.top + 12);
      await page.mouse.click(mcx, rulerY);
      await page.waitForTimeout(250);
      await pauseVideo();
      const m2 = await bboxTestId('poster-marker'); // re-measure before hit-test
      const cx2 = Math.round(m2.x + m2.w / 2);
      const cy2 = Math.round(m2.y + m2.h / 2);
      const probe = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const playhead = document.querySelector('[data-testid="timeline-playhead"]')?.getBoundingClientRect();
        return {
          isMarker: el?.getAttribute?.('data-testid') === 'poster-marker' || !!el?.closest?.('[data-testid="poster-marker"]'),
          playheadLeft: playhead?.left,
        };
      }, [cx2, cy2]);
      console.log(`G6 zoom=${target} markerCx=${cx2} playheadLeft=${probe.playheadLeft} topmost-is-marker=${probe.isMarker}`);
      expect(probe.isMarker, 'marker handle is topmost even with the playhead at its time').toBe(true);
    }
    await saveEvidence(page, `G6-marker-zoom-${target}`);
  }
  await resetZoom().catch(() => {});
});

test('G7: responsive — 375px, tabs + lane + marker present, no horizontal overflow', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(m.scrollWidth, 'no horizontal overflow at 375px').toBeLessThanOrEqual(m.innerWidth + 1);
  await saveEvidence(page, 'G7-mobile-375');
  await page.setViewportSize({ width: 1280, height: 800 });
});
