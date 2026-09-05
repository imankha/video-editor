import { useEffect, useRef } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useIsAuthenticated } from '../stores/authStore';

const HEARTBEAT_INTERVAL_MS = 60_000; // ~60s while foreground

// T8920: a heartbeat only counts as engaged time if the user actually did
// something recently. This window is generous relative to the 60s tick so a
// user reading/watching without touching input for a single tick isn't punished,
// but a genuinely idle-yet-foregrounded tab (e.g. left open during a slow
// background upload) stops refreshing `last_active_at` and lets the server's
// 30-min idle boundary close the session.
const INTERACTION_WINDOW_MS = 90_000;

// Don't rewrite lastInteractionRef on every mousemove tick -- once per second is
// plenty of resolution for a 90s recency window.
const INTERACTION_THROTTLE_MS = 1_000;

/**
 * T5660: app-level engaged-time signals for the admin "Usage" measurement.
 *
 * - **Foreground heartbeat:** while authenticated AND the tab is visible AND the
 *   user interacted within `INTERACTION_WINDOW_MS`, POST `/api/auth/heartbeat`
 *   every ~60s so a heavy continuous session's `last_active_at` stays fresh and
 *   its engaged time is measured accurately instead of the session sitting open
 *   and getting clamped. Paused while the tab is hidden; the server also caps any
 *   per-tick gap, so a backgrounded tab cannot inflate usage even if it kept
 *   pinging.
 * - **Interaction-recency gate (T8920):** visibility alone is not engagement — an
 *   idle-but-foregrounded tab (e.g. left open during a slow background upload)
 *   would otherwise keep `last_active_at` fresh forever and defeat the server's
 *   30-min idle boundary. Passive `mousemove`/`keydown`/`scroll`/`touchstart`
 *   listeners stamp `lastInteractionRef`; a heartbeat (interval tick AND the
 *   foreground-regain ping) is withheld unless that stamp is within the window.
 * - **Tab-close beacon:** on `visibilitychange → hidden` and `pagehide`,
 *   `navigator.sendBeacon` to `/api/auth/session-close` so the last (often
 *   largest) session banks without requiring a logout or a return visit.
 *
 * App-level (not annotate-scoped) on purpose: usage is a whole-session concept,
 * so it lives with the app's other session wiring rather than inside one screen.
 */
export function useSessionHeartbeat() {
  const isAuthenticated = useIsAuthenticated();
  const lastInteractionRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    // A freshly opened/focused tab counts as interaction so the very first
    // heartbeat isn't wrongly withheld.
    lastInteractionRef.current = Date.now();

    const recordInteraction = () => {
      const now = Date.now();
      if (now - lastInteractionRef.current >= INTERACTION_THROTTLE_MS) {
        lastInteractionRef.current = now;
      }
    };

    const interactedRecently = () =>
      Date.now() - lastInteractionRef.current < INTERACTION_WINDOW_MS;

    const sendHeartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      // T8920: withhold the keep-alive unless the user actually interacted
      // recently -- an idle foreground tab must not keep `last_active_at` fresh.
      if (!interactedRecently()) return;
      apiFetch(`${API_BASE}/api/auth/heartbeat`, {
        method: 'POST',
        rbNonDataWrite: true, // T6020: periodic timer, not a user gesture
      }).catch(() => {});
    };

    const closeSession = () => {
      const url = `${API_BASE}/api/auth/session-close`;
      if (navigator.sendBeacon) {
        // sendBeacon carries the rb_session cookie (SameSite=None;Secure in
        // cross-origin envs) and survives unload without blocking navigation.
        // Does NOT route through window.fetch, so it never reaches the sync
        // interceptor at all -- no rbNonDataWrite marker needed here (T6020).
        navigator.sendBeacon(url);
      } else {
        // Fallback path for browsers without sendBeacon -- same tab-close
        // lifecycle event as the branch above, just via fetch.
        apiFetch(url, { method: 'POST', keepalive: true, rbNonDataWrite: true }).catch(() => {});
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        closeSession();
      } else {
        // Returning to the foreground resumes a session promptly (the server
        // reopens current_session_start on the next heartbeat).
        sendHeartbeat();
      }
    };

    const intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', closeSession);

    // Passive interaction listeners feed lastInteractionRef. Passive so they
    // never block scroll/touch; throttled inside recordInteraction.
    const INTERACTION_EVENTS = ['mousemove', 'keydown', 'scroll', 'touchstart'];
    INTERACTION_EVENTS.forEach((evt) =>
      window.addEventListener(evt, recordInteraction, { passive: true })
    );

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', closeSession);
      INTERACTION_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, recordInteraction)
      );
    };
  }, [isAuthenticated]);
}
