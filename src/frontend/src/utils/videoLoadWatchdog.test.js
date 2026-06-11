import { describe, it, expect } from 'vitest';
import {
  checkRangeFallback,
  getTotalBufferedSec,
  RANGE_FALLBACK_RATIO,
  RANGE_FALLBACK_MIN_BUFFERED_SEC,
} from './videoLoadWatchdog';

describe('videoLoadWatchdog.checkRangeFallback', () => {
  it('returns payload when buffered > 3x clip duration and not yet playable', () => {
    // Real observed case: 8s clip, player downloaded 2152s, readyState HAVE_METADATA (1)
    const result = checkRangeFallback({
      bufferedSec: 2152,
      clipDurationSec: 8,
      readyState: 1,
    });
    expect(result).not.toBeNull();
    expect(result.bufferedSec).toBe(2152);
    expect(result.clipDurationSec).toBe(8);
    expect(result.ratio).toBeGreaterThan(RANGE_FALLBACK_RATIO);
  });

  it('returns null when ratio is at or below threshold', () => {
    // 24s buffered for 8s clip = ratio 3 exactly — not over threshold
    expect(
      checkRangeFallback({ bufferedSec: 24, clipDurationSec: 8, readyState: 1 })
    ).toBeNull();
  });

  it('returns null when buffered amount is within normal readahead', () => {
    // Real observed false positive: 7s clip near the end of a 90-min game,
    // Chrome readahead buffered 53s (ratio 7.5) on a healthy 206 load.
    expect(
      checkRangeFallback({ bufferedSec: 53.4, clipDurationSec: 7.09, readyState: 1 })
    ).toBeNull();
    // Just over the floor with high ratio → flags
    expect(
      checkRangeFallback({
        bufferedSec: RANGE_FALLBACK_MIN_BUFFERED_SEC + 1,
        clipDurationSec: 7.09,
        readyState: 1,
      })
    ).not.toBeNull();
  });

  it('returns null when clip duration is unknown', () => {
    expect(
      checkRangeFallback({ bufferedSec: 2152, clipDurationSec: null, readyState: 1 })
    ).toBeNull();
    expect(
      checkRangeFallback({ bufferedSec: 2152, clipDurationSec: 0, readyState: 1 })
    ).toBeNull();
  });

  it('returns null when video is already playable (readyState >= HAVE_FUTURE_DATA)', () => {
    // Default (watchdog path): if the load completed in time, there's no
    // slow-load fallback to flag regardless of buffered amount.
    expect(
      checkRangeFallback({ bufferedSec: 2152, clipDurationSec: 8, readyState: 3 })
    ).toBeNull();
    expect(
      checkRangeFallback({ bufferedSec: 2152, clipDurationSec: 8, readyState: 4 })
    ).toBeNull();
  });

  it('with ignoreReadyState=true, flags overbuffer even on a fast playable load', () => {
    // At-playable check: fast load can still overbuffer massively (T1430).
    // Real observed case: 1.8s load, 2152s buffered, readyState=4.
    const result = checkRangeFallback({
      bufferedSec: 2152,
      clipDurationSec: 8,
      readyState: 4,
      ignoreReadyState: true,
    });
    expect(result).not.toBeNull();
    expect(result.ratio).toBeGreaterThan(RANGE_FALLBACK_RATIO);
  });

  it('returns null when nothing has buffered yet', () => {
    expect(
      checkRangeFallback({ bufferedSec: 0, clipDurationSec: 8, readyState: 1 })
    ).toBeNull();
  });
});

describe('videoLoadWatchdog.getTotalBufferedSec', () => {
  const makeRanges = (pairs) => ({
    length: pairs.length,
    start: (i) => pairs[i][0],
    end: (i) => pairs[i][1],
  });

  it('sums range lengths instead of reporting the last range end', () => {
    // Clip near the end of a long source: ranges [0,1] + [5281,5334.7].
    // buffered.end(last) would report 5334.7; actual download is ~54.7s.
    const ranges = makeRanges([[0, 1], [5281, 5334.7]]);
    expect(getTotalBufferedSec(ranges)).toBeCloseTo(54.7, 1);
  });

  it('returns 0 for empty or missing ranges', () => {
    expect(getTotalBufferedSec(makeRanges([]))).toBe(0);
    expect(getTotalBufferedSec(null)).toBe(0);
    expect(getTotalBufferedSec(undefined)).toBe(0);
  });
});
