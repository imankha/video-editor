// T6630 round 4 evidence — real /overlay screen, real DB-loaded record,
// region/element model, two-column no-reflow layout, default position
// preset, a video-error-overlay-clears-on-recovery proof (item B), and a
// synthetic SW-eviction hygiene check (SW1/SW2 -- mechanism only; the
// service-worker theory for the real video-load failures seen during this
// task is WITHDRAWN, see the comment above SW1). Geometry re-measured
// immediately before every pointer press. Video paused before pixel
// comparisons. Parse Playwright's own summary line.

import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { probeOverlayDrafts } from './helpers/overlayDraft';
import { saveEvidence } from './helpers/qa.js';

test.describe.configure({ mode: 'serial' });

let page;
let draftProjectId;

// The project selection lives ONLY in an in-memory Zustand store (no
// persist middleware) -- a plain page.reload() drops it, since the
// `pendingProjectId` sessionStorage breadcrumb is READ-AND-CLEARED on first
// consumption (pendingNavigation.js). Re-set the breadcrumb before every
// reload so it re-resolves to the SAME real DB draft, mirroring exactly how
// beforeAll opened it the first time.
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
    // A plain page.reload() drops the project selection (Zustand,
    // in-memory-only -- see reloadSameOverlayDraft's own comment above): a
    // bare reload here silently lands on no-project state, which then makes
    // the NEXT check vacuously pass (no video -> no "failed to load" banner
    // -> ensureVideoReady wrongly reports ready) and corrupts every assumption
    // downstream (e.g. beforeAll's region cleanup racing an empty panel).
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
// The Text tab's region list depends on TWO async chains that don't finish
// with the video/text-track DOM mounting: (1) working-video metadata must
// resolve before the gated overlay-data fetch even fires (OverlayScreen's
// `shouldLoad = ... && effectiveDuration && ...`), and (2) a SEPARATE
// "fresh export" restore path can re-fire afterward. Traced empirically: the
// panel did not reach its true, backend-matching count until ~10s+ after
// navigation. A fixed short wait races this and reads a partially-loaded (or
// stale, pre-restore) list -- diagnosed via a one-off console-trace spec
// after cleanup silently left real leftover regions behind on 3 consecutive
// runs (each logged "0 leftover" while the backend still held N-1 stale
// regions from the run before). Poll until the count stops moving instead of
// trusting one read.
async function waitForRegionListSettled(panel, { maxWaitMs = 15000, pollMs = 500 } = {}) {
  let last = -1;
  let stableFor = 0;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const count = await panel.locator('[data-testid^="text-tab-region-"]').count();
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
  await page.evaluate((id) => {
    sessionStorage.setItem('pendingProjectId', String(id));
    sessionStorage.setItem('pendingProjectMode', 'overlay');
  }, draftProjectId);
  // The text-track DOM node mounts (and can render zero blocks) BEFORE the
  // overlay-data fetch that actually populates textOverlays state resolves --
  // `.text-track` existing is NOT proof the region list has loaded. Without
  // this wait, the cleanup loop below can run against a still-empty panel,
  // report "0 leftover" while REAL regions are still in flight, and leave
  // them to corrupt every later test's region counts (diagnosed via a
  // one-off debug spec: timeline blocks and the panel's own region cards
  // disagreed by exactly the leftover count).
  const overlayDataLoaded = page.waitForResponse(
    (r) => r.url().includes('/overlay-data') && r.ok(),
    { timeout: 30000 }
  );
  await page.goto('/overlay');
  await overlayDataLoaded;
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  await page.locator('.text-track').first().waitFor({ timeout: 60000 });
  const vok = await ensureVideoReady();
  console.log('R4-EVIDENCE video ready:', vok);
  await pauseVideo();

  // Start from a KNOWN-CLEAN slate: remove any pre-existing regions via the
  // real UI (works regardless of whether that data predates the v039
  // migration -- delete-by-id doesn't care about internal shape) so this
  // spec's own adds are unambiguous, real DB-loaded-record writes.
  await tab('text');
  const panel = visiblePanel();
  // Wait for the region list to actually SETTLE (see waitForRegionListSettled's
  // doc comment) rather than a fixed short wait -- the restore chain can still
  // be in flight well after the video/text-track DOM has mounted.
  const settledCount = await waitForRegionListSettled(panel);
  console.log('R4-EVIDENCE region list settled at count:', settledCount);
  for (let i = 0; i < 20; i++) {
    const trash = panel.getByTitle('Delete region (and all its text)').first();
    if ((await trash.count()) === 0) break;
    await trash.click();
    await page.waitForTimeout(250);
  }
  // Measure the panel's own region cards, not regionCount() -- regionCount()
  // reads TIMELINE blocks, a separate render surface that (per the race just
  // guarded above) is not guaranteed to reflect the same instant.
  const leftoverRegionCards = await panel.locator('[data-testid^="text-tab-region-"]').count();
  console.log('R4-EVIDENCE region cards after cleanup:', leftoverRegionCards);
  expect(leftoverRegionCards, 'cleanup left no leftover regions before this spec adds its own').toBe(0);
});

