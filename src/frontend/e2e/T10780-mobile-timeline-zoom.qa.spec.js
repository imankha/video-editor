import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';

/**
 * T10780 — REAL-BROWSER proof (chromium, phone viewports + touch) that the mobile
 * Annotate timeline is legible: rendered at a fixed 3x with a finger-sized touch
 * scrollbar, the playhead pulled into view on a non-playback seek, and the window
 * paging forward (re-anchor ~1/3 in) during playback. Desktop stays byte-identical
 * (scale 1, no scrollbar).
 *
 * Two layers of evidence:
 *  1. The dev-only /timelinediag.html harness mounts the REAL TimelineBase at
 *     scale=3 with the page-forward anchor — no backend needed, so it runs the
 *     scrollbar GEOMETRY + follow/seek MATH end-to-end and deterministically.
 *  2. A real-account Annotate block (game with plays) proves the layer-specific
 *     gestures the harness can't: swipe-plays-scroll vs swipe-scrubber-seek, and
 *     that the scrollbar shows on the actual screen.
 *
 * Run (in a /dotask container): bash scripts/dev-verify.sh \
 *   e2e/T10780-mobile-timeline-zoom.qa.spec.js
 */

const SCROLL_CONTAINER = '.timeline-scroll-container';
const SCROLLBAR_TRACK = '[data-testid="mobile-scrollbar-track"]';
const SCROLLBAR_THUMB = '[data-testid="mobile-scrollbar-thumb"]';
const SENTINEL = '[data-testid="below-timeline-sentinel"]';
const PLAYHEAD = '[data-testid="timeline-playhead"]';
const PLAY_BTN = '[data-testid="play-btn"]';
const STATUS = '[data-testid="status"]';

const HARNESS_MOBILE = '/timelinediag.html?scale=3&anchor=page-forward&fluid=1';
const HARNESS_DESKTOP = '/timelinediag.html?scale=1&fluid=1';

async function rects(page) {
  return page.evaluate(({ sc, ph, tr, th, se }) => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const scroller = document.querySelector(sc);
    return {
      scroller: g(sc),
      playhead: g(ph),
      track: g(tr),
      thumb: g(th),
      sentinel: g(se),
      scrollLeft: scroller ? scroller.scrollLeft : null,
      clientWidth: scroller ? scroller.clientWidth : null,
      scrollWidth: scroller ? scroller.scrollWidth : null,
      // Native-bar accounting (regression found on the first phone test, 2026-09-21):
      // offsetHeight - clientHeight is the layout height a NON-overlay native
      // horizontal scrollbar takes (0 when hidden / overlay); scrollHeight >
      // clientHeight means the container has vertical overflow (a vertical bar).
      nativeBarHeight: scroller ? scroller.offsetHeight - scroller.clientHeight : null,
      verticalOverflow: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
      scrollbarWidthCss: scroller ? getComputedStyle(scroller).scrollbarWidth : null,
      overflowY: scroller ? getComputedStyle(scroller).overflowY : null,
    };
  }, { sc: SCROLL_CONTAINER, ph: PLAYHEAD, tr: SCROLLBAR_TRACK, th: SCROLLBAR_THUMB, se: SENTINEL });
}

const PHONES = [
  { name: '393x852', width: 393, height: 852 },
  { name: '360x740', width: 360, height: 740 },
];

