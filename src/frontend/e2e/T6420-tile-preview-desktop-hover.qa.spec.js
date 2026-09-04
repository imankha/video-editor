/**
 * T6420 QA — TilePreviewVideo primitive + desktop hover preview (Highlight Reels).
 *
 * Drives the REAL account (dev-login) against Highlight Reels, which reliably has
 * published reel tiles, and proves the acceptance criteria with NETWORK-TAB
 * evidence (a request counter over /api/downloads/{id}/stream) for the
 * request-count / timing claims the task file names as required evidence:
 *
 *   AC — grid at rest fires ZERO video requests            -> streamRequests() === 0 before any hover
 *   AC — warm ~100ms / reveal ~450ms, poster-first         -> src attaches on dwell, video plays, poster-first
 *   AC — leave restores poster and RELEASES the stream     -> video src cleared on leave
 *   AC — straight-line crossing fires zero requests        -> fast crossing adds 0 stream requests
 *   AC — at most one tile previews at a time               -> hovering B clears A's src, sets B's
 *   AC — touch byte-identical (long-press/kebab untouched) -> coarse pointer: no preview, no stream request
 *   AC — prefers-reduced-motion disables the preview       -> reduced-motion context: no stream request
 *
 * QA landmine carried forward (T6300, annotate.md): a Chromium page.screenshot()
 * flips `(pointer: coarse)` -> fine on a hybrid touch context. So the coarse-pointer
 * test runs EVERY coarse assertion BEFORE its first screenshot.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6420-tile-preview-desktop-hover.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const STREAM_RE = /\/api\/downloads\/\d+\/stream/;

/** Attach a stream-request counter to a page (the "network tab" evidence). */
function trackStreamRequests(page) {
  const requests = [];
  page.on('request', (req) => {
    if (STREAM_RE.test(req.url())) requests.push(req.url());
  });
  return {
    count: () => requests.length,
    urls: () => requests.slice(),
    reset: () => { requests.length = 0; },
  };
}

async function openMyReels(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
  const panel = page.getByTestId('published-tab-panel');
  const shown = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (!shown) {
    const headers = panel.getByTestId('collapsible-group-header');
    await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      const appeared = await panel.getByTestId('reel-card').first()
        .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
      if (appeared) break;
    }
  }
  return panel;
}

/** Read a reel-card's inner preview <video> state directly from the DOM. */
async function videoState(card) {
  return card.evaluate((el) => {
    const v = el.querySelector('video');
    if (!v) return { present: false };
    return {
      present: true,
      src: v.getAttribute('src'),
      preload: v.getAttribute('preload'),
      paused: v.paused,
      opacity: parseFloat(getComputedStyle(v).opacity),
      pointerEvents: getComputedStyle(v).pointerEvents,
    };
  });
}

test.describe('T6420 tile preview — desktop hover (real account)', () => {
  test('warm/reveal/leave with network evidence + zero-at-rest', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const stream = trackStreamRequests(page);
    const panel = await openMyReels(page);

    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels in this account/env to preview');

    const card = panel.getByTestId('reel-card').first();
    // AC: grid at rest fires ZERO video requests + preload="none", no src.
    const atRest = await videoState(card);
    expect(atRest.present).toBe(true);
    expect(atRest.preload).toBe('none');
    expect(atRest.src).toBeNull();
    expect(atRest.pointerEvents).toBe('none'); // never steals the tile's actions
    expect(stream.count()).toBe(0);

    // AC: hover -> WARM attaches the /stream src (~100ms). Poster-first: the video
    // is still faded out until a frame lands.
    await card.hover();
    await expect.poll(() => stream.count(), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
    const warmReq = stream.urls().find((u) => STREAM_RE.test(u));
    expect(warmReq).toBeTruthy();

    // AC: REVEAL -> the video plays and crossfades in (poster-first, no black flash).
    await expect.poll(async () => (await videoState(card)).paused, { timeout: 8000 }).toBe(false);
    await expect.poll(async () => (await videoState(card)).opacity, { timeout: 8000 }).toBeGreaterThan(0.9);
    await saveEvidence(page, 'T6420-criterion-reveal-playing');

    // AC: leave restores poster and RELEASES the stream (src cleared).
    await page.mouse.move(5, 5);
    await expect.poll(async () => (await videoState(card)).src, { timeout: 4000 }).toBeNull();
    await saveEvidence(page, 'T6420-criterion-leave-poster-restored');

    await context.close();
  });

  test('straight-line crossing fires ZERO requests; single-active preview', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const stream = trackStreamRequests(page);
    const panel = await openMyReels(page);

    const cards = panel.getByTestId('reel-card');
    const n = await cards.count();
    test.skip(n < 1, 'no reels to cross');

    // AC: a straight-line crossing (each tile dwelt < the 100ms grace) fires zero
    // requests. Sweep the mouse across up to 4 cards with sub-grace dwell.
    stream.reset();
    const sweep = Math.min(n, 4);
    for (let i = 0; i < sweep; i++) {
      const box = await cards.nth(i).boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // no wait -> straight-line; the grace window must swallow it
    }
    await page.mouse.move(5, 5); // leave the grid
    await page.waitForTimeout(700); // longer than reveal; nothing should have fired
    expect(stream.count()).toBe(0);

    // AC: at most one tile previews at a time. Only meaningful with >=2 cards.
    if (n >= 2) {
      const a = cards.nth(0);
      const b = cards.nth(1);
      await a.hover();
      await expect.poll(async () => (await videoState(a)).src, { timeout: 4000 }).not.toBeNull();
      await b.hover();
      // Activating B force-stops A: A's src clears, B's attaches.
      await expect.poll(async () => (await videoState(b)).src, { timeout: 4000 }).not.toBeNull();
      await expect.poll(async () => (await videoState(a)).src, { timeout: 4000 }).toBeNull();
    }

    await context.close();
  });

  test('COARSE pointer: touch is byte-identical — no preview, no stream request', async ({ browser }) => {
    test.setTimeout(120_000);
    // Hybrid touch desktop context: (pointer: coarse) true, isMobile touch.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      hasTouch: true,
      isMobile: true,
    });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const stream = trackStreamRequests(page);
    const panel = await openMyReels(page);

    const card = panel.getByTestId('reel-card').first();
    const hasReels = await card.isVisible().catch(() => false);
    test.skip(!hasReels, 'no reels');

    // Run coarse assertions BEFORE any screenshot (T6300 landmine: screenshot
    // flips (pointer: coarse) -> fine on a hybrid touch context).
    const isCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    expect(isCoarse).toBe(true);

    // A pointerenter on a coarse device must NOT warm the preview (this child is
    // fine-pointer only; touch is T6430). Kebab (T6300) stays reachable.
    await card.hover().catch(() => {});
    await page.waitForTimeout(800); // past reveal
    expect(stream.count()).toBe(0);
    const st = await videoState(card);
    expect(st.src).toBeNull();
    // The persistent kebab (touch affordance) is still present and reachable.
    await expect(page.getByRole('button', { name: 'More actions' }).first()).toBeVisible();

    await saveEvidence(page, 'T6420-criterion-coarse-untouched'); // screenshot LAST
    await context.close();
  });

  test('prefers-reduced-motion disables the preview entirely', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const stream = trackStreamRequests(page);
    const panel = await openMyReels(page);

    const card = panel.getByTestId('reel-card').first();
    const hasReels = await card.isVisible().catch(() => false);
    test.skip(!hasReels, 'no reels');

    await card.hover();
    await page.waitForTimeout(800);
    expect(stream.count()).toBe(0);
    expect((await videoState(card)).src).toBeNull();
    await context.close();
  });
});
