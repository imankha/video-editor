import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { computeFollowScrollTarget, TimelineBase } from './TimelineBase';

/**
 * T5647 — follow-playhead auto-scroll math. The pre-fix version conflated
 * "percent of content" (scrollWidth) with "percent of maxScroll"
 * (scrollWidth - clientWidth), so at zoom > 100% the scroll target lagged the
 * playhead's true pixel position and it ran off-screen. This pins the
 * pixel-based replacement: playheadPx computed directly from scrollWidth, then
 * scrolled in pixels, kept within a 15%-of-viewport margin of either edge.
 */

const EDGE_PADDING = 20;

describe('computeFollowScrollTarget', () => {
  it('does not move the scroll position while the playhead is within the margin', () => {
    // scrollWidth 1000, clientWidth 400 (maxScroll 600). Playhead at 50% ~= 500px,
    // already well inside [scrollLeft+margin, scrollLeft+clientWidth-margin].
    const target = computeFollowScrollTarget({
      scrollLeft: 300,
      scrollWidth: 1000,
      clientWidth: 400,
      maxScroll: 600,
      progress: 50,
      edgePadding: EDGE_PADDING,
    });
    expect(target).toBe(300);
  });

  it('scrolls right to keep the playhead inside the right margin at zoom > 100%', () => {
    // Reproduces the bug scenario: scale 1.93 content, playhead near the end.
    const scrollWidth = 1930;
    const clientWidth = 1000;
    const maxScroll = scrollWidth - clientWidth; // 930
    const progress = 90; // playhead far along the CONTENT, not maxScroll
    const playheadPx = EDGE_PADDING + (scrollWidth - 2 * EDGE_PADDING) * (progress / 100);

    const target = computeFollowScrollTarget({
      scrollLeft: 0,
      scrollWidth,
      clientWidth,
      maxScroll,
      progress,
      edgePadding: EDGE_PADDING,
    });

    // The old percent-mixing math would under-scroll here (target derived from
    // idealScrollPercent * maxScroll/100 instead of the true pixel position).
    // The fix must scroll far enough that the playhead sits inside the margin.
    const margin = clientWidth * 0.15;
    expect(target).toBeGreaterThan(0);
    expect(playheadPx - target).toBeLessThanOrEqual(clientWidth - margin + 0.001);
    expect(playheadPx - target).toBeGreaterThanOrEqual(margin - 0.001);
  });

  // T10780 — the page-forward anchor: on a forward crossing into the right 15%
  // margin the window re-anchors so the playhead sits ~1/3 in from the left
  // (page-forward with lookahead), instead of riding the right edge. Focus/Overlay
  // keep the default 'margin' nudge; the backward case is identical for both.
  it("forward crossing with the page-forward anchor re-anchors the playhead 1/3 in", () => {
    const scrollWidth = 1200;
    const clientWidth = 400;
    const maxScroll = scrollWidth - clientWidth; // 800
    const progress = 60;
    const playheadPx = EDGE_PADDING + (scrollWidth - 2 * EDGE_PADDING) * (progress / 100); // 716

    const target = computeFollowScrollTarget({
      scrollLeft: 0,
      scrollWidth,
      clientWidth,
      maxScroll,
      progress,
      edgePadding: EDGE_PADDING,
      anchor: 'page-forward',
    });
    expect(target).toBeCloseTo(playheadPx - clientWidth / 3, 5); // 716 - 133.33
  });

  it("the default 'margin' anchor keeps the Focus/Overlay right-edge nudge unchanged", () => {
    const scrollWidth = 1200;
    const clientWidth = 400;
    const maxScroll = scrollWidth - clientWidth;
    const progress = 60;
    const playheadPx = EDGE_PADDING + (scrollWidth - 2 * EDGE_PADDING) * (progress / 100); // 716

    const target = computeFollowScrollTarget({
      scrollLeft: 0,
      scrollWidth,
      clientWidth,
      maxScroll,
      progress,
      edgePadding: EDGE_PADDING,
    });
    // margin nudge: playheadPx - clientWidth + margin = 716 - 400 + 60
    expect(target).toBeCloseTo(playheadPx - clientWidth + clientWidth * 0.15, 5);
  });

  it('the backward case is anchor-independent (page-forward still uses the left margin)', () => {
    const args = {
      scrollLeft: 500,
      scrollWidth: 1000,
      clientWidth: 400,
      maxScroll: 600,
      progress: 5, // playheadPx = 20 + 960*0.05 = 68 -> 68 - 60 = 8
      edgePadding: EDGE_PADDING,
    };
    expect(computeFollowScrollTarget({ ...args, anchor: 'page-forward' })).toBeCloseTo(8, 5);
    expect(computeFollowScrollTarget({ ...args })).toBeCloseTo(8, 5);
  });

  it('page-forward clamps the re-anchored target to [0, maxScroll]', () => {
    const target = computeFollowScrollTarget({
      scrollLeft: 700,
      scrollWidth: 1200,
      clientWidth: 400,
      maxScroll: 800,
      progress: 100, // playheadPx = 20 + 1160 = 1180 -> 1180 - 133 clamps to 800
      edgePadding: EDGE_PADDING,
      anchor: 'page-forward',
    });
    expect(target).toBe(800);
  });

  it('scrolls left to keep the playhead inside the left margin', () => {
    const target = computeFollowScrollTarget({
      scrollLeft: 500,
      scrollWidth: 1000,
      clientWidth: 400,
      maxScroll: 600,
      progress: 5, // playheadPx = 20 + 960*0.05 = 68
      edgePadding: EDGE_PADDING,
    });
    // margin = 60; playheadPx (68) < scrollLeft(500)+margin(60) so target = 68 - 60 = 8
    expect(target).toBeCloseTo(8, 5);
  });

  it('clamps the target to [0, maxScroll]', () => {
    const belowZero = computeFollowScrollTarget({
      scrollLeft: 0,
      scrollWidth: 1000,
      clientWidth: 400,
      maxScroll: 600,
      progress: 0,
      edgePadding: EDGE_PADDING,
    });
    expect(belowZero).toBe(0);

    const aboveMax = computeFollowScrollTarget({
      scrollLeft: 600,
      scrollWidth: 1000,
      clientWidth: 400,
      maxScroll: 600,
      progress: 100,
      edgePadding: EDGE_PADDING,
    });
    expect(aboveMax).toBe(600);
  });

  it('never lets the playhead pixel run outside the viewport at zoom 193%, across full playback', () => {
    const timelineScale = 1.93;
    const clientWidth = 1000;
    const scrollWidth = clientWidth * timelineScale;
    const maxScroll = scrollWidth - clientWidth;

    let scrollLeft = 0;
    for (let progress = 0; progress <= 100; progress += 1) {
      scrollLeft = computeFollowScrollTarget({
        scrollLeft,
        scrollWidth,
        clientWidth,
        maxScroll,
        progress,
        edgePadding: EDGE_PADDING,
      });
      const playheadPx = EDGE_PADDING + (scrollWidth - 2 * EDGE_PADDING) * (progress / 100);
      expect(playheadPx).toBeGreaterThanOrEqual(scrollLeft);
      expect(playheadPx).toBeLessThanOrEqual(scrollLeft + clientWidth);
    }
  });
});

