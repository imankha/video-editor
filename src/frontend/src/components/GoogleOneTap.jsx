import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

/**
 * T435: Google One Tap Auto-Prompt
 *
 * Shows Google's One Tap floating sign-in UI for guest users after session
 * init completes. If the user clicks it, they're authenticated immediately
 * (same flow as AuthGateModal). Google handles dismiss cooldown automatically.
 *
 * Renders nothing — this is a behavior-only component.
 */
export function GoogleOneTap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCheckingSession = useAuthStore((s) => s.isCheckingSession);
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const promptShownRef = useRef(false);

  const handleCredentialResponse = useCallback(async (response) => {
    if (!response?.credential) {
      console.warn('[Auth:OneTap] No credential in response', response);
      return;
    }
    console.log('[Auth:OneTap] Credential received, verifying with backend...');
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.credential }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error(`[Auth:OneTap] Backend rejected: ${res.status}`, errData.detail || errData);
        return;
      }
      const data = await res.json();
      console.log(`[Auth:OneTap] Success: ${data.email} (user=${data.user_id})`);
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      console.error('[Auth:OneTap] Network error:', err.message);
    }
  }, [onAuthSuccess]);

  useEffect(() => {
    // Wait for session init to finish
    if (isCheckingSession) return;
    // Don't prompt authenticated users
    if (isAuthenticated) return;
    // Don't prompt if AuthGateModal is open
    if (showAuthModal) return;
    // Only prompt once per mount cycle
    if (promptShownRef.current) return;

    const gis = window.google?.accounts?.id;
    if (!gis) {
      console.warn('[Auth:OneTap] Google Identity Services not loaded');
      return;
    }

    console.log('[Auth:OneTap] Initializing GIS + prompting');
    gis.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
    });
    gis.prompt((notification) => {
      // Log the prompt outcome for diagnostics
      if (notification.isNotDisplayed()) {
        console.log(`[Auth:OneTap] Prompt not displayed: ${notification.getNotDisplayedReason()}`);
      } else if (notification.isSkippedMoment()) {
        console.log(`[Auth:OneTap] Prompt skipped: ${notification.getSkippedReason()}`);
      } else if (notification.isDismissedMoment()) {
        console.log(`[Auth:OneTap] Prompt dismissed: ${notification.getDismissedReason()}`);
      }
    });
    promptShownRef.current = true;

    return () => {
      gis.cancel();
    };
  }, [isCheckingSession, isAuthenticated, showAuthModal, handleCredentialResponse]);

  return null;
}
