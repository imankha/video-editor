/**
 * Time formatting utilities for video editor
 */

/**
 * Format seconds to HH:MM:SS.mmm
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted string
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return '00:00:00.000';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Format seconds to MM:SS.mmm (simpler format with milliseconds)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted string
 */
export function formatTimeSimple(seconds) {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00.000';
  }

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  const ss = String(secs).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');

  return `${minutes}:${ss}.${mmm}`;
}

export function formatTimeCompact(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0.0';
  return seconds.toFixed(1);
}

/**
 * Format seconds to clock notation M:SS (or H:MM:SS past an hour) for player
 * time displays — e.g. 62.3 -> "1:02". No decimals, unlike formatTimeCompact.
 */
export function formatClock(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Soccer game-clock notation: MM'SS" from a clip's unified in-match start (T3920).
 *
 * True elapsed time, NOT the "Nth minute" floor()+1 form used for minute-only
 * displays (e.g. rank.py _minute()): with seconds shown, 2325s must read 38'45",
 * so the minute is floor(sec/60) (38) and would be wrong as 39'. For two-half
 * games the caller passes the already-unified game seconds (2nd-half offset baked
 * in by the backend), so this is a pure format.
 *
 * @param {number|null|undefined} seconds - unified in-match start in seconds
 * @returns {string|null} e.g. "38'45\"", or null when unknown (no card mark)
 */
export function formatGameClock(seconds) {
  if (seconds == null || isNaN(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}'${String(secs).padStart(2, '0')}"`;
}

/**
 * Soccer game-clock (MM'SS") for a clip region's in-match START (T4080).
 *
 * Extracted from AnnotateModeView's inline gameClockFor (T4070) so the annotation
 * clip lists and the playback banner share one definition. The in-match start is
 * the clip's file-relative start plus the offset of any prior video halves. Two
 * start representations reach this helper:
 *   - "virtual" regions (AnnotateScreen's virtualClipRegions) bake the prior-half
 *     offset into `startTime` and stash the file-relative value in `_actualStartTime`.
 *   - raw regions (e.g. getRegionAtTimeUnified) carry the file-relative `startTime`.
 * Reading `_actualStartTime ?? startTime` always yields the file-relative start, so
 * adding boundaryOffsets[seq-2] applies the half offset exactly once for both.
 *
 * @param {object|null} clip - clip/region with startTime (+ optional _actualStartTime, videoSequence)
 * @param {number[]=} boundaryOffsets - per-half virtual starts; empty/absent for single-video games
 * @returns {string|null} e.g. "38'45\"", or null when the start is unknown
 */
export function clipGameClock(clip, boundaryOffsets) {
  if (!clip) return null;
  const fileRelativeStart = clip._actualStartTime ?? clip.startTime;
  if (fileRelativeStart == null) return null;
  const seq = clip.videoSequence ?? 1;
  const halfOffset = seq >= 2 && boundaryOffsets?.length ? (boundaryOffsets[seq - 2] ?? 0) : 0;
  return formatGameClock(fileRelativeStart + halfOffset);
}

/**
 * Comparator for sorting clips/reels by their in-match start time in seconds,
 * with unknown (null) starts sorted last (T4080). Keeps reels under a game in
 * Clips and My Reels in the same order as the annotation clip list.
 *
 * @param {number|null|undefined} a - in-match start seconds (e.g. clip_game_start_time)
 * @param {number|null|undefined} b - in-match start seconds
 * @returns {number} negative if a before b, positive if after, 0 if equal
 */
export function compareGameTime(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

// ---------------------------------------------------------------------------
// T9480 -- THE one time-format rule.
//
// A time value is either an INSTANT (a position on a timeline) or a LENGTH
// (a span). Instants FLOOR at the shown precision -- a clock must never show
// a moment that hasn't happened yet. Lengths ROUND HALF-UP at the shown
// precision, matching the backend's `round_credits_half_up` (highlight_
// transform.py) exactly, so a whole-second length reads as the billed
// second count. See docs/plans/tasks/T9480-design.md section 2.1-2.2.
// ---------------------------------------------------------------------------

export const PRECISION = { SECOND: 0, TENTH: 1, MILLI: 3 };

/**
 * Round-half-up at `decimals` places. The ONE rounding mode for lengths;
 * matches the backend's `round_credits_half_up`'s `floor(x + 0.5)` idiom
 * exactly (an exact .5 always rounds up), not `Math.round` (which agrees for
 * positive values but diverges on negatives -- irrelevant here since every
 * real duration is non-negative).
 */
export function roundHalfUp(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 0.5) / factor;
}

/**
 * An INSTANT (position). FLOORS at `precision` -- never emits ":60", because
 * the whole value is floored to `precision` BEFORE being split into
 * hours/minutes/seconds (rather than flooring each component independently).
 *
 * @param {number} seconds
 * @param {number} [precision] - PRECISION.SECOND | TENTH | MILLI
 * @param {{hours?: 'auto'|'always'|'never'}} [opts]
 * @returns {string|null} null (+ console.warn) on non-finite/negative input --
 *   no silent fallback; callers that legitimately have "no value yet" handle
 *   null explicitly (same contract as formatGameClock).
 */
export function formatInstant(seconds, precision = PRECISION.SECOND, opts = {}) {
  const { hours = 'auto' } = opts;
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.warn(`formatInstant: non-finite or negative input (${seconds})`);
    return null;
  }

  const factor = 10 ** precision;
  const floored = Math.floor(seconds * factor) / factor;
  const totalWhole = Math.floor(floored);
  const h = Math.floor(totalWhole / 3600);
  const m = Math.floor((totalWhole % 3600) / 60);
  const s = totalWhole % 60;
  const frac = floored - totalWhole;

  const secWhole = String(s).padStart(2, '0');
  const secondsStr = precision === PRECISION.SECOND
    ? secWhole
    : `${secWhole}.${frac.toFixed(precision).slice(2)}`;

  const showHours = hours === 'always' || (hours === 'auto' && h > 0);
  if (showHours) {
    return `${h}:${String(m).padStart(2, '0')}:${secondsStr}`;
  }
  return `${m}:${secondsStr}`;
}

/**
 * A LENGTH (span). ROUNDS HALF-UP at `precision` -- the whole-second form is
 * the same rule the credit charge uses (see billingParity test).
 *
 * @param {number} seconds
 * @param {number} [precision] - PRECISION.SECOND | TENTH | MILLI
 * @param {{style?: 'unit'|'clock'|'human'|'plain'}} [opts]
 *   'unit'  (default) "6.0s"
 *   'clock' "0:06" / "1:02:03"
 *   'human' "1m 30s" / "1h 2m" / "30s"
 *   'plain' "6.0" -- the bare rounded number as a string, for numeric comparison
 * @returns {string|null} null (+ console.warn) on non-finite/negative input.
 */
export function formatLength(seconds, precision = PRECISION.TENTH, opts = {}) {
  const { style = 'unit' } = opts;
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.warn(`formatLength: non-finite or negative input (${seconds})`);
    return null;
  }

  const decimals = precision;
  const rounded = roundHalfUp(seconds, decimals);

  if (style === 'plain') {
    return rounded.toFixed(decimals);
  }
  if (style === 'unit') {
    return `${rounded.toFixed(decimals)}s`;
  }

  // 'clock' and 'human' render the whole-second count -- a rounded LENGTH is
  // read/billed in whole seconds once it takes clock/human form.
  const total = Math.round(rounded);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (style === 'clock') {
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (style === 'human') {
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }

  throw new Error(`formatLength: unknown style "${style}"`);
}

/**
 * Inverse of formatInstant. Accepts "H:MM:SS.s" | "M:SS.s" | "SS.s" | "SS".
 * Returns a Number, or null when unparseable -- NEVER 0 (a 0 would be
 * indistinguishable from a genuinely-typed zero; no silent fallback).
 */
export function parseTimeInput(text) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  if (trimmed === '') return null;

  // Bare seconds: "129.5" or "129"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // "H:MM:SS.s" or "M:SS.s" -- colon-separated, only the last part may carry a decimal
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;

  const nums = parts.map(Number);
  const seconds = nums.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1];

  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * UI_STEP_FPS is a chosen UI STEP GRANULARITY, not a measured source frame
 * rate. (We do not detect fps -- videoUtils.getFramerate is a hardcoded 30.)
 * It is the grid that drag, typed entry and the step buttons all snap to, so
 * all three produce values from the SAME set. Handy property: at 30 the
 * 0.1s entry precision is exactly 3 steps, so a typed tenth lands exactly on
 * the grid.
 */
