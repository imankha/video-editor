import { describe, it, expect } from 'vitest';
import { computeFollowScrollTarget } from './TimelineBase';

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
