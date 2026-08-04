import { describe, it, expect } from 'vitest';
import { snapToBoundary } from './textSnapping';

/**
 * T5225 — Stage 3 (test-first). `utils/textSnapping.js` does not exist yet;
 * this test SPECIFIES the contract the Implementor must satisfy (design §3.2).
 *
 * Design intent (docs/plans/tasks/T5225-design.md §3.2):
 *   - Threshold is PIXEL-based, converted to time at drag time (zoom-invariant),
 *     mirroring the 15px click-to-add snap in RegionLayer.jsx:202-211.
 *   - Candidates = [0, ...clip_boundaries, totalDuration].
 *   - A drag ending within SNAP_PX (~10px) of a boundary reports that boundary's
 *     EXACT time (snap). Outside the threshold, reports the raw computed time
 *     (free park) so "first 3 seconds mid-clip" stays expressible.
 *
 * Proposed shape (our judgment, per the prompt): a pure function
 *   snapToBoundary(rawTime, boundaries, thresholdPx, pxPerSecond) -> number
 * decoupled from any DOM/pointer plumbing so it's trivially unit-testable and
 * shareable between TextLayer and (if useful) RegionLayer in future.
 */

const PX_PER_SECOND = 100; // e.g. a 1000px-wide 10s track
const SNAP_PX = 10;

describe('snapToBoundary - pure snapping math (T5225 design §3.2)', () => {
  it('snaps to the nearest boundary when within the pixel threshold', () => {
    const boundaries = [0, 4.1, 9.55, 12.0];
    // rawTime is 4.14s -> at 100px/s that's 0.4s = 40px from clip boundary in time,
    // but we want a case where the PIXEL distance is small: 4.1 + 5px-worth of time.
    const rawTime = 4.1 + (5 / PX_PER_SECOND); // 5px away from boundary 4.1
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    expect(result).toBe(4.1);
  });

  it('free-parks at the raw time when outside the pixel threshold', () => {
    const boundaries = [0, 4.1, 9.55, 12.0];
    // 30px away in time from the nearest boundary (4.1) -- outside SNAP_PX=10.
    const rawTime = 4.1 + (30 / PX_PER_SECOND);
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    expect(result).toBeCloseTo(rawTime, 5);
    expect(result).not.toBe(4.1);
  });

  it('snaps to reel start (0) when dragged near the beginning', () => {
    const boundaries = [0, 4.1, 9.55, 12.0];
    const rawTime = 3 / PX_PER_SECOND; // 3px from 0
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    expect(result).toBe(0);
  });

  it('snaps to reel end (totalDuration) when dragged near the end', () => {
    const boundaries = [0, 4.1, 9.55, 12.0];
    const rawTime = 12.0 - (2 / PX_PER_SECOND); // 2px from the end boundary
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    expect(result).toBe(12.0);
  });

  it('picks the NEAREST boundary when two candidates are both within threshold (degenerate/adjacent case)', () => {
    // Boundaries close enough together that a naive "first match wins" could pick wrong.
    const boundaries = [0, 5.0, 5.05, 12.0];
    const rawTime = 5.02;
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    // Nearest to 5.02 is 5.0 (0.02s = 2px away) vs 5.05 (0.03s = 3px away).
    expect(result).toBe(5.0);
  });

  it('exactly at the threshold boundary (inclusive) still snaps', () => {
    const boundaries = [0, 4.1, 9.55, 12.0];
    const rawTime = 4.1 + (SNAP_PX / PX_PER_SECOND); // exactly SNAP_PX away
    const result = snapToBoundary(rawTime, boundaries, SNAP_PX, PX_PER_SECOND);
    expect(result).toBe(4.1);
  });

  it('returns the raw time unchanged when there are no candidate boundaries', () => {
    const rawTime = 6.234;
    const result = snapToBoundary(rawTime, [], SNAP_PX, PX_PER_SECOND);
    expect(result).toBe(rawTime);
  });
});
