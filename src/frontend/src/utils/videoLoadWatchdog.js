/**
 * T1400: Range-fallback watchdog.
 *
 * When the <video> element is asked to play an 8-second clip from a 90-minute
 * source but ends up downloading thousands of seconds of media-time, the range
 * request silently degraded into a full-file fetch (opaque 200 vs 206, moov
 * at end forcing a seek-fetch, etc.). Today that only shows up as a slow
 * cold load — there's no signal explaining *why*. This watchdog emits one
 * structured warning per load when buffered-to-clip ratio crosses a
 * threshold.
 *
 * bufferedSec must be the TOTAL buffered media-time (sum of range lengths,
 * see getTotalBufferedSec), NOT buffered.end(last): for a clip near the end
 * of the source, buffered.end(last) reports ~the full duration even when a
 * clean range request downloaded only a few seconds (observed: clip at
 * 5281s of a 5334s game flagged ratio=752 with ~54s actually downloaded).
 *
 * Pure function so it's unit-testable without mounting useVideo.
 */

export const RANGE_FALLBACK_RATIO = 3;

// Chrome's normal readahead buffers ~50-90s of media-time regardless of clip
// length, so a short clip legitimately exceeds the ratio on a healthy load.
// Only flag when the absolute downloaded media-time is beyond any readahead.
export const RANGE_FALLBACK_MIN_BUFFERED_SEC = 120;

/**
 * Total buffered media-time in seconds (sum of range lengths).
 * @param {TimeRanges|null|undefined} buffered - HTMLMediaElement.buffered
 * @returns {number}
 */
export function getTotalBufferedSec(buffered) {
  if (!buffered?.length) return 0;
  let total = 0;
  for (let i = 0; i < buffered.length; i++) {
    total += buffered.end(i) - buffered.start(i);
  }
  return total;
}

/**
 * Decide whether to warn about range-fallback.
 * @param {Object} args
 * @param {number} args.bufferedSec - total buffered media-time (0 if none)
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
  if (bufferedSec <= RANGE_FALLBACK_MIN_BUFFERED_SEC) return null;
  const ratio = bufferedSec / clipDurationSec;
  if (ratio <= RANGE_FALLBACK_RATIO) return null;
  return { bufferedSec, clipDurationSec, ratio };
}
