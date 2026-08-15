// T6630 round 5 evidence — real /overlay screen, real DB-loaded record.
//
// Item 1: text region CREATION moved back onto the timeline lane (a click on
// empty track area creates + selects a region), reversing round 3's "Text
// tab only" call per fresh user direction.
// Item 2: a freshly created region's own SEED element must be editable
// immediately (no second element needed) without a backend 404 / the
// generic "didn't save" toast -- the id-mismatch bug this fixes.
//
// Geometry re-measured immediately before every pointer press. Video paused
// before interaction. Parse Playwright's own summary line.

import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { probeOverlayDrafts } from './helpers/overlayDraft';
import { saveEvidence } from './helpers/qa.js';

test.describe.configure({ mode: 'serial' });

let page;
let draftProjectId;

// See T6630-round4-evidence.qa.spec.js's identical helper for the full
// rationale (in-memory-only project selection; a plain page.reload() drops
// it). Duplicated here rather than shared -- each round's evidence spec is a
// self-contained, one-off QA artifact by established convention in this repo.
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
async function regionCount() {
  return page.locator('[data-testid^="text-block-body-"]').count();
}
// See round4 spec's identical helper doc comment for why this polls instead
// of trusting one read (the region list settles well after the text-track
// DOM mounts). T6630 round 6: polls the TIMELINE's own blocks (unfiltered by
// playhead), not the Text tab panel's list -- round 6 item 2 scopes that
// panel to the region(s) under the CURRENT playhead, so it can legitimately
// settle at 0/1 while real regions still exist (and are still loading)
// elsewhere in time.
async function waitForRegionListSettled({ maxWaitMs = 15000, pollMs = 500 } = {}) {
  let last = -1;
  let stableFor = 0;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const count = await regionCount();
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

// Click real screen coordinates within the text timeline lane's TRACK
// (the element handleTrackClick is bound to), at `fraction` of its width --
// exercising the REAL onClick handler end-to-end, not a synthetic dispatch.
// Uses the locator's own .click({position}) (not a raw page.mouse.click at a
// pre-computed box) so Playwright scrolls the track into view first -- the
// timeline lane sits below the fold on a 900px-tall viewport, and a stale
// pre-scroll bounding box silently clicks the wrong spot (or nothing).
async function clickTextTrackAt(fraction) {
  const track = page.locator('.text-track').first();
  await track.scrollIntoViewIfNeeded();
  const box = await track.boundingBox();
  await track.click({ position: { x: box.width * fraction, y: box.height / 2 } });
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.goto('/');
  const { loadable } = await probeOverlayDrafts(page);
  expect(loadable.length).toBeGreaterThan(0);
  draftProjectId = loadable[0];
  await page.evaluate((id) => {
    sessionStorage.setItem('pendingProjectId', String(id));
    sessionStorage.setItem('pendingProjectMode', 'overlay');
  }, draftProjectId);
  const overlayDataLoaded = page.waitForResponse(
    (r) => r.url().includes('/overlay-data') && r.ok(),
    { timeout: 30000 }
  );
  await page.goto('/overlay');
  await overlayDataLoaded;
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  await page.locator('.text-track').first().waitFor({ timeout: 60000 });
  const vok = await ensureVideoReady();
  console.log('R5-EVIDENCE video ready:', vok);
  await pauseVideo();

  // Known-clean slate, same as round 4's beforeAll. T6630 round 6: cleanup
  // now goes through the TIMELINE's own delete buttons (text-delete-region-*,
  // item 3), not the Text tab panel's list -- see waitForRegionListSettled's
  // doc comment for why the panel-based version stopped being reliable.
  const settledCount = await waitForRegionListSettled();
  console.log('R5-EVIDENCE region list settled at count:', settledCount);
  for (let i = 0; i < 20; i++) {
    const trash = page.locator('[data-testid^="text-delete-region-"]').first();
    if ((await trash.count()) === 0) break;
    await trash.click();
    await page.waitForTimeout(300);
  }
  const leftover = await regionCount();
  console.log('R5-EVIDENCE timeline regions after cleanup:', leftover);
  expect(leftover, 'cleanup left no leftover regions before this spec adds its own').toBe(0);
});

test.afterAll(async () => { await page?.context()?.close(); });

