import { describe, it, expect } from 'vitest';
import { formatGameClock, clipGameClock, compareGameTime } from './timeFormat';

describe('formatGameClock (T3920 soccer notation)', () => {
  it('formats exact zero as 0\'00"', () => {
    expect(formatGameClock(0)).toBe("0'00\"");
  });

  it('formats sub-minute with zero-padded seconds', () => {
    expect(formatGameClock(45)).toBe("0'45\"");
    expect(formatGameClock(5)).toBe("0'05\"");
  });

  it('formats an exact minute boundary', () => {
    expect(formatGameClock(60)).toBe("1'00\"");
  });

  it('uses TRUE elapsed minutes, not the Nth-minute +1 form', () => {
    // 2325s = 38m45s. The minute-only convention (floor+1) would say 39'; with
    // seconds shown the correct mark is 38'45".
    expect(formatGameClock(2325)).toBe("38'45\"");
  });

  it('formats a unified second-half time (offset already applied upstream)', () => {
    // 50m15s = 3015s — a 2nd-half clip whose first-half offset is baked in.
    expect(formatGameClock(3015)).toBe("50'15\"");
  });

  it('formats past 90 minutes without special-casing', () => {
    expect(formatGameClock(5430)).toBe("90'30\"");
  });

  it('floors fractional seconds', () => {
    expect(formatGameClock(38 * 60 + 45.9)).toBe("38'45\"");
  });

  it('returns null for unknown / missing values (no card mark)', () => {
    expect(formatGameClock(null)).toBeNull();
    expect(formatGameClock(undefined)).toBeNull();
    expect(formatGameClock(NaN)).toBeNull();
    expect(formatGameClock(-5)).toBeNull();
  });
});

describe('clipGameClock (T4080 shared in-match clock)', () => {
  it('single-video clip: formats startTime with no half offset', () => {
    expect(clipGameClock({ startTime: 754 }, [])).toBe("12'34\"");
  });

  it('first-half clip in a two-half game: no offset applied (seq 1)', () => {
    expect(clipGameClock({ startTime: 754, videoSequence: 1 }, [2700])).toBe("12'34\"");
  });

  it('second-half clip: adds the prior-half offset (boundaryOffsets[seq-2])', () => {
    // 2nd half clip 10s into the half, first half was 2700s -> 2710s in-match
    expect(clipGameClock({ startTime: 10, videoSequence: 2 }, [2700])).toBe("45'10\"");
  });

  it('virtual region: prefers _actualStartTime so the offset is not double-counted', () => {
    // virtualClipRegions bake the offset into startTime AND keep raw in _actualStartTime;
    // the helper must use the raw value (10) + offset (2700), not virtual (2710) + offset.
    expect(
      clipGameClock({ startTime: 2710, _actualStartTime: 10, videoSequence: 2 }, [2700]),
    ).toBe("45'10\"");
  });

  it('returns null for missing clip or missing start', () => {
    expect(clipGameClock(null, [])).toBeNull();
    expect(clipGameClock({ videoSequence: 1 }, [])).toBeNull();
  });

  it('treats a zero start (_actualStartTime 0) as valid, not missing', () => {
    expect(clipGameClock({ startTime: 2700, _actualStartTime: 0, videoSequence: 2 }, [2700]))
      .toBe("45'00\"");
  });
});

describe('compareGameTime (T4080 in-game ordering)', () => {
  it('orders ascending by seconds', () => {
    expect([300, 60, 180].sort(compareGameTime)).toEqual([60, 180, 300]);
  });

  it('sorts null/unknown starts last', () => {
    expect([null, 120, null, 30].sort(compareGameTime)).toEqual([30, 120, null, null]);
  });

  it('returns 0 when both are null', () => {
    expect(compareGameTime(null, null)).toBe(0);
  });
});
