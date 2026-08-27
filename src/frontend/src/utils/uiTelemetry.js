/**
 * T7515 — frustration mid-funnel instrumentation (frontend transport).
 *
 * Two signals, both fired from a real user GESTURE (never a reactive state
 * watch), both leaving ZERO footprint during admin impersonation:
 *
 *  - Tier 3 `recordUiImpression(kind, name)`: a blocking-dialog / error-toast
 *    IMPRESSION, fired from the surface's SHOW gesture (Toast.addToast /
 *    ConfirmationDialog opening). Carries a per-session repetition count so the
 *    T7540 tag-trap reads as "shown 5x, saved 0".
 *  - Tier 4 `installSessionBreadcrumbs()`: accumulates per-screen foreground
 *    dwell + an ordered screen trail IN MEMORY as the user navigates, and flushes
 *    the trail once on session exit (tab close / visibility→hidden) to the user's
 *    own `user_action_log`.
 *
 * Backend sinks: POST /api/telemetry/impression and
 * POST /api/telemetry/session-breadcrumbs (see routers/telemetry.py). Both are
 * fire-and-forget: a telemetry beacon must never throw, block, or break the app.
 */

import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { useAuthStore } from '../stores/authStore.js';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore.js';

// Cap impression beacons so a component stuck re-showing a toast in a loop can't
// flood the server (mirrors clientLogger's MAX_BEACONS_PER_SESSION rationale).
const MAX_IMPRESSION_BEACONS_PER_SESSION = 50;
let _impressionBeaconCount = 0;

// Per-session impression counts, keyed by `${kind}:${name}`. This is the
// "shown Nx in one session" repetition signal — the frustration measurement.
const _sessionImpressionCounts = new Map();

/**
 * Skip ALL telemetry while an admin is impersonating a user — matches the
 * authoritative backend impersonation guard so nothing is even sent (analytics.js
 * uses the same store flag for the same reason).
 */
function _isImpersonating() {
  try {
    return Boolean(useAuthStore.getState().impersonator);
  } catch {
    return false;
  }
}

/**
 * Tier 3: record a blocking-dialog / error-toast impression.
 * @param {'toast'|'dialog'} kind
 * @param {string} name - the surface's title/key (static, human-readable)
 */
export function recordUiImpression(kind, name) {
  if (!name || _isImpersonating()) return;
  if (_impressionBeaconCount >= MAX_IMPRESSION_BEACONS_PER_SESSION) return;

  const key = `${kind}:${name}`;
  const sessionCount = (_sessionImpressionCounts.get(key) || 0) + 1;
  _sessionImpressionCounts.set(key, sessionCount);
  _impressionBeaconCount++;

  try {
    apiFetch(`${API_BASE}/api/telemetry/impression`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, name: String(name).slice(0, 120), session_count: sessionCount }),
      keepalive: true,
      rbNonDataWrite: true, // telemetry, not a user-data write (T6020)
    }).catch(() => { /* never let a telemetry beacon break anything */ });
  } catch {
    /* never let a telemetry beacon break anything */
  }
}

// --- Tier 4: session-exit breadcrumbs -------------------------------------

// LAZY: computed on first use inside a function, never at module-load time.
// Toast.jsx (which imports this module) sits in a circular import back to
// editorStore.js via the store graph (focusStore/projectDataStore/overlayStore/
// projectsStore/videoStore), so a top-level `Object.values(EDITOR_MODES)` here
// could still read EDITOR_MODES as undefined depending on which module in that
// cycle finishes evaluating first. Deferring the read until a function actually
// RUNS (always after the whole module graph has finished settling) sidesteps
// the race entirely — this module's own top level now touches nothing from
// editorStore.js except the `useEditorStore` store reference itself (a stable
// object identity, not read into a value at import time).
let _breadcrumbScreensCache = null;
function _breadcrumbScreens() {
  if (!_breadcrumbScreensCache) _breadcrumbScreensCache = new Set(Object.values(EDITOR_MODES));
  return _breadcrumbScreensCache;
}

let _breadcrumbsInstalled = false;
const _dwellMs = {};        // screen -> accumulated FOREGROUND ms
let _trail = [];            // ordered screens visited this session
let _currentScreen = null;
let _screenEnteredAt = 0;   // Date.now() when _currentScreen was entered/resumed
let _flushed = false;       // guards one send per foreground period

