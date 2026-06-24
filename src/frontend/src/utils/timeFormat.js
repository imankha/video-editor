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
