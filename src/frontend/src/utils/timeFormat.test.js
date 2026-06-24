import { describe, it, expect } from 'vitest';
import { formatGameClock } from './timeFormat';

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
