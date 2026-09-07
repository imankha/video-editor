/**
 * T8840 ui/format.js -- pure string formatting for humans. DOM code only imports
 * from here; pipeline/ never does (design §1.3 smell "reporting interleaved with
 * pipeline logic" -- the pipeline emits structured events, only this layer renders
 * strings).
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** "6.3 GB", "512 MB", "0 B". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const exp = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / 1024 ** exp;
  return `${exp === 0 ? value : value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[exp]}`;
}

/** "1h 32m", "45m", "38s" -- ETA/duration copy, never sub-second precision. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

/** "62%" */
export function formatPercent(done, total) {
  if (!total) return '0%';
  return `${Math.round((100 * done) / total)}%`;
}

/** "1.48x" */
export function formatMultiplier(multiplier) {
  return `${(Number(multiplier) || 0).toFixed(2)}x`;
}

/** "24.3 fps" */
export function formatFps(fps) {
  return `${(Number(fps) || 0).toFixed(1)} fps`;
}
