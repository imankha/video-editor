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

// T10810: a marker's bounding rect ignores clipping. With the track zoomed and
// scrolled (mobile 3x since T10780), a selected marker that has scrolled out of
// the `.timeline-scroll-container` viewport -- or sits under the opaque lane
// label column -- still reports a screen position, so the portalled tooltip
// kept rendering at the left edge of the phone with no marker under it.
describe('ClipRegionLayer — tooltip hides while the marker is scrolled out of view (T10810)', () => {
  const regions = [
    { id: 'a', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: true },
  ];

  function renderInScroller() {
    const scroller = document.createElement('div');
    scroller.className = 'timeline-scroll-container';
    document.body.appendChild(scroller);
    const utils = render(
      <ClipRegionLayer regions={regions} duration={100} selectedRegionId="a" onSelectRegion={() => {}} />,
      { container: scroller },
    );
    return { scroller, ...utils };
  }

  // jsdom has no layout: fake the scroller's viewport at x=200..600 and put the
  // marker's center wherever the test needs it.
  function stubRects(scroller, markerLeft) {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this === scroller) return { left: 200, right: 600, top: 0, bottom: 48, width: 400, height: 48 };
      if (this.classList?.contains('clip-marker')) {
        return { left: markerLeft, right: markerLeft + 24, top: 10, bottom: 34, width: 24, height: 24 };
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    });
  }

  it('renders the tooltip when the marker is inside the scroll viewport', () => {
    const { scroller, unmount } = renderInScroller();
    const spy = stubRects(scroller, 300);
    act(() => { document.body.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('[data-testid="clip-marker-tooltip"]')).not.toBeNull();
    spy.mockRestore();
    unmount();
    scroller.remove();
  });

  it('hides the tooltip when the marker has scrolled left of the viewport (under the lane label)', () => {
    const { scroller, unmount } = renderInScroller();
    const spy = stubRects(scroller, 100);
    act(() => { document.body.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('[data-testid="clip-marker-tooltip"]')).toBeNull();
    spy.mockRestore();
    unmount();
    scroller.remove();
  });

  it('hides the tooltip when the marker has scrolled right of the viewport', () => {
    const { scroller, unmount } = renderInScroller();
    const spy = stubRects(scroller, 700);
    act(() => { document.body.dispatchEvent(new Event('scroll')); });
    expect(document.querySelector('[data-testid="clip-marker-tooltip"]')).toBeNull();
    spy.mockRestore();
    unmount();
    scroller.remove();
  });
});
