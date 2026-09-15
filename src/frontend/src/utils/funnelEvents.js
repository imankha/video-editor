/**
 * T10010 — activation-funnel client beacons.
 *
 * A thin, gesture-driven transport for the funnel events that happen entirely in
 * the browser and have no natural server endpoint: framing point added, preview
 * started, a validated playback view, draft saved, result (re)opened. Every call
 * MUST originate from a real user GESTURE (click / play / threshold-crossing),
 * never a reactive state watch — same rule as uiTelemetry.js.
 *
 * Backend sink: POST /api/telemetry/funnel-event -> record_funnel_event
 * (routers/telemetry.py). The server owns the closed-vocabulary check, the
 * PII-safe context allow-list, and the server-side re-validation of the
 * `result_viewed` threshold. Fire-and-forget: a beacon must never throw, block,
 * or break the app.
 *
 * These are DISTINCT from analytics.js `track()` (Cloudflare + local breadcrumb
 * buffer) and from the one-time quest `recordAchievement()` — a funnel event is
 * repeatable (three renders of one highlight beacon three times; dedup to one
 * ACTIVATED PERSON is a read-time COUNT(DISTINCT user_id), never a write concern).
 */

import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { useAuthStore } from '../stores/authStore.js';

// Closed client vocabulary — mirrors CLIENT_FUNNEL_EVENTS in app/analytics.py.
// A name not in this set is dropped BEFORE the network call (the server rejects
// it too, but failing fast here keeps a typo from ever leaving the browser).
export const FUNNEL_EVENTS = Object.freeze({
  FRAMING_POINT_ADDED: 'framing_point_added',
  PREVIEW_STARTED: 'preview_started',
  DRAFT_SAVED: 'draft_saved',
  RESULT_OPENED: 'result_opened',
  PLAYBACK_STARTED: 'playback_started',
  RESULT_VIEWED: 'result_viewed',
  RESULT_REOPENED: 'result_reopened',
});
const _KNOWN = new Set(Object.values(FUNNEL_EVENTS));

// "Viewed" playback convention (NOT a satisfaction claim) — mirrors
// is_playback_viewed / VIEWED_* in app/analytics.py verbatim, so the client only
// beacons a genuine view and the server re-check agrees.
export const VIEWED_MIN_SECONDS = 2;
export const VIEWED_LONG_CLIP_SECONDS = 4;
export const VIEWED_SHORT_FRACTION = 0.5;

/**
 * True when observed playback meets the T10010 'viewed' convention: >= 2s for a
 * clip long enough to afford it (>= 4s), else >= 50% of its duration. A
 * non-positive/unknown duration can never be "viewed".
 */
export function computeViewed(watchedSeconds, durationSeconds) {
  const watched = Number(watchedSeconds);
  const duration = Number(durationSeconds);
  if (!(duration > 0) || !(watched > 0)) return false;
  if (duration >= VIEWED_LONG_CLIP_SECONDS) return watched >= VIEWED_MIN_SECONDS;
  return watched >= duration * VIEWED_SHORT_FRACTION;
}

/**
 * The playback position (seconds) at which a clip first counts as "viewed" — the
 * delay a caller schedules a `result_viewed` beacon after autoplay begins. 0 for
 * an unknown/zero duration (caller should skip the beacon entirely).
 */
export function viewedThresholdSeconds(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!(duration > 0)) return 0;
  return duration >= VIEWED_LONG_CLIP_SECONDS ? VIEWED_MIN_SECONDS : duration * VIEWED_SHORT_FRACTION;
}

/**
 * Fire a funnel-event beacon. Fire-and-forget; never throws.
 *
 * @param {string} event   - one of FUNNEL_EVENTS
 * @param {Object} [context] - coarse join keys / buckets / durations ONLY. Never
 *   child names, emails, raw video, or free text — the server drops any key not
 *   on its allow-list, but callers must not send excluded data in the first place.
 */
export function recordFunnelEvent(event, context = {}) {
  // Never attribute an impersonating admin's actions to the user (matches the
  // authoritative backend guard; mirrors uiTelemetry.js / analytics.js).
  if (!_KNOWN.has(event)) return;
  try {
    if (useAuthStore.getState().impersonator) return;
  } catch {
    /* no store yet — treat as not impersonating */
  }

  try {
    apiFetch(`${API_BASE}/api/telemetry/funnel-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, context: context || {} }),
      keepalive: true,
      rbNonDataWrite: true, // telemetry, not a user-data write (T6020)
    }).catch(() => { /* never let a telemetry beacon break anything */ });
  } catch {
    /* never let a telemetry beacon break anything */
  }
}
