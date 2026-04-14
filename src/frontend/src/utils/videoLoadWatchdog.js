/**
 * T1400: Range-fallback watchdog.
 *
 * When the <video> element is asked to play an 8-second clip from a 90-minute
 * source but ends up buffering thousands of seconds of media-time, the range
 * request silently degraded into a full-file fetch (opaque 200 vs 206, moov
 * at end forcing a seek-fetch, etc.). Today that only shows up as a slow
 * cold load — there's no signal explaining *why*. This watchdog emits one
 * structured warning per load when buffered-to-clip ratio crosses a
 * threshold.
 *
 * Pure function so it's unit-testable without mounting useVideo.
 */

export const RANGE_FALLBACK_RATIO = 3;

/**
 * Decide whether to warn about range-fallback.
 * @param {Object} args
 * @param {number} args.bufferedSec - current buffered end (0 if none)
 * @param {number|null} args.clipDurationSec - expected clip duration; null when unknown
 * @param {number} args.readyState - HTMLMediaElement.readyState
 * @returns {null | { bufferedSec, clipDurationSec, ratio }}
 */
export function checkRangeFallback({ bufferedSec, clipDurationSec, readyState, ignoreReadyState = false }) {
  // If clip duration is unknown we can't compare — skip.
  if (!clipDurationSec || clipDurationSec <= 0) return null;
  // By default, skip the check once video is playable (the 5s watchdog is
  // for "still not playable, but way overbuffered" — the slow-load case).
  // Callers running the check AT loadeddata pass ignoreReadyState=true because
  // a fast load can still overbuffer massively (T1430): e.g., 2152s buffered
  // for an 8s clip despite a clean 206 range response.
  if (!ignoreReadyState && readyState >= 3) return null;
  const ratio = bufferedSec / clipDurationSec;
  if (ratio <= RANGE_FALLBACK_RATIO) return null;
  return { bufferedSec, clipDurationSec, ratio };
}