/**
 * T10780 — non-playback seek-into-view + mount-into-view for the page-forward
 * (mobile Annotate) timeline. Extends the existing seek-to-start effect: any
 * non-playback seek (tap a play, prev/next, open from list) that lands the
 * playhead outside the window scrolls it back in, and a mount at zoom lands on
 * the current playhead instead of pinned at 0. Focus/Overlay (default anchor)
 * keep their mount-at-0 / seek-to-0-reset behavior untouched.
 */
describe('TimelineBase page-forward scroll-into-view (T10780)', () => {
  let scrollLeftStore;
  beforeEach(() => {
    scrollLeftStore = new WeakMap();
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
      configurable: true,
      get() { return scrollLeftStore.get(this) ?? 0; },
      set(v) { scrollLeftStore.set(this, v); },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() { return this.classList?.contains('timeline-scroll-container') ? 1200 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() { return this.classList?.contains('timeline-scroll-container') ? 400 : 0; },
    });
  });
  afterEach(() => {
    delete HTMLElement.prototype.scrollLeft;
    delete HTMLElement.prototype.scrollWidth;
    delete HTMLElement.prototype.clientWidth;
    cleanup();
  });

  const baseProps = {
    duration: 100,
    onSeek: () => {},
    layerLabels: <div />,
    timelineScale: 3,
    isPlaying: false,
    followAnchor: 'page-forward',
  };
  const scroller = () => document.querySelector('.timeline-scroll-container');

  it('mounts scrolled to a mid-timeline playhead instead of at 0', () => {
    // progress 60 -> playheadPx 716, off the right of a 400px window at scrollLeft 0
    render(<TimelineBase {...baseProps} currentTime={60} />);
    expect(scroller().scrollLeft).toBeGreaterThan(0);
  });

  it('a non-playback seek that lands off-screen scrolls the playhead into view', () => {
    const { rerender } = render(<TimelineBase {...baseProps} currentTime={0} />);
    expect(scroller().scrollLeft).toBe(0); // playhead at the start stays put

    rerender(<TimelineBase {...baseProps} currentTime={60} />);
    expect(scroller().scrollLeft).toBeGreaterThan(0);
  });

  it('does NOT scroll into view for the default anchor (Focus/Overlay stay put)', () => {
    const { rerender } = render(
      <TimelineBase {...baseProps} followAnchor={undefined} currentTime={0} />
    );
    rerender(<TimelineBase {...baseProps} followAnchor={undefined} currentTime={60} />);
    // default anchor only snaps back on a seek-to-START, never scrolls a
    // forward seek into view -> the window stays at 0
    expect(scroller().scrollLeft).toBe(0);
  });
});
