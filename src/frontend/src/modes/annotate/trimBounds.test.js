import { describe, it, expect } from 'vitest';
import { clampTrim, clampToVisibleWindow, MIN_REGION_DURATION } from './trimBounds';

describe('clampTrim (T9480 -- the one trim-bounds policy, AC4)', () => {
  it('passes the start value through unclamped when it is within bounds', () => {
    const r = clampTrim({ start: 10, end: 20, edge: 'start', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBe(10);
    expect(r.clamped).toBe(false);
    expect(r.message).toBeNull();
  });

  it('honors MIN_REGION_DURATION (0.5)', () => {
    expect(MIN_REGION_DURATION).toBe(0.5);
  });

  it('clamps the start handle to end - MIN when dragged past the end (reject end <= start)', () => {
    const r = clampTrim({ start: 19.8, end: 20, edge: 'start', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBeCloseTo(19.5, 5);
    expect(r.clamped).toBe(true);
    expect(r.message).toMatch(/before the end/);
    expect(r.rejected).toBe(false);
  });

  it('clamps the end handle to start + MIN when dragged past the start', () => {
    const r = clampTrim({ start: 10, end: 10.2, edge: 'end', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBeCloseTo(10.5, 5);
    expect(r.clamped).toBe(true);
    expect(r.message).toMatch(/after the start/);
  });

  it('clamps to the true media start, not the visible window', () => {
    // start dragged to -5, media begins at 0
    const r = clampTrim({ start: -5, end: 20, edge: 'start', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBe(0);
    expect(r.clamped).toBe(true);
    expect(r.message).toMatch(/before the start of the video/);
  });

  it('clamps to the true media end, not the visible window', () => {
    const r = clampTrim({ start: 10, end: 150, edge: 'end', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBe(100);
    expect(r.clamped).toBe(true);
    expect(r.message).toMatch(/past the end of the video/);
  });

  it('never swaps start/end -- clamped start always stays before end', () => {
    const r = clampTrim({ start: 19.999, end: 20, edge: 'start', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBeLessThan(20);
  });

  it('the true media bound always wins last, even over the min-duration invariant', () => {
    // Dragged the end handle well past mediaEnd -- the hard media bound (100)
    // wins, even though that leaves a sub-MIN 0.3s span near the clip's edge.
    const r = clampTrim({ start: 99.7, end: 150, edge: 'end', mediaStart: 0, mediaEnd: 100 });
    expect(r.value).toBe(100);
    expect(r.message).toMatch(/past the end of the video/);
  });

  it('rejects (dev assertion) only in the structurally-unreachable case of media bounds coinciding with the other handle', () => {
    // Degenerate state: mediaEnd sits AT the current start, so no end value
    // can produce a positive span. Never reachable through normal editing.
    const r = clampTrim({ start: 50, end: 60, edge: 'end', mediaStart: 0, mediaEnd: 50 });
    expect(r.rejected).toBe(true);
    expect(r.message).toBeNull();
  });

  it('throws on an invalid edge (programmer error, not a user-facing case)', () => {
    expect(() => clampTrim({ start: 0, end: 1, edge: 'middle', mediaEnd: 10 })).toThrow();
  });
});

describe('clampToVisibleWindow (T9480 -- view constraint, drag-only)', () => {
  it('floors the start handle at the visible window start', () => {
    expect(clampToVisibleWindow({ value: 5, edge: 'start', windowStart: 10, windowEnd: 70 })).toBe(10);
  });

  it('does not raise a start value already inside the window', () => {
    expect(clampToVisibleWindow({ value: 15, edge: 'start', windowStart: 10, windowEnd: 70 })).toBe(15);
  });

  it('ceils the end handle at the visible window end', () => {
    expect(clampToVisibleWindow({ value: 90, edge: 'end', windowStart: 10, windowEnd: 70 })).toBe(70);
  });

  it('does not lower an end value already inside the window', () => {
    expect(clampToVisibleWindow({ value: 65, edge: 'end', windowStart: 10, windowEnd: 70 })).toBe(65);
  });
});
