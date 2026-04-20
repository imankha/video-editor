/**
 * Application configuration
 *
 * API_BASE: The base URL for API calls
 * - Dev: empty string — Vite's proxy forwards /api/* to localhost backend
 * - Staging/Prod: set VITE_API_BASE at build time to the backend URL
 *
 * Usage:
 *   import { API_BASE } from './config';
 *   fetch(`${API_BASE}/api/health`)
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '';

// T1650: Feature gate for "Report a problem" button. Defaults to enabled;
// set VITE_ENABLE_PROBLEM_REPORT=false to hide it.
export const ENABLE_PROBLEM_REPORT = import.meta.env.VITE_ENABLE_PROBLEM_REPORT !== 'false';

/**
 * Resolve a backend-returned URL to one the browser can fetch directly.
 *
 * Some backend endpoints return relative paths like `/api/projects/1/working_video/stream`.
 * In dev the frontend and backend share an origin (Vite proxy), so a relative path works.
 * In staging/prod the frontend is served from a separate Cloudflare Pages domain whose SPA
 * catch-all (`_redirects: /* /index.html 200`) swallows relative `/api/...` fetches and
 * returns index.html — which then fails MP4 parsing with "No ftyp box at byte 4".
 *
 * Prepending API_BASE to relative `/api/...` paths routes them to the backend in every env.
 * Absolute URLs (presigned R2, http/https) are returned unchanged.
 */
export function resolveApiUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}
