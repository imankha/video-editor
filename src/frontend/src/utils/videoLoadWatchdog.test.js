import { describe, it, expect } from 'vitest';
import { checkRangeFallback, RANGE_FALLBACK_RATIO } from './videoLoadWatchdog';

describe('videoLoadWatchdog.checkRangeFallback', () => {
  it('returns payload when buffered > 3x clip duration and not yet playable', () => {
    // Real observed case: 8s clip, player buffered 2152s, readyState HAVE_METADATA (1)
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
