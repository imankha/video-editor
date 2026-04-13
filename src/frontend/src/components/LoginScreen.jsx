import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';
import { OtpAuthForm } from './auth/OtpAuthForm';

/**
 * LoginScreen — full-screen login gate shown when no authenticated session exists.
 *
 * Replaces the silent guest-account fallback. First-time visitors see this
 * screen; returning users with a valid rb_session cookie go straight to the
 * editor (the outer AppAuthGate renders a loading spinner during /me check to
 * avoid a login-screen flash for them).
 *
 * Google sign-in is rendered via GIS `renderButton`. OTP is handled by the
 * shared OtpAuthForm (also used by AuthGateModal for mid-session prompts).
 */
export function LoginScreen() {
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const googleButtonRef = useRef(null);
  const [googleError, setGoogleError] = useState(null);

  const handleGoogleResponse = useCallback(async (response) => {
    if (!response?.credential) {
      console.error('[Auth:Login] Google callback fired with no credential', response);
      setGoogleError('Google sign-in failed — no credential received. Please try again.');
      return;
    }
    console.log('[Auth:Login] Google credential received, verifying with backend...');
    setGoogleError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: response.credential }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail || data.message || 'Authentication failed';
        console.error(`[Auth:Login] Backend rejected: ${res.status} — ${detail}`);
        throw new Error(detail);
      }
      const data = await res.json();
      console.log(`[Auth:Login] Success: ${data.email} (user=${data.user_id})`);
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      console.error('[Auth:Login] Auth error:', err.message);
      setGoogleError(err.message);
    }
  }, [onAuthSuccess]);

  // Mount the Google Identity Services button. GIS only supports one callback
  // at a time; since LoginScreen owns the whole viewport when visible, there is
  // no competing callback (GoogleOneTap is a no-op while !isAuthenticated + this
  // screen is mounted — it also initializes GIS, but our render runs after).
  useEffect(() => {
    if (!googleButtonRef.current) return;
    const gis = window.google?.accounts?.id;
    if (!gis) {
      console.warn('[Auth:Login] Google Identity Services not loaded yet');
      return;
    }
    gis.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
      use_fedcm_for_prompt: true,
    });
    gis.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      width: 320,
    });
  }, [handleGoogleResponse]);

  return (
    <div
      data-testid="login-screen"
      className="fixed inset-0 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center px-4 py-8 overflow-auto"
    >
      <div className="w-full max-w-sm sm:max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            Reel Ballers
          </h1>
          <p className="text-sm text-gray-400">
            Clip, crop, and share your best moments.
          </p>
        </div>

        {/* Card */}
        <div className="bg-gray-800/90 backdrop-blur rounded-lg border border-gray-700 p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-lg font-semibold text-white text-center">
              Sign in to continue
            </h2>
            <p className="text-xs text-gray-400 text-center mt-1">
              Google or email — your work is saved to your account.
            </p>
          </div>

          {googleError && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {googleError}
            </div>
          )}

          {/* Google button slot (rendered by GIS) */}
          <div className="flex justify-center">
            <div data-testid="google-signin-slot" ref={googleButtonRef} />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-xs text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          <OtpAuthForm />
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          By signing in you agree to our terms.
        </p>
      </div>
    </div>
  );
}
