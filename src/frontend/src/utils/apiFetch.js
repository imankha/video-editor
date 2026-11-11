import { getColdBackendNote } from './coldBackendTracker';

// A request slower than this is treated as "slow" for the cold-backend note
// (T16060) -- matches the first-health-check threshold ConnectionStatus uses
// to decide the backend was cold.
const SLOW_REQUEST_MS = 2000;

export default async function apiFetch(url, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { credentials: 'include', ...options });
    _logColdBackendShaped(url, startedAt, !response.ok, response.status);
    return response;
  } catch (err) {
    _logColdBackendShaped(url, startedAt, true, null, err);
    throw err;
  }
}

function _logColdBackendShaped(url, startedAt, failed, status, err) {
  const elapsedMs = Date.now() - startedAt;
  if (!failed && elapsedMs < SLOW_REQUEST_MS) return;
  const note = getColdBackendNote(startedAt);
  if (!note) return;
  const reason = failed
    ? (err ? `network error: ${err.message}` : `status ${status}`)
    : `slow (${elapsedMs}ms)`;
  console.warn(`[apiFetch] ${url} ${reason} ${note}`);
}