test.afterAll(async () => { await page?.context()?.close(); });

// -------------------------------------------------------------- 1. multi-element render
test('G1: two elements in ONE region render SIMULTANEOUSLY on the real stage', async () => {
  await tab('text');
  const panel = visiblePanel();

  await panel.getByTestId('text-tab-add-region').click();
  await page.waitForTimeout(400);
  expect(await regionCount()).toBe(1);

  // Append a SECOND element into the SAME region (not a new region).
  const addElementBtn = panel.locator('[data-testid^="text-tab-add-element-"]').first();
  await addElementBtn.click();
  await page.waitForTimeout(400);
  expect(await regionCount(), 'still ONE region on the timeline').toBe(1);

  const elementRows = panel.locator('[data-testid^="text-tab-element-"]');
  await expect(elementRows).toHaveCount(2);

  // BOTH elements must be visible on the stage AT ONCE. The
  // `text-preview-element-*` div is a full-bleed positioning wrapper (same
  // size as the video stage for every element) -- RichText's own root is
  // ALSO full-bleed (`stageStyle`, T5180 design §7 overflow-clip box); the
  // actual per-element placement lives on the innermost
  // `span[data-baseline-y]`, which is `display:inline` and tightly bounds
  // the rendered glyphs. Measure THAT to prove distinct positions, not just
  // presence.
  const previewElements = page.locator('[data-testid^="text-preview-element-"]');
  await expect(previewElements).toHaveCount(2);
  const glyphSpans = page.locator('[data-testid^="text-preview-element-"] span[data-baseline-y]');
  await expect(glyphSpans).toHaveCount(2);

  const box1 = await glyphSpans.nth(0).boundingBox();
  const box2 = await glyphSpans.nth(1).boundingBox();
  console.log('G1 element glyph boxes:', JSON.stringify(box1), JSON.stringify(box2));
  expect(box1, 'first element has a real box').toBeTruthy();
  expect(box2, 'second element has a real box').toBeTruthy();
  expect(
    box1.y !== box2.y || box1.x !== box2.x,
    'the two elements render at DISTINCT positions, not stacked on top of each other'
  ).toBe(true);

  await saveEvidence(page, 'R4-G1-multi-element-render');
});

// -------------------------------------------------------------- 2. default preset
test('G2: a newly added element shows a DEFAULT position preset immediately (never Custom)', async () => {
  const panel = visiblePanel();
  const firstElementRow = panel.locator('[data-testid^="text-tab-element-"]').first();
  await firstElementRow.click();
  await page.waitForTimeout(200);

  await expect(panel.getByTestId('text-position-grid')).toBeVisible();
  const activePreset = panel.locator('[data-testid^="text-position-"][aria-pressed="true"]');
  console.log('G2 active preset count:', await activePreset.count());
  expect(await activePreset.count(), 'a preset is highlighted immediately -- never "Custom position"').toBe(1);
  await expect(panel.getByText(/custom position/i)).toHaveCount(0);

  await saveEvidence(page, 'R4-G2-default-preset');
});

