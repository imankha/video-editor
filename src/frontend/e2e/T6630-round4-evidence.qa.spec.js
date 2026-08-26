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
// The text region list depends on TWO async chains that don't finish with
// the video/text-track DOM mounting: (1) working-video metadata must
// resolve before the gated overlay-data fetch even fires (OverlayScreen's
// `shouldLoad = ... && effectiveDuration && ...`), and (2) a SEPARATE
// "fresh export" restore path can re-fire afterward. Traced empirically: the
// list did not reach its true, backend-matching count until ~10s+ after
// navigation. A fixed short wait races this and reads a partially-loaded (or
// stale, pre-restore) list -- diagnosed via a one-off console-trace spec
// after cleanup silently left real leftover regions behind on 3 consecutive
// runs (each logged "0 leftover" while the backend still held N-1 stale
// regions from the run before). Poll until the count stops moving instead of
// trusting one read.
//
// T6630 round 6: polls the TIMELINE's own blocks (regionCount(), unfiltered
// by playhead), not the Text tab panel's list -- round 6 item 2 scopes that
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
// T6630 round 6: region creation is timeline-click-only (the Settings-tab
// "Add region" button this spec originally used is REMOVED -- round 6 item
// 1, explicit user direction: "adding and removing regions is done on the
// timeline"). Click real screen coordinates within the text lane's TRACK at
// `fraction` of its width -- via the locator's own .click({position}) (not
// a raw page.mouse.click at a pre-computed box) so Playwright scrolls the
// track into view first.
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
  //
  // T6630 round 6: cleanup now goes through the TIMELINE's own delete
  // buttons (text-delete-region-*, item 3), not the Text tab panel's list --
  // round 6 item 2 scopes that panel to the region(s) under the CURRENT
  // playhead, so a leftover region elsewhere in time would be invisible to
  // (and undeletable via) the old panel-based loop.
  await waitForRegionListSettled();
  for (let i = 0; i < 20; i++) {
    const trash = page.locator('[data-testid^="text-delete-region-"]').first();
    if ((await trash.count()) === 0) break;
    await trash.click();
    await page.waitForTimeout(300);
  }
  const leftover = await regionCount();
  console.log('R4-EVIDENCE timeline regions after cleanup:', leftover);
  expect(leftover, 'cleanup left no leftover regions before this spec adds its own').toBe(0);
});

test.afterAll(async () => { await page?.context()?.close(); });

// T7770 consolidation: G1 (two elements render simultaneously), G2 (fresh
// element has a default preset, never Custom), and G2b (second element picks a
// different default preset) were DELETED here. They are superseded on the same
// REAL /overlay screen by T6630-round7-evidence's R7-2 (the region tree's
// scoped "+ Add text" appends an element) and R7-3/4 (a fresh element gets an
// individually-identifying label + a top-right default preset, never "Custom
// position"). Round 7 corrected round 4's preset/region expectations, so those
// three round-4 assertions were the stale copy. Round 4 retains only its still-
// UNIQUE facets below: the no-reflow settings panel (G3/G3b), the
// error-banner-clears-on-recovery proof (B1), the SW-eviction hygiene mechanism
// (SW1/SW2), and the 375px responsive check (R1).

// -------------------------------------------------------------- 3. no-reflow settings panel
test('G3: adding a region/element does NOT move the settings panel (measured bbox)', async () => {
  await tab('text');
  const panel = visiblePanel();
  const settings = panel.getByTestId('text-settings-panel');

  // T6630 round 6: region creation is timeline-click-only now (item 1).
  // clickTextTrackAt scrolls to bring the (below-the-fold) timeline into
  // view. That scroll happens on an INNER container, not the document
  // (window.scrollTo(0,0) is a confirmed no-op here) -- and it moves the
  // settings panel's VIEWPORT-relative position (boundingBox() is always
  // viewport-relative) without moving the panel in the page's own flow at
  // all. scrollIntoViewIfNeeded() on a fixed anchor isn't reliably
  // deterministic either once the panel (round 6 item 5 made its height
  // responsive) is taller than the viewport -- Chromium can pick either
  // edge to align to depending on current position. Force the actual
  // scrollable container's scrollTop to a known 0 directly instead --
  // unambiguous, not an alignment heuristic.
  const resetScroll = () => page.evaluate(() => {
    // Zero EVERY scrollable element on the page -- harmless no-op on
    // anything not actually scrolled, and doesn't require guessing which
    // ancestor is "the" page-level scroll container.
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight + 1) el.scrollTop = 0;
    });
  });
  await resetScroll();
  const before = await settings.boundingBox();
  await clickTextTrackAt(0.5);
  await page.waitForTimeout(400);
  await resetScroll();
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
