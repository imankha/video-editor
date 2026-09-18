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
