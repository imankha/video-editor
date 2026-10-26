import { describe, it, expect } from 'vitest';
import { pickNearestCenterRegion, overlayRegionAtPlayhead } from './regionAtTime';

describe('pickNearestCenterRegion', () => {
  it('returns null when there are no candidates', () => {
    expect(pickNearestCenterRegion([], 10)).toBeNull();
  });

  it('returns the only candidate when there is one', () => {
    const region = { id: 'a', startTime: 5, endTime: 15 };
    expect(pickNearestCenterRegion([region], 10)).toBe(region);
  });

  it('picks whichever candidate center is closest to the query time', () => {
    // center 10                     center 10.5
    const a = { id: 'a', startTime: 0, endTime: 20 };
    const b = { id: 'b', startTime: 9, endTime: 12 };
    expect(pickNearestCenterRegion([a, b], 10)).toBe(a);
    expect(pickNearestCenterRegion([a, b], 10.4)).toBe(b);
  });

  it('is order-independent (not first-array-order)', () => {
    const near = { id: 'near', startTime: 8, endTime: 9 }; // center 8.5
    const far = { id: 'far', startTime: 0, endTime: 20 }; // center 10
    // `far` sorts first in the array but `near`'s center is closer to time=8.6
    expect(pickNearestCenterRegion([far, near], 8.6)).toBe(near);
    expect(pickNearestCenterRegion([near, far], 8.6)).toBe(near);
  });

  it('breaks an equal-distance tie in favor of the shorter (more specific) span', () => {
    const wide = { id: 'wide', startTime: 0, endTime: 20 }; // center 10
    const tight = { id: 'tight', startTime: 5, endTime: 15 }; // center 10
    expect(pickNearestCenterRegion([wide, tight], 10)).toBe(tight);
    expect(pickNearestCenterRegion([tight, wide], 10)).toBe(tight);
  });
});

// T13480: the on-video play card follows the PLAYHEAD, not the selection.

describe('overlayRegionAtPlayhead', () => {
  const first = { id: 'a', startTime: 4, endTime: 20 };
  const second = { id: 'b', startTime: 40, endTime: 60 };

  it('is null when the selected play starts after the playhead (opening a game at 0:00)', () => {
    expect(overlayRegionAtPlayhead(first, null, 0)).toBeNull();
  });

  it('shows the selected play while the playhead is inside it', () => {
    expect(overlayRegionAtPlayhead(first, null, 10)).toBe(first);
  });

  it('falls back to the play under the playhead when the selection is elsewhere', () => {
    expect(overlayRegionAtPlayhead(first, second, 45)).toBe(second);
  });

  it('is null when nothing is under the playhead and the selection is elsewhere', () => {
    expect(overlayRegionAtPlayhead(first, null, 30)).toBeNull();
  });

  it('tolerates a frame-snapped seek just outside the selected play', () => {
    expect(overlayRegionAtPlayhead(first, null, 3.9)).toBe(first);
  });
});
