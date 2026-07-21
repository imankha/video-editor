/**
 * Client -> server beacon for browser video playback failures (T5641).
 *
 * The Framing/Overlay <video> streams its source straight from R2 via a
 * presigned URL, so when the browser's media pipeline rejects a (valid) file
 * with MEDIA_ERR_SRC_NOT_SUPPORTED, the SERVER never sees it — the failure only
 * lands in the user's console. Once useVideo.js exhausts its format-error
 * retries, it fire-and-forgets the captured diagnostic here so the failure is
 * visible in server logs (and our log tooling), not just the console.
 */
import { API_BASE } from '../config';
import apiFetch from './apiFetch';

/**
 * Strip the query string (the presigned SIGNATURE) from a video URL, leaving
 * only the path — enough to identify the clip/project in logs without leaking
 * R2 credentials. Returns null for empty input, 'blob' for blob URLs.
 */
export function stripUrlSignature(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('blob:')) return 'blob';
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split('?')[0].slice(0, 200);
  }
}

/**
 * Fire-and-forget POST of a video-error diagnostic. Never throws and never
 * rejects to the caller — telemetry must never break the error-handling path.
 * `keepalive` lets it survive a navigation triggered right after the failure.
 */
export function reportVideoError(payload) {
  try {
    apiFetch(`${API_BASE}/api/client-errors/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }),
      keepalive: true,
    }).catch(() => { /* fire-and-forget */ });
  } catch { /* never let telemetry break playback error handling */ }
}
