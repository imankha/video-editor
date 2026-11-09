/**
 * T14980 -- the server-held resume point (frontend transport).
 *
 * Two writers, ONE backend row (POST /api/me/resume-point, Postgres-only,
 * db_sync.SKIP_SYNC_PATHS):
 *
 *  - `writeResumePoint({ mode, gameId, projectId, profileId, tab })`: fired from
 *    a real navigation GESTURE (editorStore.updatePath / ProjectManager's
 *    setActiveTab), never a reactive watch. Carries the object just opened; no
 *    playhead (a fresh open has no meaningful "left at" time).
 *  - `installResumePointExitBeacon()`: a `pagehide`/`visibilitychange->hidden`
 *    beacon (same transport as uiTelemetry's session-exit breadcrumb) that fills
 *    in `t` (playhead) and `dialog` at the moment the tab is actually left.
 *    Best effort -- the navigation POSTs above are the durable write.
 *
 * Sign-out suppresses BOTH (owner ruling 2026-11-08): the row must keep the page
 * the user was on right before signing out, so authStore calls
 * `suppressNextResumePointExit()` before its reload.
 */

import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { getClientBuild } from './appVersion';
import { getProfileId } from './sessionInit';
import { useAuthStore } from '../stores/authStore.js';
import { useEditorStore } from '../stores/editorStore.js';
import { useVideoStore } from '../stores/videoStore.js';

let _suppressed = false;

/** Called by authStore.logout() right before its reload -- no point write, no beacon. */
export function suppressNextResumePointExit() {
  _suppressed = true;
}

// Same module-cycle reasoning as uiTelemetry.js: these stores sit in a cycle
// back to this module's importers, so the imports above are safe (ESM hoists
// the bindings) but READING a value off them must wait until a function
// actually runs, never at this module's own top level.
function _isImpersonating() {
  try {
    return Boolean(useAuthStore.getState().impersonator);
  } catch {
    return false;
  }
}

function _post(point, useBeacon) {
  const body = JSON.stringify(point);
  const url = `${API_BASE}/api/me/resume-point`;
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    return;
  }
  try {
    apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      rbNonDataWrite: true, // T6020: Postgres-only write, not per-user data
    }).catch(() => { /* best effort -- never break navigation */ });
  } catch {
    /* best effort -- never break navigation */
  }
}

/**
 * Build the path-shaped part of the point. Mirrors editorStore's canonicalPath
 * mapping (mode -> screen slug) exactly, since the stored path is advisory for
 * the admin (T14990) while `screen` is what the closed server vocabulary checks.
 */
function _screenForMode(mode) {
  // EDITOR_MODES values ARE the BREADCRUMB_SCREENS slugs (both 'framing',
  // 'overlay', 'annotate', 'project-manager', 'admin') -- no translation table
  // to drift.
  return mode || null;
}

/**
 * Write the whole point from a navigation gesture. `path` is the canonical URL
 * already resolved by the caller (editorStore's canonicalPath / the home tab's
 * TAB_PATHS) -- this function never re-derives it, so it can't disagree with
 * what the address bar actually shows.
 */
export function writeResumePoint({ path, mode, tab = null }) {
  if (!path || _suppressed || _isImpersonating()) return;

  const point = {
    path,
    profile_id: getProfileId() || null,
    screen: _screenForMode(mode),
    step: null,
    t: null,
    dialog: null,
    tab,
    build: getClientBuild() || null,
    left_at: null,
  };
  _post(point, false);
}

/**
 * Clear the server-held point (its target 404'd on restore). Best effort, same
 * transport as the writer -- a failed DELETE just means the stale point is
 * retried on the NEXT restore attempt, not a loop within this one.
 */
export function deleteResumePoint() {
  try {
    apiFetch(`${API_BASE}/api/me/resume-point`, {
      method: 'DELETE',
      rbNonDataWrite: true, // T6020: Postgres-only write, not per-user data
    }).catch(() => { /* best effort */ });
  } catch {
    /* best effort */
  }
}

let _installed = false;

/**
 * Install the exit beacon: on tab-close / visibility->hidden, resend the LAST
 * navigation point (if any) with the playhead filled in. Idempotent, call once
 * at app boot alongside installSessionBreadcrumbs.
 */
export function installResumePointExitBeacon() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  const flush = () => {
    if (_suppressed || _isImpersonating()) return;

    let mode = null;
    let t = null;
    try {
      mode = useEditorStore.getState().editorMode;
      const current = useVideoStore.getState().currentTime;
      t = typeof current === 'number' && current >= 0 ? current : null;
    } catch {
      /* stores not ready (e.g. public route) -- send what we have */
    }

    if (!mode) return; // nothing to record

    _post({
      path: window.location.pathname + window.location.search,
      profile_id: getProfileId() || null,
      screen: _screenForMode(mode),
      step: null,
      t,
      dialog: null,
      tab: null,
      build: getClientBuild() || null,
      left_at: new Date().toISOString(),
    }, true);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}
