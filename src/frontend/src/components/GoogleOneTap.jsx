import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { onGisReady } from '../utils/googleAuth';

/**
 * Google One Tap — shows Google's floating sign-in UI for unauthenticated
 * users once the session check completes. Credential verification is
 * handled centrally in utils/googleAuth; this component only drives the
 * prompt visibility.
 *
 * Renders nothing — behavior-only.
 */
export function GoogleOneTap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCheckingSession = useAuthStore((s) => s.isCheckingSession);
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const promptShownRef = useRef(false);

  useEffect(() => {
    if (isCheckingSession) return;
    if (isAuthenticated) return;
    if (showAuthModal) return;
    if (promptShownRef.current) return;

    // GIS loads `async defer`; wait for it (recovering after a slow load or
    // transient network glitch) rather than giving up on a single check.
    return onGisReady({
      onReady: (gis) => {
        if (promptShownRef.current) return;
        gis.prompt();
        promptShownRef.current = true;
      },
      onTimeout: () => {
        console.warn(`[Auth:OneTap] Google Identity Services not loaded. Possible ad blocker or network issue. Browser: ${navigator.userAgent}`);
      },
    });
  }, [isCheckingSession, isAuthenticated, showAuthModal]);

  return null;
}