test.describe('T10780 mobile timeline — TimelineBase mechanics (harness)', () => {
  // /timelinediag.html is a Vite-dev-only page (not a production build input), so on
  // a deployed target the SPA catch-all serves index.html and the harness never
  // mounts. The math itself is unit-covered (TimelineBase.autoscroll.test.jsx).
  skipOnDeployedTarget(test, 'drives the dev-only /timelinediag.html harness page, absent from a production BUILD');

  for (const vp of PHONES) {
    test.describe(`@ ${vp.name}`, () => {
      test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

      test('renders the track at ~3x and a finger-sized scrollbar (>=44px row, >=56px thumb, grip, 8/12 spacing)', async ({ page }) => {
        await page.goto(HARNESS_MOBILE);
        await expect(page.locator(STATUS)).toBeVisible();
        await expect(page.locator(SCROLLBAR_TRACK)).toBeVisible();
        const r = await rects(page);

        // Criterion: 3x content
        expect(r.scrollWidth / r.clientWidth, 'scaled content is ~3x the visible width').toBeGreaterThanOrEqual(2.9);

        // Criterion: finger-sized hit area + thumb
        expect(r.track.height, 'scrollbar row hit area >= 44px').toBeGreaterThanOrEqual(44);
        expect(r.thumb.width, 'thumb >= 56px wide').toBeGreaterThanOrEqual(56);
        const gripBars = await page.locator(`${SCROLLBAR_THUMB} span`).count();
        expect(gripBars, 'thumb carries a multi-line grip glyph').toBeGreaterThanOrEqual(3);

        // Criterion: >= 8px above (from the track), >= 12px below (before next control)
        expect(r.track.top - r.scroller.bottom, '>= 8px gap above the scrollbar').toBeGreaterThanOrEqual(7);
        expect(r.sentinel.top - r.track.bottom, '>= 12px gap below the scrollbar').toBeGreaterThanOrEqual(11);

        // Criterion (user's first phone test, 2026-09-21): exactly ONE horizontal
        // bar and NO vertical bar. The native bar is hidden below lg and the
        // container never overflows vertically.
        expect(r.scrollbarWidthCss, 'native scrollbar hidden on mobile').toBe('none');
        expect(r.nativeBarHeight, 'native horizontal bar takes no layout height').toBe(0);
        expect(r.overflowY, 'container never scrolls vertically').toBe('hidden');
        // (`verticalOverflow` is asserted on the REAL screen below: this harness
        // renders no lanes, so the fixed-height playhead overshoots its lone
        // scrubber row by design.)

        await saveEvidence(page, `criterion-scrollbar-fingersize-${vp.name}`);
      });

      test('a touch drag anywhere in the scrollbar row scrolls the window (no dead zone)', async ({ page }) => {
        await page.goto(HARNESS_MOBILE);
        await expect(page.locator(SCROLLBAR_TRACK)).toBeVisible();
        const before = (await rects(page)).scrollLeft;
        expect(before).toBe(0);

        // Real CDP touch, starting at the very top edge of the row (the py-1
        // padding band) to prove the whole 44px row is the hit target, not just
        // the visual pill.
        const r = await page.locator(SCROLLBAR_TRACK).boundingBox();
        await cdpSwipe(page, r.x + r.width * 0.1, r.x + r.width * 0.8, r.y + 2);

        const after = (await rects(page)).scrollLeft;
        expect(after, 'a touch starting at the row edge moved the window').toBeGreaterThan(0);
        await saveEvidence(page, `criterion-scrollbar-drag-${vp.name}`);
      });

      test('a MOUSE drag works too: continuous, grab keeps its offset, release outside the row still lands', async ({ page }) => {
        // User ruling 2026-09-21: "work great using touch or mouse". The first cut
        // was touch + click only, so a mouse got click-to-jump ("finite
        // positions") and a mouseup outside the row was a lost gesture.
        await page.goto(HARNESS_MOBILE);
        await expect(page.locator(SCROLLBAR_TRACK)).toBeVisible();
        const track = await page.locator(SCROLLBAR_TRACK).boundingBox();
        const thumb0 = await page.locator(SCROLLBAR_THUMB).boundingBox();
        const y = track.y + track.height / 2;

        // 1) press ON the thumb (no jump), drag right in small steps -> scrollLeft
        //    rises monotonically at every step (continuous, not stepped).
        const grabX = thumb0.x + thumb0.width * 0.5;
        await page.mouse.move(grabX, y);
        await page.mouse.down();
        expect((await rects(page)).scrollLeft, 'pressing on the thumb does not jump').toBe(0);
        const samples = [];
        for (let i = 1; i <= 10; i++) {
          await page.mouse.move(grabX + i * 12, y);
          samples.push((await rects(page)).scrollLeft);
        }
        for (let i = 1; i < samples.length; i++) {
          expect(samples[i], `step ${i} moved the window (continuous drag)`).toBeGreaterThan(samples[i - 1]);
        }
        // the thumb stayed under the cursor (grab offset preserved): its center
        // is within a few px of the cursor
        const thumb1 = await page.locator(SCROLLBAR_THUMB).boundingBox();
        expect(Math.abs((thumb1.x + thumb1.width / 2) - (grabX + 120)), 'thumb stays under the cursor').toBeLessThanOrEqual(4);

        // 2) keep dragging while the cursor leaves the row (below it, into the
        //    page) and release THERE: capture keeps the gesture alive, the window
        //    keeps following, and nothing is lost on the outside release.
        const beforeExit = (await rects(page)).scrollLeft;
        await page.mouse.move(grabX + 160, y + 120);
        const outside = (await rects(page)).scrollLeft;
        expect(outside, 'drag continues while the cursor is outside the row').toBeGreaterThan(beforeExit);
        await page.mouse.up();
        const released = (await rects(page)).scrollLeft;
        expect(released, 'release outside the row keeps the position').toBe(outside);
        // and after release, moving the mouse no longer scrolls
        await page.mouse.move(grabX, y);
        expect((await rects(page)).scrollLeft, 'no drag after release').toBe(released);

        // 3) press on the RAIL left of the thumb: the thumb centers under the
        //    cursor (jump), then a drag continues from there.
        const railX = track.x + 8;
        await page.mouse.move(railX, y);
        await page.mouse.down();
        // scrollLeft is written synchronously on the press; the thumb's DOM
        // position follows on the next frame (scroll event -> React state), so
        // assert the model now and poll the view.
        expect((await rects(page)).scrollLeft, 'rail press near the left end jumps the window to 0').toBe(0);
        await expect.poll(async () => {
          const t = await page.locator(SCROLLBAR_THUMB).boundingBox();
          return Math.abs((t.x + t.width / 2) - railX) <= t.width / 2 + 2;
        }, { message: 'rail press centers the thumb under the cursor (clamped at 0)' }).toBe(true);
        await page.mouse.move(railX + 60, y);
        expect((await rects(page)).scrollLeft, 'drag continues after a rail press').toBeGreaterThan(0);
        await page.mouse.up();
        await saveEvidence(page, `criterion-scrollbar-mouse-drag-${vp.name}`);
      });

      test('a non-playback seek past the right margin re-anchors the playhead ~1/3 in (page-forward)', async ({ page }) => {
        await page.goto(HARNESS_MOBILE);
        await expect(page.locator(PLAYHEAD)).toBeVisible();
        expect((await rects(page)).scrollLeft, 'starts at the beginning').toBe(0);

        // Click the scrubber near the RIGHT EDGE OF THE VIEWPORT (the 3x track
        // extends far past it, so a fraction-of-full-width click would land
        // off-screen and never register). At scrollLeft 0 the visible right edge
        // maps to a time whose playhead sits past the right 15% margin -> the
        // effect scrolls it into view, re-anchored ~1/3 from the left.
        const box = await page.locator(`${SCROLL_CONTAINER} .cursor-pointer`).first().boundingBox();
        await page.mouse.click(vp.width - 12, box.y + box.height / 2);
        await page.waitForTimeout(150);

        const r = await rects(page);
        expect(r.scrollLeft, 'window scrolled to bring the playhead into view').toBeGreaterThan(0);
        // playhead within the visible window
        expect(r.playhead.left).toBeGreaterThanOrEqual(r.scroller.left - 1);
        expect(r.playhead.left).toBeLessThanOrEqual(r.scroller.right + 1);
        // ...and ~1/3 in from the left, NOT pinned to the right edge (lookahead)
        const offsetFrac = (r.playhead.left - r.scroller.left) / r.clientWidth;
        expect(offsetFrac, 'playhead sits ~1/3 in with upcoming content to its right').toBeGreaterThan(0.15);
        expect(offsetFrac, 'playhead is well left of the right edge (page-forward lookahead)').toBeLessThan(0.55);
        await saveEvidence(page, `criterion-seek-into-view-1third-${vp.name}`);
      });

      test('during playback the window follows so the playhead never leaves the visible bounds', async ({ page }) => {
        await page.goto(HARNESS_MOBILE);
        await page.click(PLAY_BTN);
        let sawMid = false;
        let sawFollow = false;
        await expect
          .poll(async () => {
            const r = await rects(page);
            const within = r.playhead.left >= r.scroller.left - 2 && r.playhead.left <= r.scroller.right + 2;
            if (!within) return 'ESCAPED';
            if (r.scrollLeft > 0) sawFollow = true;
            const playing = (await page.locator(STATUS).textContent()).includes('playing=true');
            if (playing) sawMid = true;
            return playing ? 'PLAYING' : 'STOPPED';
          }, { timeout: 15000, intervals: [50] })
          .toBe('STOPPED');
        expect(sawMid, 'observed mid-playback').toBe(true);
        expect(sawFollow, 'the window followed the playhead (scrollLeft advanced)').toBe(true);
        await saveEvidence(page, `criterion-playback-follow-${vp.name}`);
      });
    });
  }

  test.describe('desktop is byte-identical (no scrollbar, full-width track)', () => {
    test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });
    test('scale 1 renders full width with no mobile scrollbar', async ({ page }) => {
      await page.goto(HARNESS_DESKTOP);
      await expect(page.locator(STATUS)).toBeVisible();
      await expect(page.locator(SCROLLBAR_TRACK)).toHaveCount(0);
      const r = await rects(page);
      expect(r.scrollWidth / r.clientWidth, 'no horizontal overscroll at scale 1').toBeLessThanOrEqual(1.02);
      expect(r.scrollbarWidthCss, 'desktop at scale 1 shows no native bar either').toBe('none');
      expect(r.nativeBarHeight, 'no native bar layout height at scale 1').toBe(0);
      await saveEvidence(page, 'criterion-desktop-no-scrollbar');
    });
  });
});

