import { describe, it, expect } from 'vitest';
import {
  formatGameClock,
  clipGameClock,
  compareGameTime,
  PRECISION,
  roundHalfUp,
  formatInstant,
  formatLength,
  parseTimeInput,
  UI_STEP_FPS,
  snapToStep,
} from './timeFormat';

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

describe('roundHalfUp (T9480 the one rounding mode for lengths)', () => {
  it('rounds an exact .5 up, matching the backend floor(x+0.5) idiom', () => {
    expect(roundHalfUp(6.5)).toBe(7);
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it('rounds at a given decimal place', () => {
    expect(roundHalfUp(2.973, 1)).toBe(3);
    expect(roundHalfUp(6.027, 1)).toBe(6);
    expect(roundHalfUp(6.05, 1)).toBe(6.1);
  });

  it('floors below .5', () => {
    expect(roundHalfUp(6.49)).toBe(6);
  });
});

describe('formatInstant (T9480 -- INSTANTS floor)', () => {
  it('floors fractional seconds, never rounds', () => {
    expect(formatInstant(2.973, PRECISION.SECOND)).toBe('0:02');
    expect(formatInstant(2.973, PRECISION.TENTH)).toBe('0:02.9');
  });

  it('59.97 never renders ":60" at any precision -- the reported bug, fixed', () => {
    expect(formatInstant(59.97, PRECISION.SECOND)).toBe('0:59');
    expect(formatInstant(59.97, PRECISION.TENTH)).toBe('0:59.9');
    expect(formatInstant(59.97, PRECISION.MILLI)).toBe('0:59.970');
  });

  it('adds hours automatically past 3600s', () => {
    expect(formatInstant(3600, PRECISION.SECOND)).toBe('1:00:00');
    expect(formatInstant(3599.9, PRECISION.TENTH)).toBe('59:59.9');
  });

  it('opts.hours "always" forces the hour segment even under an hour', () => {
    expect(formatInstant(65, PRECISION.SECOND, { hours: 'always' })).toBe('0:01:05');
  });

  it('returns null (not a placeholder string) for non-finite/negative input', () => {
    expect(formatInstant(NaN)).toBeNull();
    expect(formatInstant(-1)).toBeNull();
    expect(formatInstant(Infinity)).toBeNull();
  });

  it('a whole-second instant matches the exact string a length would show at second precision', () => {
    // Applied case from the design doc: end 9.000 reads identically as instant or length
    expect(formatInstant(9, PRECISION.SECOND)).toBe('0:09');
  });
});

describe('formatLength (T9480 -- LENGTHS round-half-up, matching the credit rule)', () => {
  it('rounds half-up at the shown precision', () => {
    expect(formatLength(2.973, PRECISION.TENTH)).toBe('3.0s');
    expect(formatLength(6.027, PRECISION.TENTH)).toBe('6.0s');
  });

  it('whole-second rounding matches roundCreditsHalfUp exactly (the point of AC3)', () => {
    expect(formatLength(6.027, PRECISION.SECOND, { style: 'plain' })).toBe('6');
    expect(formatLength(6.5, PRECISION.SECOND, { style: 'plain' })).toBe('7');
  });

  it('style "clock" renders M:SS / H:MM:SS', () => {
    expect(formatLength(65, PRECISION.SECOND, { style: 'clock' })).toBe('1:05');
    expect(formatLength(3665, PRECISION.SECOND, { style: 'clock' })).toBe('1:01:05');
  });

  it('style "human" renders conversational copy', () => {
    expect(formatLength(90, PRECISION.SECOND, { style: 'human' })).toBe('1m 30s');
    expect(formatLength(30, PRECISION.SECOND, { style: 'human' })).toBe('30s');
  });

  it('returns null (not a placeholder string) for non-finite/negative input', () => {
    expect(formatLength(NaN)).toBeNull();
    expect(formatLength(-1)).toBeNull();
  });
});

describe('parseTimeInput (T9480 -- never returns 0 for garbage)', () => {
  it('parses bare seconds', () => {
    expect(parseTimeInput('129.5')).toBe(129.5);
    expect(parseTimeInput('6')).toBe(6);
  });

  it('parses M:SS.s and H:MM:SS.s', () => {
    expect(parseTimeInput('2:09.5')).toBe(129.5);
    expect(parseTimeInput('1:02:03')).toBe(3723);
  });

  it('round-trips with formatInstant at tenth precision', () => {
    const seconds = 129.5;
    const text = formatInstant(seconds, PRECISION.TENTH);
    expect(parseTimeInput(text)).toBeCloseTo(seconds, 5);
  });

  it('returns null, never 0, on garbage input', () => {
    expect(parseTimeInput('not a time')).toBeNull();
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput(null)).toBeNull();
    expect(parseTimeInput(undefined)).toBeNull();
    expect(parseTimeInput('1:2:3:4')).toBeNull();
  });

  it('a genuinely-typed zero parses to 0, distinguishable from garbage-> null', () => {
    expect(parseTimeInput('0')).toBe(0);
    expect(parseTimeInput('0:00')).toBe(0);
  });
});

describe('UI_STEP_FPS / snapToStep (T9480 -- one grid for drag, entry and steps)', () => {
  it('UI_STEP_FPS is 30, a chosen UI granularity (see comment for the fps-honesty rationale)', () => {
    expect(UI_STEP_FPS).toBe(30);
  });

  it('snaps to the nearest 1/30s step', () => {
    expect(snapToStep(2.973)).toBeCloseTo(2.9666666666666, 5);
  });

  it('a typed tenth lands exactly on the grid', () => {
    const snapped = snapToStep(2.9);
    expect(snapped * UI_STEP_FPS).toBeCloseTo(Math.round(snapped * UI_STEP_FPS), 10);
  });
});
