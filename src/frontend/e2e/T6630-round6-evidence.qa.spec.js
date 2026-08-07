// T6630 round 6 evidence — real /overlay screen, real DB-loaded record.
//
// Item 1: no "Add region" button in the Text tab; timeline click still
//   creates regions (round 5's gesture, unaffected by removing the button).
// Item 2: the Text tab shows only region(s) active AT THE PLAYHEAD, and its
//   tab button reads disabled when none are.
// Item 3: a visible delete button on each timeline text-region block (not
//   keyboard-only).
// Item 4: the thumbnail marker scrolls into view when the Thumbnail tab
//   opens (root cause: off-screen past the auto-zoomed timeline's right
//   edge, not a rendering/z-index bug -- see PosterMarkerLayer.jsx's
//   revealOnActive doc comment).
// Item 5: the settings panel body height is measured from actual viewport
//   space, not a hard-coded 26rem.
//
// Cleanup uses the TIMELINE's own delete button (Item 3), not the Text tab's
// panel list -- after Item 2, the panel only shows region(s) under the
// CURRENT playhead, so a leftover region elsewhere in time would be
// invisible to (and undeletable via) the old panel-based cleanup loop.

import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { probeOverlayDrafts } from './helpers/overlayDraft';
import { saveEvidence } from './helpers/qa.js';

test.describe.configure({ mode: 'serial' });

let page;
let draftProjectId;

async function reloadSameOverlayDraft() {
  await page.evaluate((id) => {
    sessionStorage.setItem('pendingProjectId', String(id));
    sessionStorage.setItem('pendingProjectMode', 'overlay');
  }, draftProjectId);
  await page.goto('/overlay');
}

async function pauseVideo() {
  await page.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch { /* */ } }));
}
async function ensureVideoReady(maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    const bannerCount = await page.getByText(/video failed to load/i).count();
    if (bannerCount === 0) {
      const ready = await page.evaluate(() =>
        [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && Number.isFinite(v.duration)));
      if (ready) return true;
    }
    const retry = page.getByRole('button', { name: /retry loading video/i }).first();
    if (await retry.count()) await retry.click().catch(() => {});
    else await reloadSameOverlayDraft();
    await page.waitForTimeout(4000);
  }
  return page.getByText(/video failed to load/i).count().then((c) => c === 0);
}
async function tab(id) {
  await page.getByTestId(`overlay-tab-${id}`).first().click();
  await page.waitForTimeout(200);
}
function visiblePanel() {
  return page.locator('[data-testid="overlay-settings-tabs"]:visible').first();
}
async function clickTextTrackAt(fraction) {
  const track = page.locator('.text-track').first();
  await track.scrollIntoViewIfNeeded();
  const box = await track.boundingBox();
  await track.click({ position: { x: box.width * fraction, y: box.height / 2 } });
}
// Waits for the TIMELINE's own region blocks to settle (see round4/5 specs'
// identical rationale -- the restore chain can still be in flight after the
// text-track DOM mounts).
async function waitForTimelineRegionsSettled({ maxWaitMs = 15000, pollMs = 500 } = {}) {
  let last = -1;
  let stableFor = 0;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const count = await page.locator('[data-testid^="text-block-body-"]').count();
    if (count === last) {
      stableFor += pollMs;
      if (stableFor >= 1000) return count;
    } else {
      last = count;
      stableFor = 0;
    }
    await page.waitForTimeout(pollMs);
  }
  return last;
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.goto('/');
  const { loadable } = await probeOverlayDrafts(page);
  expect(loadable.length).toBeGreaterThan(0);
  draftProjectId = loadable[0];
  const overlayDataLoaded = page.waitForResponse(
    (r) => r.url().includes('/overlay-data') && r.ok(),
    { timeout: 30000 }
  );
  await page.evaluate((id) => {
    sessionStorage.setItem('pendingProjectId', String(id));
    sessionStorage.setItem('pendingProjectMode', 'overlay');
  }, draftProjectId);
  await page.goto('/overlay');
  await overlayDataLoaded;
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  await page.locator('.text-track').first().waitFor({ timeout: 60000 });
  const vok = await ensureVideoReady();
  console.log('R6-EVIDENCE video ready:', vok);
  await pauseVideo();

  // Known-clean slate via the TIMELINE's own delete buttons (see file header
  // -- the panel's list is now playhead-scoped and can't reach a leftover
  // region elsewhere in time).
  const settledCount = await waitForTimelineRegionsSettled();
  console.log('R6-EVIDENCE timeline regions settled at count:', settledCount);
  for (let i = 0; i < 20; i++) {
    const trash = page.locator('[data-testid^="text-delete-region-"]').first();
    if ((await trash.count()) === 0) break;
    await trash.click();
    await page.waitForTimeout(300);
  }
  const leftover = await page.locator('[data-testid^="text-block-body-"]').count();
  console.log('R6-EVIDENCE timeline regions after cleanup:', leftover);
  expect(leftover, 'cleanup left no leftover regions before this spec adds its own').toBe(0);
});

test.afterAll(async () => { await page?.context()?.close(); });

