import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import ClipRegionLayer from './ClipRegionLayer';

// T10391: the marker tooltip's screen position (`anchorRect`) used to be
// recomputed only when `activeRegionId`/`regions`/`duration` changed — never
// on a plain layout resize. A SELECTED marker's tooltip survives a fullscreen
// toggle (selection, unlike hover, isn't cleared by the mouse moving away
// during the transition), so it stayed pinned to its pre-resize pixel position
// while the marker itself jumped to its new fullscreen location. Fixed by
// keying the recompute effect off `trackWidth` too (the same ResizeObserver
// already used for mobile marker sizing fires on any track resize, fullscreen
// toggle included). This regression-tests the mechanism directly: resizing the
// observed track must trigger a fresh getBoundingClientRect() read.
describe('ClipRegionLayer — tooltip repositions on track resize (T10391)', () => {
  let resizeCallback;

  beforeEach(() => {
    resizeCallback = null;
    global.ResizeObserver = class {
      constructor(cb) {
        resizeCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('recomputes the selected marker\'s anchor rect when the track resizes', () => {
    const regions = [
      { id: 'a', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: true },
    ];
    render(
      <ClipRegionLayer
        regions={regions}
        duration={100}
        selectedRegionId="a"
        onSelectRegion={() => {}}
      />,
    );
    expect(resizeCallback).toBeTruthy();

    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const callsBefore = rectSpy.mock.calls.length;

    // Simulate the track resizing — the same thing that happens when Annotate
    // toggles fullscreen (the video/timeline container's width changes).
    act(() => {
      resizeCallback([{ contentRect: { width: 900 } }]);
    });

    expect(rectSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    rectSpy.mockRestore();
  });
});

// T10510: same staleness mechanism as T10391, but for scroll instead of
// resize — reported live ("I scrolled but the tooltip didn't move relative
// to the screen"). Scrolling any ancestor (page, fullscreen strip, sidebar)
// moves the marker in the viewport without touching activeRegionId/regions/
// duration/trackWidth, so the recompute effect never re-fires. Fixed with a
// capture-phase `scroll` listener on window, which sees a scroll fired on
// any descendant container even though scroll events don't bubble.
describe('ClipRegionLayer — tooltip repositions on scroll (T10510)', () => {
  it('recomputes the selected marker\'s anchor rect when any ancestor scrolls', () => {
    const regions = [
      { id: 'a', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: true },
    ];
    render(
      <ClipRegionLayer
        regions={regions}
        duration={100}
        selectedRegionId="a"
        onSelectRegion={() => {}}
      />,
    );

    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const callsBefore = rectSpy.mock.calls.length;

    // A scroll fired on ANY element (not just window) — capture-phase
    // listeners see it travel down from window regardless of the target.
    act(() => {
      document.body.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(rectSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    rectSpy.mockRestore();
  });

  it('does not attach a scroll listener when no marker is active', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    render(
      <ClipRegionLayer regions={[]} duration={100} onSelectRegion={() => {}} />,
    );
    expect(addSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(false);
    addSpy.mockRestore();
  });
});
