import { useEffect } from 'react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useIsAuthenticated } from '../stores/authStore';

const HEARTBEAT_INTERVAL_MS = 60_000; // ~60s while foreground

/**
 * T5660: app-level engaged-time signals for the admin "Usage" measurement.
 *
 * - **Foreground heartbeat:** while authenticated AND the tab is visible, POST
 *   `/api/auth/heartbeat` every ~60s so a heavy continuous session's
 *   `last_active_at` stays fresh and its engaged time is measured accurately
 *   instead of the session sitting open and getting clamped. Paused while the tab
 *   is hidden; the server also caps any per-tick gap, so a backgrounded tab
 *   cannot inflate usage even if it kept pinging.
 * - **Tab-close beacon:** on `visibilitychange → hidden` and `pagehide`,
 *   `navigator.sendBeacon` to `/api/auth/session-close` so the last (often
 *   largest) session banks without requiring a logout or a return visit.
 *
 * App-level (not annotate-scoped) on purpose: usage is a whole-session concept,
 * so it lives with the app's other session wiring rather than inside one screen.
 */
export function useSessionHeartbeat() {
  const isAuthenticated = useIsAuthenticated();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const sendHeartbeat = () => {
      if (document.visibilityState !== 'visible') return;
      apiFetch(`${API_BASE}/api/auth/heartbeat`, { method: 'POST' }).catch(() => {});
    };

    const closeSession = () => {
      const url = `${API_BASE}/api/auth/session-close`;
      if (navigator.sendBeacon) {
        // sendBeacon carries the rb_session cookie (SameSite=None;Secure in
        // cross-origin envs) and survives unload without blocking navigation.
        navigator.sendBeacon(url);
      } else {
        apiFetch(url, { method: 'POST', keepalive: true }).catch(() => {});
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

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', closeSession);
    };
  }, [isAuthenticated]);
}
