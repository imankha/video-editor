import apiFetch from './apiFetch';
import { API_BASE } from '../config';

/**
 * T8390 — resolves a playable URL for a just-exported working video when only
 * the project pointer is available (no in-memory blob) — e.g. Focus's
 * post-export preview on the server-authoritative export path. Reuses the
 * SAME presigned-R2 endpoint OverlayScreen's working-video loader calls
 * (OverlayScreen.jsx ~L465, T5642 — presigned so it works cross-origin
 * without the session cookie). One-shot, no retry: unlike OverlayScreen's
 * editing canvas, a failed fetch here just means the preview doesn't
 * populate — the caller degrades gracefully, never throws.
 *
 * @param {number} projectId
 * @returns {Promise<string|null>} the presigned URL, or null on any failure
 */
export async function resolveWorkingVideoPreviewUrl(projectId) {
  try {
    const response = await apiFetch(`${API_BASE}/api/projects/${projectId}/working_video/playback-url`);
    if (!response.ok) {
      console.warn('[resolveWorkingVideoPreviewUrl] Could not load working video preview URL:', response.status);
      return null;
    }
    const { url } = await response.json();
    return url || null;
  } catch (err) {
    console.warn('[resolveWorkingVideoPreviewUrl] Failed to fetch working video preview URL:', err.message);
    return null;
  }
}
