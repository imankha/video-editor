import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5647 - REAL BROWSER (chromium, mobile viewport + touch) proof that the
 * follow-playhead auto-scroll effect in TimelineBase keeps the playhead inside the
 * scroll container's visible bounds during playback at zoom > 100%, driven through a
 * dev-only harness (/timelinediag.html) that mounts the REAL TimelineBase with a
 * simulated (non-video) playback clock.
 *
 * The bug: the effect conflated "percent of content" (scrollWidth) with "percent of
 * maxScroll" (scrollWidth - clientWidth). At scale 1.93 those frames diverge enough
 * that the scroll target under-shoots progressively and the playhead runs off the
 * right edge. The fix computes the playhead's pixel position directly and scrolls in
 * pixels, kept within a 15%-of-viewport margin - see `computeFollowScrollTarget`
 * (unit-tested in TimelineBase.autoscroll.test.jsx).
 *
 * The "manual scroll" gesture below drives the REAL MobileScrollbar thumb-track (the
 * actual mechanism a phone user has to scroll a zoomed timeline - the video track
 * itself is `touch-action: none` and captures touch for scrubbing, not scrolling).
 *
 * Run: cd src/frontend && npx playwright test e2e/T5647-timeline-autoscroll.qa.spec.js
 */

const HARNESS = '/timelinediag.html?scale=1.93';
const SCROLL_CONTAINER = '.timeline-scroll-container';
const PLAY_BTN = '[data-testid="play-btn"]';
const STATUS = '[data-testid="status"]';
const SCROLLBAR_TRACK = '[data-testid="mobile-scrollbar-track"]';

/** Playhead's left edge in viewport coordinates. */
async function playheadViewportLeft(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="timeline-playhead"]');
    return el.getBoundingClientRect().left;
  });
}

async function scrollContainerBounds(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, scrollLeft: el.scrollLeft, maxScroll: el.scrollWidth - el.clientWidth };
  }, SCROLL_CONTAINER);
}

async function isPlayheadWithinContainer(page) {
  const [phLeft, bounds] = await Promise.all([playheadViewportLeft(page), scrollContainerBounds(page)]);
  return phLeft >= bounds.left - 1 && phLeft <= bounds.right + 1;
}

test.describe('T5647 timeline follow-playhead auto-scroll (zoom > 100%, mobile)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test('playhead stays within the visible scroll bounds across playback at 193% zoom', async ({ page }) => {
    await page.goto(HARNESS);
    await expect(page.locator(STATUS)).toBeVisible();
    await saveEvidence(page, 'T5647-c1-before-play-zoomed');

    await page.click(PLAY_BTN);

    // Poll throughout playback; fail immediately if the playhead ever escapes.
    let sawMidPlayback = false;
    await expect
      .poll(
        async () => {
          const within = await isPlayheadWithinContainer(page);
          if (!within) return 'ESCAPED';
          const playing = (await page.locator(STATUS).textContent()).includes('playing=true');
          if (playing) sawMidPlayback = true;
          return playing ? 'PLAYING' : 'STOPPED';
        },
        { timeout: 15000, intervals: [50] }
      )
      .toBe('STOPPED');

    expect(sawMidPlayback, 'test actually observed the timeline mid-playback').toBe(true);
    await saveEvidence(page, 'T5647-c1-after-playback-playhead-visible');
  });

  test('a manual scroll (mobile scrollbar drag) pauses auto-scroll ~2s, then it resumes', async ({ page }) => {
    await page.goto(HARNESS);
    await page.click(PLAY_BTN);

    // Let playback run past the 2%-movement guard so auto-scroll has kicked in.
    await expect.poll(async () => (await scrollContainerBounds(page)).scrollLeft, { timeout: 6000 }).toBeGreaterThan(0);

    // A REAL user gesture: tap near the start of the mobile scrollbar track, which
    // drags the thumb (and thus scrollLeft) back toward 0 via MobileScrollbar's own
    // handler - not a synthetic scrollLeft write from our test.
    const track = await page.locator(SCROLLBAR_TRACK).boundingBox();
    await page.mouse.click(track.x + 5, track.y + track.height / 2);

    // Read the result BEFORE any slow operation (e.g. a full-page screenshot) can
    // eat into the 2s pause window and make the assertion racy.
    const justAfter = await scrollContainerBounds(page);
    expect(justAfter.scrollLeft, 'the manual scroll actually moved the view back').toBeLessThanOrEqual(10);
    await saveEvidence(page, 'T5647-c2-manual-scroll-back');

    // While the 2s manual-scroll pause is active, the still-advancing playhead must
    // NOT drag the view back forward.
    await page.waitForTimeout(800);
    const stillPaused = await scrollContainerBounds(page);
    expect(stillPaused.scrollLeft, 'auto-scroll stays paused for ~2s after a manual scroll').toBeLessThanOrEqual(justAfter.scrollLeft + 5);

    // After the pause elapses, auto-scroll resumes and catches the playhead back up.
    await expect
      .poll(async () => (await scrollContainerBounds(page)).scrollLeft, { timeout: 6000 })
      .toBeGreaterThan(justAfter.scrollLeft + 5);
    await saveEvidence(page, 'T5647-c2-autoscroll-resumed');
  });

  test('hitting Play does not jump the view (2% movement guard holds)', async ({ page }) => {
    await page.goto(HARNESS);
    const before = await scrollContainerBounds(page);
    expect(before.scrollLeft, 'starts unscrolled').toBe(0);

    await page.click(PLAY_BTN);

    // Immediately after Play - before the playhead has moved 2% - scrollLeft must
    // still read 0. A regression here would "yank" the view the instant Play fires.
    const immediate = await scrollContainerBounds(page);
    expect(immediate.scrollLeft, 'no immediate jump on Play').toBe(0);
    await saveEvidence(page, 'T5647-c3-no-jump-on-play');
  });
});
