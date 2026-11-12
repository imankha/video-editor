/**
 * Tracks whether staging's backend is in (or just past) a cold start, so
 * request failures/slowness can carry a "staging was waking up" note instead
 * of reading like a real bug. Production never suspends, so this is always
 * inert there (T16060).
 *
 * Owned by ConnectionStatus.jsx (the only caller of recordHealthCheck, via its
 * startup health check); apiFetch.js reads it via getColdBackendNote on every
 * request's failure/slow path.
 */

import { API_BASE } from '../config';

// Staging's own Fly backend URL; production's is different. API_BASE is set
// at build time per environment -- comparing it here is the one gate; no
// call site should re-derive "is this production" from a hostname itself.
const PRODUCTION_API_BASE = 'https://reel-ballers-api.fly.dev';
const IS_PRODUCTION_BACKEND = API_BASE === PRODUCTION_API_BASE;

// A first health check slower than this (or outright failing) means the
// backend was cold, not just momentarily slow.
const COLD_START_THRESHOLD_MS = 2000;

// Requests that start up to this long after the backend became healthy still
// get the note -- a wake-up's in-flight request can fail/resolve slowly even
// after /api/health itself recovers.
const COLD_GRACE_MS = 15000;

let coldStartDetectedAt = null;
let backendColdUntil = null;
let healthyAfterMs = null;

/**
 * Report the outcome of a ConnectionStatus health check. Only the FIRST
 * check's own failure/slowness marks a cold start; later checks only matter
 * to detect when a previously-detected cold start became healthy.
 */
export function recordHealthCheck({ isFirstCheck, ok, elapsedMs }) {
  if (IS_PRODUCTION_BACKEND || backendColdUntil !== null) return;

  if (isFirstCheck) {
    if (!ok) {
      coldStartDetectedAt = Date.now();
      return;
    }
    if (elapsedMs > COLD_START_THRESHOLD_MS) {
      _markHealthy(elapsedMs);
    }
    return;
  }

  if (ok && coldStartDetectedAt !== null) {
    _markHealthy(Date.now() - coldStartDetectedAt);
  }
}

function _markHealthy(tookMs) {
  healthyAfterMs = tookMs;
  backendColdUntil = Date.now() + COLD_GRACE_MS;
}

/**
 * Returns a console note to append to a failed/slow request's log line when
 * that request started during (or shortly after) a detected cold start, or
 * null when it doesn't apply.
 */
export function getColdBackendNote(requestStartedAt) {
  if (IS_PRODUCTION_BACKEND || backendColdUntil === null) return null;
  if (requestStartedAt > backendColdUntil) return null;
  const seconds = Math.round(healthyAfterMs / 1000);
  return `[COLD BACKEND: healthy after ${seconds}s, staging only, not a prod bug]`;
}

/** Test-only reset of module state between cases. */
export function __resetColdBackendTrackerForTest() {
  coldStartDetectedAt = null;
  backendColdUntil = null;
  healthyAfterMs = null;
}