/**
 * Real-account Annotate block — the layer-specific gestures the harness can't
 * model (needs ClipRegionLayer + the touch scrubber). Uses the dev fixture
 * account's longest game (`at Sporting`, ~102min, 62 plays) so plays are dense
 * enough to prove legibility at 3x. Skipped on a deployed target.
 *
 * NOTE: native horizontal touch scrolling only happens through the browser's real
 * input pipeline — a JS-dispatched TouchEvent does NOT scroll. So the swipe
 * gestures below drive CDP `Input.dispatchTouchEvent` (real touch), not synthetic
 * events.
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 7);

/**
 * A real touch swipe via CDP. Native scroll fling only registers when the moves
 * are paced (the compositor needs per-move timing to derive velocity), so we await
 * a frame between points — a single burst of dispatchTouchEvent reads as a
 * teleport and scrolls nothing.
 */
async function cdpSwipe(page, x0, x1, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x0), y: Math.round(y) }] });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * (i / steps));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y) }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('T10780 mobile Annotate — real screen (gestures + scrollbar)', () => {
  skipOnDeployedTarget(test, 'dev-login + /api real-account data are dev/local-only seams');
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  });

  async function openGame(page) {
    await openGameInAnnotate(page, GAME_ID);
    await page.locator('.clip-marker').first().waitFor({ state: 'visible', timeout: 30000 });
  }

  test('the plays track is zoomed with a scrollbar; swiping plays scrolls, swiping the scrubber seeks', async ({ page }) => {
    const rw = page.viewportSize().width;
    await openGame(page);
    await expect(page.locator(SCROLLBAR_TRACK), 'the finger scrollbar shows on the real screen').toBeVisible();
    await saveEvidence(page, 'criterion-real-annotate-3x-scrollbar');

    const r0 = await rects(page);
    expect(r0.scrollWidth / r0.clientWidth, 'plays track rendered at ~3x on the phone').toBeGreaterThanOrEqual(2.9);

    // User's first phone test (2026-09-21): ONE horizontal bar, NO vertical bar,
    // and the full height of the lanes visible ("the full length should be
    // preserved"). Native bar hidden + zero layout height; the container is
    // overflow-y hidden AND its lanes fit inside it, so nothing is clipped.
    expect(r0.scrollbarWidthCss, 'native scrollbar hidden on the real screen').toBe('none');
    expect(r0.nativeBarHeight, 'no native bar layout height on the real screen').toBe(0);
    expect(r0.overflowY, 'timeline never scrolls vertically').toBe('hidden');
    expect(r0.verticalOverflow, 'lanes fit: no vertical overflow inside the timeline').toBeLessThanOrEqual(0);
    const lane = await page.locator('[data-testid="clip-track-mobile"]').boundingBox();
    expect(lane.y + lane.height, 'plays lane bottom is inside the timeline box (full length preserved)')
      .toBeLessThanOrEqual(r0.scroller.bottom + 0.5);

    // Gesture ROUTING (deterministic, the actual mechanism): the scrubber row is
    // `touch-none` so the browser routes a horizontal touch to our seek handler
    // (no native scroll); the plays row (ClipRegionLayer) is NOT touch-none and
    // lives inside the overflow-x:auto scroller, so a horizontal touch there pans
    // natively. This is what makes "swipe plays = scroll, swipe scrubber = seek".
    const routing = await page.evaluate(({ sc }) => {
      const scroller = document.querySelector(sc);
      const scrubber = scroller?.querySelector('.cursor-pointer');
      const playsTrack = document.querySelector('[data-testid="clip-track-mobile"] .region-track')
        || document.querySelector('[data-testid="clip-track-mobile"]');
      const ta = (el) => (el ? getComputedStyle(el).touchAction : null);
      return {
        scrollerOverflowX: scroller ? getComputedStyle(scroller).overflowX : null,
        scrubberTouchAction: ta(scrubber),
        playsTouchAction: ta(playsTrack),
      };
    }, { sc: SCROLL_CONTAINER });
    expect(routing.scrollerOverflowX, 'the plays track lives in a horizontally-scrollable container').toMatch(/auto|scroll/);
    expect(routing.scrubberTouchAction, 'scrubber row is touch-none -> a swipe seeks, not scrolls').toBe('none');
    expect(routing.playsTouchAction, 'plays row is NOT touch-none -> a swipe pans the track natively').not.toBe('none');

    // A swipe on the SCRUBBER row seeks the video and does NOT scroll the track.
    const scrub = await page.locator(`${SCROLL_CONTAINER} .cursor-pointer`).first().boundingBox();
    const scrubY = scrub.y + scrub.height / 2;
    const timeBefore = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    await cdpSwipe(page, rw * 0.3, rw * 0.85, scrubY);
    await page.waitForTimeout(300);
    const timeAfter = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    // The gesture is consumed as a SEEK (currentTime moves). We don't assert
    // scrollLeft is unchanged: the resulting playhead move can legitimately
    // trigger the page-forward seek-into-view. The touch-none routing check above
    // is what proves the swipe is a seek, not a native pan.
    expect(Math.abs(timeAfter - timeBefore), 'swiping the scrubber row seeks the video').toBeGreaterThan(0.2);
    await saveEvidence(page, 'criterion-real-swipe-scrubber-seeks');

    // A real (paced) touch swipe on the plays row pans the track natively.
    await page.evaluate((sc) => { document.querySelector(sc).scrollLeft = 0; }, SCROLL_CONTAINER);
    const clip = await page.locator('[data-testid="clip-track-mobile"]').boundingBox();
    const clipY = clip.y + clip.height / 2;
    await cdpSwipe(page, rw * 0.85, rw * 0.15, clipY);
    await page.waitForTimeout(300);
    const scrolledBy = (await rects(page)).scrollLeft;
    expect(scrolledBy, 'a touch swipe on the plays row scrolls the timeline').toBeGreaterThan(0);
    await saveEvidence(page, 'criterion-real-swipe-plays-scrolls');

    await responsiveSweep(page);
  });
});