export const UI_STEP_FPS = 30;

/** Quantize to the app's UI step grid (see UI_STEP_FPS). */
export function snapToStep(seconds) {
  if (!Number.isFinite(seconds)) return seconds;
  return Math.round(seconds * UI_STEP_FPS) / UI_STEP_FPS;
}

/**
 * Convert pixel position to time
 * @param {number} pixel - X coordinate relative to timeline
 * @param {number} duration - Total video duration in seconds
 * @param {number} timelineWidth - Timeline width in pixels
 * @returns {number} Time in seconds
 */
export function pixelToTime(pixel, duration, timelineWidth) {
  if (!timelineWidth || timelineWidth === 0) return 0;
  const time = (pixel / timelineWidth) * duration;
  return Math.max(0, Math.min(duration, time));
}

/**
 * Convert time to pixel position
 * @param {number} time - Time in seconds
 * @param {number} duration - Total video duration
 * @param {number} timelineWidth - Timeline width in pixels
 * @returns {number} Pixel position
 */
export function timeToPixel(time, duration, timelineWidth) {
  if (!duration || duration === 0) return 0;
  return (time / duration) * timelineWidth;
}

/**
 * Seek to exact frame boundary
 * @param {number} targetTime - Desired time in seconds
 * @param {number} framerate - Video framerate (fps)
 * @returns {number} Exact frame time
 */
export function seekToFrame(targetTime, framerate) {
  if (!framerate || framerate === 0) return targetTime;
  const frameDuration = 1 / framerate;
  const frameNumber = Math.round(targetTime / frameDuration);
  return frameNumber * frameDuration;
}
