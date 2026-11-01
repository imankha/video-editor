import { API_BASE } from '../config';
import apiFetch from './apiFetch';

/**
 * Fetch a reel download (T14170). Asks the backend where the composed+stamped
 * file lives (`GET /downloads/{id}/file-url`), then fetches it straight from
 * R2 via the presigned URL -- no bytes through the API machine, and R2 sends a
 * real Content-Length. With local storage (R2 off) the backend answers
 * `proxied` and the streaming `/file` endpoint serves it instead.
 *
 * Returns `{ response, filename }` (an ok Response whose body is the MP4).
 * Throws on any failure -- every caller must catch.
 * @param {number} downloadId - final_videos id
 */
export async function fetchReelDownload(downloadId) {
  const resp = await apiFetch(`${API_BASE}/api/downloads/${downloadId}/file-url`);
  if (!resp.ok) {
    throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  }
  const { url, filename, proxied } = await resp.json();
  const response = proxied
    ? await apiFetch(`${API_BASE}/api/downloads/${downloadId}/file`)
    // Presigned R2 URL: cross-origin, authorized by its signature, never cookies.
    : await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  return { response, filename };
}