test('G2b: the SECOND element in the region picked a DIFFERENT default preset than the first', async () => {
  const panel = visiblePanel();
  const rows = panel.locator('[data-testid^="text-tab-element-"]');
  await rows.nth(0).click();
  await page.waitForTimeout(150);
  const firstActive = await panel.locator('[data-testid^="text-position-"][aria-pressed="true"]').getAttribute('data-testid');

  await rows.nth(1).click();
  await page.waitForTimeout(150);
  const secondActive = await panel.locator('[data-testid^="text-position-"][aria-pressed="true"]').getAttribute('data-testid');

  console.log('G2b presets:', firstActive, secondActive);
  expect(secondActive).not.toBe(firstActive);
});

// -------------------------------------------------------------- 3. no-reflow settings panel
test('G3: adding a region/element does NOT move the settings panel (measured bbox)', async () => {
  await tab('text');
  const panel = visiblePanel();
  const settings = panel.getByTestId('text-settings-panel');

  const before = await settings.boundingBox();
  await panel.getByTestId('text-tab-add-region').click();
  await page.waitForTimeout(400);
  const after = await settings.boundingBox();

  console.log('G3 settings bbox before:', JSON.stringify(before), 'after:', JSON.stringify(after));
  expect(after.x, 'settings panel x unchanged').toBeCloseTo(before.x, 0);
  expect(after.y, 'settings panel y unchanged').toBeCloseTo(before.y, 0);
  expect(after.width, 'settings panel width unchanged').toBeCloseTo(before.width, 0);

  await saveEvidence(page, 'R4-G3-no-reflow-settings');
});

test('G3b: no vertical scrollbar on the OUTER tab panel at typical content size, desktop', async () => {
  const tabpanel = page.locator('[data-testid^="overlay-tabpanel-"]:visible').first();
  const overflow = await tabpanel.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  console.log('G3b tabpanel overflow:', JSON.stringify(overflow));
  expect(overflow.scrollHeight, 'content fits without the outer panel scrolling').toBeLessThanOrEqual(overflow.clientHeight + 2);
});

// -------------------------------------------------------------- item B: error banner clears on recovery
test('B1: the "Video failed to load" banner CLEARS once a subsequent load succeeds', async () => {
  test.setTimeout(60000);
  // Block the video element's own byte requests so its NEXT reload fails,
  // driving useVideo's real error path (handleError -> NETWORK_ERROR
  // classification -> auto-retry budget exhausted -> setError(...)).
  //
  // Item B bug: the user's screenshots showed the video frame visible BEHIND
  // a stuck "Video failed to load" banner -- a later load had actually
  // succeeded, but nothing cleared the error `useVideo`/OverlayScreen had set
  // from an earlier failed attempt. Fixed in useVideo.js's handleLoadedData
  // (clears `error` once the element proves it has playable data) and
  // OverlayScreen.jsx's isVideoElementLoading effect (clears
  // workingVideoLoadError/workingVideoMissing the same way).
  //
  // Deliberately reload via video.load() directly, NEVER via the "Retry
  // Loading Video" button -- that handler already explicitly clears the
  // error the instant it's clicked (a pre-existing, different mechanism).
  // This test must prove the AUTOMATIC clear-on-success path, not that one.
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'media') {
      route.abort('failed');
    } else {
      route.continue();
    }
  });

  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) v.load();
  });

  await expect(
    page.getByText(/video failed to load|playback was interrupted/i).first()
  ).toBeVisible({ timeout: 20000 });
  await saveEvidence(page, 'R4-B1-error-banner-shows');

  // Let the SAME element's next load succeed.
  await page.unroute('**/*');
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) v.load();
  });

  await expect(
    page.getByText(/video failed to load|playback was interrupted/i)
  ).toHaveCount(0, { timeout: 20000 });
  await saveEvidence(page, 'R4-B1-error-banner-cleared-after-recovery');
});