function _now() {
  return Date.now();
}

/** Bank the time spent on the current screen since it was entered/resumed. */
function _bankCurrentDwell() {
  if (!_currentScreen) return;
  const elapsed = _now() - _screenEnteredAt;
  if (elapsed > 0) {
    _dwellMs[_currentScreen] = (_dwellMs[_currentScreen] || 0) + elapsed;
  }
  _screenEnteredAt = _now();
}

/** A navigation gesture moved the user to a new screen — bank + record it. */
function _onScreenChange(nextScreen) {
  if (nextScreen === _currentScreen) return;
  _bankCurrentDwell();
  _currentScreen = nextScreen;
  _screenEnteredAt = _now();
  if (_breadcrumbScreens().has(nextScreen)) _trail.push(nextScreen);
}

/** Serialize the current trail + dwell (ms→seconds) for the beacon. */
function _breadcrumbPayload() {
  _bankCurrentDwell();
  const dwell = {};
  for (const [screen, ms] of Object.entries(_dwellMs)) {
    dwell[screen] = Math.round(ms / 100) / 10; // seconds, 0.1s resolution
  }
  return { last_screen: _currentScreen, dwell, trail: _trail.slice(-50) };
}

/**
 * Drop the crumbs already reported to the server so a later flush can't re-send
 * them. Keeps `_currentScreen` (it's still where the user is) but re-arms dwell
 * accounting from now, so a resumed session accrues a FRESH trail/dwell.
 */
function _resetBreadcrumbBuffer() {
  _trail = [];
  for (const screen of Object.keys(_dwellMs)) delete _dwellMs[screen];
  _screenEnteredAt = _now();
}

/**
 * Flush the breadcrumb trail on session exit. Guarded so a hidden→pagehide pair
 * sends once; the guard resets when the tab returns to the foreground, so a
 * genuinely resumed-then-exited session re-sends its (newly accrued) trail.
 *
 * Reset-after-flush: once crumbs are handed to the transport we CLEAR the buffer.
 * Without this, a tab that goes hidden (flush), resumes, then goes hidden again
 * re-sends the SAME trail, writing a duplicate session_exit row every cycle. Post
 * reset, the second flush carries only what the user did after resuming — and if
 * nothing accrued (no new trail, no new dwell) we skip the send entirely rather
 * than emit a bare last_screen duplicate.
 */
function _flushBreadcrumbs() {
  if (_flushed || _isImpersonating()) return;
  _flushed = true;

  const url = `${API_BASE}/api/telemetry/session-breadcrumbs`;
  const payload = _breadcrumbPayload();
  const hasActivity = payload.trail.length > 0 || Object.keys(payload.dwell).length > 0;
  if (!hasActivity) {
    _resetBreadcrumbBuffer();
    return;
  }

  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      // sendBeacon carries the rb_session cookie and survives unload without
      // blocking navigation; the JSON Blob type lets FastAPI parse the body.
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        rbNonDataWrite: true,
      }).catch(() => {});
    }
  } catch {
    /* never let a telemetry beacon break anything */
  } finally {
    // Reported (or attempted) — drop these crumbs so a resumed→re-hidden tab
    // can't re-send them as a duplicate session_exit row.
    _resetBreadcrumbBuffer();
  }
}

/**
 * Install the tier-4 dwell tracker. Call ONCE at app boot (main.jsx), alongside
 * installClientLogger. Subscribes to editorMode transitions (in-memory
 * accumulation only — no write on state change) and flushes on tab-close /
 * visibility→hidden (a real exit gesture). Idempotent.
 */
export function installSessionBreadcrumbs() {
  if (_breadcrumbsInstalled || typeof window === 'undefined') return;
  _breadcrumbsInstalled = true;

  _currentScreen = useEditorStore.getState().editorMode;
  _screenEnteredAt = _now();
  if (_breadcrumbScreens().has(_currentScreen)) _trail.push(_currentScreen);

  useEditorStore.subscribe((state) => _onScreenChange(state.editorMode));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _flushBreadcrumbs();
    } else {
      // Returning to the foreground resumes dwell accounting (background time is
      // never counted) and re-arms the flush guard.
      _flushed = false;
      _screenEnteredAt = _now();
    }
  });
  window.addEventListener('pagehide', _flushBreadcrumbs);
}