// -------------------------------------------------------------- item 1
test('R5-1: clicking empty timeline lane space creates AND selects a text region', async () => {
  await tab('text');
  const panel = visiblePanel();

  const before = await panel.locator('[data-testid^="text-tab-region-"]').count();
  expect(before, 'starts clean').toBe(0);

  // Click near the START of the track (not the settings-tab button) --
  // the must-have gesture per item 1.
  await clickTextTrackAt(0.15);
  await page.waitForTimeout(500);

  const after = await panel.locator('[data-testid^="text-tab-region-"]').count();
  expect(after, 'a region now exists in the panel (created via timeline click, not the button)').toBe(1);

  const timelineBlocks = await page.locator('[data-testid^="text-block-body-"]').count();
  expect(timelineBlocks, 'the timeline lane itself shows the new block').toBe(1);

  // Selection: the click auto-selects the region's seed element, which
  // flips the settings surface to show it immediately (matching round 4's
  // G2 "default preset visible immediately" contract) -- proving "selecting
  // a text region is done on the timeline" too, not just creation.
  await expect(panel.getByTestId('text-position-grid')).toBeVisible();
  const activePreset = panel.locator('[data-testid^="text-position-"][aria-pressed="true"]');
  expect(await activePreset.count(), 'the new region\'s element is selected immediately').toBe(1);

  await saveEvidence(page, 'R5-1-timeline-click-creates-and-selects');
});

// -------------------------------------------------------------- item 2
test('R5-2: a freshly-created region\'s OWN seed element is editable immediately (no 404, no "didn\'t save" toast)', async () => {
  await tab('text');
  const panel = visiblePanel();

  // Fresh region at a DIFFERENT time than R5-1's (default 2s duration) so
  // the two never overlap on the [0, duration) axis.
  await clickTextTrackAt(0.6);
  await page.waitForTimeout(500);

  // T6630 round 6 item 2: the panel now shows only the region under the
  // playhead / selected -- creating this SECOND region moves selection (and
  // the playhead) to it, so R5-1's region drops out of view here. Confirmed
  // via the TIMELINE (unfiltered) that both regions really do exist.
  expect(await regionCount(), 'both regions exist on the timeline').toBe(2);
  const regionCards = await panel.locator('[data-testid^="text-tab-region-"]').count();
  expect(regionCards, 'the panel shows only the newly-selected region').toBe(1);
  // wrappedAddRegion seeks the playhead to the new region's own startTime --
  // confirms that half of round 6's item-2 fix (the OTHER half, selecting
  // it back via the timeline after reload, is exercised further down).
  const regionStartTime = await page.evaluate(() => document.querySelector('video')?.currentTime ?? null);
  expect(regionStartTime).toBeGreaterThan(0);

  // Capture console + toast activity from this point forward only.
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Edit the SEED element's text directly -- no second element added first.
  // This is the exact sequence round4.md's bug report described: type text
  // into a freshly created region's only element.
  const textInput = panel.locator('label:has-text("Text") input[type="text"]').first();
  await expect(textInput).toBeVisible();
  await textInput.fill('ROUND 5 FIX');
  // Debounce is 250ms (OverlayScreen.jsx wrappedUpdateTextSpec) + network.
  await page.waitForTimeout(1500);

  const didntSaveToast = await page.getByText(/didn.t save/i).count();
  const rejectedLog = consoleErrors.filter((t) => /rejected by server|not found/i.test(t));
  console.log('R5-2 consoleErrors:', JSON.stringify(consoleErrors));
  console.log('R5-2 didntSaveToast:', didntSaveToast, 'rejectedLog:', JSON.stringify(rejectedLog));

  await saveEvidence(page, 'R5-2-seed-element-edit-no-404');

  expect(rejectedLog, 'no update_text_spec 404 / server-rejection logged for the seed element').toHaveLength(0);
  expect(didntSaveToast, 'no generic "didn\'t save" toast appeared').toBe(0);

  // Positive confirmation the edit actually reached the server (not just
  // "no error" -- the write really happened): reload the SAME draft fresh
  // and confirm the text persisted.
  await reloadSameOverlayDraft();
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  await page.locator('.text-track').first().waitFor({ timeout: 60000 });
  await ensureVideoReady();
  await pauseVideo();
  await waitForRegionListSettled();
  // T6630 round 6 item 2: a fresh reload restores neither playhead position
  // nor selection -- the (now playhead-scoped) panel needs the region
  // SELECTED to show it. Click the region's own TIMELINE block (labeled
  // with its element's text, regionLabel() in TextLayer.jsx) rather than
  // raw-seeking video.currentTime: a raw seek raced the working-video
  // source's own multi-stage swap after reload (still mid-swap well after
  // "region list settled" per round4/5's own documented "10s+" restore
  // chain) and got silently reset before the panel check ran. Selecting via
  // the timeline goes through the app's own selectRegion path (already
  // fixed to work in the SAME tick, round 6's other bug fix) and sidesteps
  // the video-element race entirely.
  await page.locator('[data-testid^="text-block-body-"]', { hasText: 'ROUND 5 FIX' }).click();
  await page.waitForTimeout(300);
  await tab('text');
  const reloadedPanel = visiblePanel();
  await expect(reloadedPanel.getByText('ROUND 5 FIX')).toBeVisible({ timeout: 10000 });
  await saveEvidence(page, 'R5-2-edit-persisted-after-reload');
});