// -------------------------------------------------------------- item 1
test('R6-1: no "Add region" button in the Text tab; timeline click still creates a region', async () => {
  await tab('text');
  const panel = visiblePanel();
  await expect(panel.getByTestId('text-tab-add-region')).toHaveCount(0);
  await expect(panel.getByText(/add region/i)).toHaveCount(0);

  // Clean-slate proof (item 2, part 1): before anything exists or is
  // selected, the tab reads dimmed with the panel's own empty-state guidance
  // -- and is STILL CLICKABLE (this assertion IS the click: getByTestId+
  // click would throw if Playwright's actionability check considered it
  // non-interactive, exactly the failure mode a native `disabled` or
  // `aria-disabled="true"` attribute produced when first tried here).
  const textTab = page.getByTestId('overlay-tab-text').first();
  expect(await textTab.getAttribute('title')).toMatch(/no text region/i);
  await expect(panel.getByText(/no text region under the playhead/i)).toBeVisible();

  await clickTextTrackAt(0.2);
  await page.waitForTimeout(500);
  expect(await page.locator('[data-testid^="text-block-body-"]').count()).toBe(1);
  // wrappedAddRegion selects + seeks the playhead to the new region -- the
  // tab un-dims immediately (round 6 item 2's other half).
  expect(await textTab.getAttribute('title')).toBeNull();

  await saveEvidence(page, 'R6-1-no-add-region-button');
});

// -------------------------------------------------------------- item 2
test('R6-2: the Text tab shows only the region under the playhead / selected -- never a DIFFERENT region', async () => {
  await tab('text');
  const panel = visiblePanel();
  // From R6-1: one region ("regionA") exists near t=0.2*duration, selected.
  await expect(panel.locator('[data-testid^="text-tab-region-"]')).toHaveCount(1);
  const regionARow = panel.locator('[data-testid^="text-tab-region-"]').first();
  const regionAId = await regionARow.getAttribute('data-testid');

  // Create a SECOND region far away in time ("regionB") -- selecting it
  // (wrappedAddRegion's own gesture) must swap the panel to show ONLY B,
  // never both -- regions don't overlap here, and only one is selected.
  await clickTextTrackAt(0.7);
  await page.waitForTimeout(500);
  expect(await page.locator('[data-testid^="text-block-body-"]').count()).toBe(2);
  await expect(panel.locator('[data-testid^="text-tab-region-"]')).toHaveCount(1);
  const regionBRow = panel.locator('[data-testid^="text-tab-region-"]').first();
  const regionBId = await regionBRow.getAttribute('data-testid');
  expect(regionBId).not.toBe(regionAId);

  await saveEvidence(page, 'R6-2-shows-only-the-newly-selected-region');

  // Delete regionB (item 3's timeline button) -- deletion clears selection
  // (existing, already-tested useTextOverlays behavior) and the playhead is
  // still parked at regionB's old position, nowhere near regionA -- a
  // genuinely empty, nothing-selected state to prove the dimmed empty state
  // against (not just "scrubbed away from a still-selected region", which
  // correctly keeps showing it -- see OverlayModeView.jsx's filter comment).
  // MUST target regionB specifically, not .first(): the timeline (and its
  // delete buttons) render in the UNFILTERED textOverlays array's own order
  // (creation order -- regionA first), not selection order, so a bare
  // .first() would delete regionA instead.
  const regionBIndex = regionBId.replace('text-tab-region-', '');
  await page.getByTestId(`text-delete-region-${regionBIndex}`).click();
  await page.waitForTimeout(400);
  expect(await page.locator('[data-testid^="text-block-body-"]').count()).toBe(1);

  await expect(panel.locator('[data-testid^="text-tab-region-"]')).toHaveCount(0);
  await expect(panel.getByText(/no text region under the playhead/i)).toBeVisible();
  const textTab = page.getByTestId('overlay-tab-text').first();
  expect(await textTab.getAttribute('title')).toMatch(/no text region/i);

  await saveEvidence(page, 'R6-2-dimmed-after-deleting-the-selected-region');
});

// -------------------------------------------------------------- item 3
test('R6-3: a visible delete button on the timeline block removes the region', async () => {
  const before = await page.locator('[data-testid^="text-block-body-"]').count();
  expect(before).toBe(1);

  const trash = page.locator('[data-testid^="text-delete-region-"]').first();
  await expect(trash).toBeVisible();
  await trash.click();
  await page.waitForTimeout(400);

  expect(await page.locator('[data-testid^="text-block-body-"]').count()).toBe(0);
  await saveEvidence(page, 'R6-3-timeline-delete-button');
});

// -------------------------------------------------------------- item 4
test('R6-4: the thumbnail marker scrolls into view when the Thumbnail tab opens', async () => {
  await tab('thumbnail');
  await page.waitForTimeout(1200); // smooth scrollIntoView animation

  const marker = page.locator('[data-testid="poster-marker"]').first();
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  expect(box, 'marker has a real bounding box').toBeTruthy();

  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !!el && el.closest('[data-testid="poster-marker"]') != null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit, 'the marker (not something else) is the topmost hit at its own center -- i.e. actually on-screen, not scrolled out of view').toBe(true);

  await saveEvidence(page, 'R6-4-thumbnail-marker-visible');
});

// -------------------------------------------------------------- item 5
test('R6-5: the settings panel height is measured, not a fixed 26rem, and never shows an unneeded scrollbar', async () => {
  await tab('overlay');
  const panel = page.locator('[data-testid^="overlay-tabpanel-"]:visible').first();
  const info = await panel.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  console.log('R6-5 panel geometry (1280x900 viewport):', JSON.stringify(info));

  // The old hard-coded value was exactly 416 (26rem at the default 16px root
  // font size). At a normal 900px-tall desktop viewport there is more room
  // than that available -- the panel must have grown past it.
  expect(info.height).toBeGreaterThan(416);
  // No scrollbar when content fits within the (now-larger) measured height.
  expect(info.scrollHeight, 'no unneeded internal scrollbar').toBeLessThanOrEqual(info.clientHeight + 2);

  await saveEvidence(page, 'R6-5-panel-height-responsive');
});