// -------------------------------------------------------------- 4. SW eviction hygiene (mechanism only)
// WITHDRAWN CAUSAL CLAIM (round 4 resume, item C): these two tests were
// originally written to "prove" a stale service worker caused the real
// "Failed to fetch" video-load failures seen during this task. That theory
// is REFUTED -- the user unregistered every service worker and the failure
// persisted. The actual root cause was R2 bucket CORS (the bucket's
// allowed-origins list did not include this container's port range), fixed
// at the infrastructure level by the supervisor via put_bucket_cors, not by
// any code in this branch. SW1/SW2 below stay ONLY as a synthetic mechanism
// test for evictStaleDevServiceWorker() (commit 463a2cba) -- they inject a
// DELIBERATELY BROKEN fake SW via page.route to prove the eviction function
// unregisters a controlling SW and clears its Cache Storage, which is good
// hygiene against a real future stale-SW scenario (e.g. a leftover
// `vite build && vite preview` session on the same origin). They do NOT
// reproduce, and must not be cited as evidence for, the actual CORS failure.
test('SW1 (hygiene, not root-cause evidence): a synthetic controlling SW CAN break a fetch', async () => {
  test.setTimeout(90000);
  // A real static file (public/e2e-test-only-stale-sw.js), not a
  // page.route()-mocked response: Playwright cannot intercept a service
  // worker's OWN registration fetch (Chromium routes it outside CDP's Fetch
  // domain -- confirmed empirically: a plain page fetch() to a routed URL is
  // intercepted fine, but serviceWorker.register() to the same URL throws
  // "unsupported MIME type" because the route handler is bypassed).

  // Register the deliberately-breaking SW (models a REAL SW left over from a
  // past `vite build && vite preview` session on this same origin).
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/e2e-test-only-stale-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return !!reg;
  });
  await page.waitForTimeout(500);

  // Reload to the SAME draft -- THIS load is genuinely SW-controlled (the SW
  // claimed clients). Re-set the pendingProjectId breadcrumb first (it was
  // consumed-and-cleared by the FIRST load; the project selection itself
  // lives only in an in-memory store that a full reload drops).
  await reloadSameOverlayDraft();
  await page.waitForLoadState('domcontentloaded');
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  console.log('SW1 controlled after reload:', controlled);
  expect(controlled, 'the reload must actually be SW-controlled to prove the mechanism').toBe(true);

  // Prove the mechanism DIRECTLY via a page-level fetch to an R2-shaped URL
  // (the fake SW's fetch handler rejects any request whose URL contains
  // "r2.cloudflarestorage.com", entirely inside the SW -- no real network
  // call is attempted, so this needs no real R2 reachability). This is
  // deliberately NOT "wait for the video-error banner": the app's own
  // presigned-URL retry + /working_video/stream fallback (working as
  // intended -- see the Item B fix) can recover within the same couple of
  // seconds this test would otherwise wait, racing and masking the very
  // mechanism this test exists to demonstrate.
  const fetchResult = await page.evaluate(async () => {
    try {
      await fetch('https://example.r2.cloudflarestorage.com/does-not-matter');
      return { rejected: false };
    } catch (err) {
      return { rejected: true, message: err.message };
    }
  });
  console.log('SW1 direct R2-shaped fetch under SW control:', JSON.stringify(fetchResult));
  await saveEvidence(page, 'R4-SW1-controlled-load-fails');
  expect(fetchResult.rejected, 'a controlling SW CAN intercept and break an R2-shaped fetch (mechanism only, not the real CORS cause)').toBe(true);
});

test('SW2 (hygiene): the NEXT reload evicts the synthetic stale SW and the load succeeds cleanly', async () => {
  test.setTimeout(90000);
  // The eviction code (evictStaleDevServiceWorker) ran unconditionally during
  // SW1's controlled reload's own bootstrap and unregistered the SW for
  // FUTURE navigations. This reload (to the SAME draft) should come up
  // completely clean.
  await reloadSameOverlayDraft();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  const controllerGone = await page.evaluate(() => !navigator.serviceWorker.controller);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  console.log('SW2 controllerGone:', controllerGone, 'registrations:', registrations);
  expect(registrations, 'the stale SW registration is gone').toBe(0);

  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  await page.locator('.text-track').first().waitFor({ timeout: 60000 });
  const vok = await ensureVideoReady();
  const failedBanner = await page.getByText(/video failed to load/i).count();
  console.log('SW2 video ready:', vok, 'failedBanner:', failedBanner);
  await saveEvidence(page, 'R4-SW2-evicted-load-succeeds');
  expect(failedBanner, 'the load is clean once the stale SW is evicted').toBe(0);
});

// -------------------------------------------------------------- 5. responsive
test('R1: responsive 375px -- two-column stacks, no overflow', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth + 1);
  await saveEvidence(page, 'R4-R1-mobile-375');
  await page.setViewportSize({ width: 1280, height: 900 });
});
