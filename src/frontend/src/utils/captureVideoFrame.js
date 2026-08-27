/**
 * captureVideoFrame - grab a single frame from a LOCAL video File as a JPEG data URL.
 *
 * T7820: gives an in-progress upload tile a real thumbnail with ZERO backend work —
 * the File is already in the browser. Object URL -> offscreen <video> -> seek ~1s
 * (clamped to duration) -> canvas.drawImage -> toDataURL('image/jpeg', 0.7).
 *
 * MEMORY-ONLY and cosmetic: the result lives on the uploadStore entry for the tile
 * and is NEVER persisted (no DB/R2/localStorage write — it is gone on reload, which
 * is correct because upload state itself is). Any failure (unsupported codec, no 2d
 * context, jsdom) resolves to null SILENTLY — the tile falls back to the branded
 * sport-ball art. Never throws, never toasts.
 */

const SEEK_SECONDS = 1;
const JPEG_QUALITY = 0.7;
// Safety valve so a video element that never fires loadedmetadata/seeked/error
// (broken container) can't leak the object URL forever.
const CAPTURE_TIMEOUT_MS = 15000;

/**
 * @param {File|null} file - the local video file being uploaded
 * @returns {Promise<string|null>} JPEG data URL, or null on ANY failure
 */
export async function captureVideoFrame(file) {
  if (!file) return null;
  let objectUrl = null;
  let video = null;
  let timeoutId = null;
  try {
    objectUrl = URL.createObjectURL(file);
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    return await new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      timeoutId = setTimeout(() => settle(null), CAPTURE_TIMEOUT_MS);
      video.onerror = () => settle(null);
      video.onloadedmetadata = () => {
        try {
          const duration = video.duration;
          const target = Number.isFinite(duration) && duration > 0
            ? Math.min(SEEK_SECONDS, duration)
            : 0;
          video.onseeked = () => {
            try {
              const width = video.videoWidth;
              const height = video.videoHeight;
              if (!width || !height) return settle(null);
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) return settle(null);
              ctx.drawImage(video, 0, 0, width, height);
              settle(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            } catch {
              settle(null);
            }
          };
          video.currentTime = target;
        } catch {
          settle(null);
        }
      };
      video.src = objectUrl;
    });
  } catch {
    // e.g. URL.createObjectURL unavailable (jsdom) — cosmetic feature, stay silent.
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (video) {
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onseeked = null;
      try {
        video.removeAttribute('src');
        video.load?.();
      } catch { /* teardown only */ }
    }
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch { /* teardown only */ }
    }
  }
}
