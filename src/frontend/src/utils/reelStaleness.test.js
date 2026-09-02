import { describe, it, expect } from 'vitest';
import { isClipStale, staleClipCount } from './reelStaleness';

const producedClip = (overrides = {}) => ({
  id: 1,
  start_time: 10,
  end_time: 20,
  reel_source_start_time: 10,
  reel_source_end_time: 20,
  ...overrides,
});

describe('isClipStale', () => {
  it('is false when live boundaries exactly match the reel snapshot', () => {
    expect(isClipStale(producedClip())).toBe(false);
  });

  it('is true when start_time drifted from the snapshot', () => {
    expect(isClipStale(producedClip({ start_time: 11 }))).toBe(true);
  });

  it('is true when end_time drifted from the snapshot', () => {
    expect(isClipStale(producedClip({ end_time: 21 }))).toBe(true);
  });

  it('is false when the reel snapshot is NULL (never produced)', () => {
    expect(isClipStale(producedClip({ reel_source_start_time: null, reel_source_end_time: null }))).toBe(false);
  });

  it('is false when only one snapshot field is NULL', () => {
    expect(isClipStale(producedClip({ reel_source_start_time: null }))).toBe(false);
  });

  it('uses strict equality, not epsilon comparison', () => {
    expect(isClipStale(producedClip({ start_time: 10.0000001 }))).toBe(true);
  });

  it('clears when boundaries are reverted to the exact producing values', () => {
    const drifted = producedClip({ start_time: 12 });
    expect(isClipStale(drifted)).toBe(true);
    const reverted = { ...drifted, start_time: 10 };
    expect(isClipStale(reverted)).toBe(false);
  });
});

describe('staleClipCount', () => {
  it('is 0 for an empty or undefined clip list', () => {
    expect(staleClipCount([])).toBe(0);
    expect(staleClipCount()).toBe(0);
  });

  it('counts only the clips that are individually stale', () => {
    const clips = [
      producedClip({ id: 1 }),
      producedClip({ id: 2, start_time: 99 }),
      producedClip({ id: 3, reel_source_start_time: null, reel_source_end_time: null }),
      producedClip({ id: 4, end_time: 999 }),
    ];
    expect(staleClipCount(clips)).toBe(2);
  });
});
