import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { ensureGisInitialized } from '../utils/googleAuth';

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

    const gis = ensureGisInitialized();
    if (!gis) {
      console.warn(`[Auth:OneTap] Google Identity Services not loaded. Possible ad blocker or network issue. Browser: ${navigator.userAgent}`);
      return;
    }
    gis.prompt();
    promptShownRef.current = true;

    // No cleanup cancel — it would race with React StrictMode's mount/
    // unmount/mount cycle and abort the prompt before the user can
    // interact. requireAuth() explicitly cancels when opening the modal.
  }, [isCheckingSession, isAuthenticated, showAuthModal]);

  return null;
}
