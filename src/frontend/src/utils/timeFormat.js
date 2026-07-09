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
 * Reel Drafts and My Reels in the same order as the annotation clip list.
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
