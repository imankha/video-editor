import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';
import { OtpAuthForm } from './auth/OtpAuthForm';

/**
 * AuthGateModal — mid-session auth prompt shown when an authenticated-only
 * action (e.g. "Add Game") fires while the user is not authenticated.
 *
 * Triggered via `requireAuth` from any gesture that must not run as a guest
 * (Add Game, Export, etc.). T1330 removes the guest path entirely; at that
 * point this modal becomes the primary login surface.
 *
 * OTP logic lives in the shared OtpAuthForm component.
 */
export function AuthGateModal() {
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const [error, setError] = useState(null);
  const googleButtonRef = useRef(null);

  // Reset error state when modal opens/closes; OtpAuthForm resets itself via
  // its resetKey prop.
  useEffect(() => {
    if (!showAuthModal) setError(null);
  }, [showAuthModal]);

  const handleGoogleResponse = useCallback(async (response) => {
    if (!response?.credential) {
      console.error('[Auth:Modal] Google callback fired with no credential', response);
      setError('Google sign-in failed — no credential received. Please try again.');
      return;
    }
    console.log('[Auth:Modal] Google credential received, verifying with backend...');
    setError(null);
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
        console.error(`[Auth:Modal] Backend rejected: ${res.status} — ${detail}`);
        throw new Error(detail);
      }

      const data = await res.json();
      console.log(`[Auth:Modal] Success: ${data.email} (user=${data.user_id})`);
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      console.error('[Auth:Modal] Auth error:', err.message);
      setError(err.message);
    }
  }, [onAuthSuccess]);

  useEffect(() => {
    if (!showAuthModal || !googleButtonRef.current) return;
    const gis = window.google?.accounts?.id;
    if (!gis) {
      console.error('[Auth:Modal] Google Identity Services not loaded — cannot render sign-in button');
      return;
    }

    console.log('[Auth:Modal] Initializing GIS for modal sign-in button');
    gis.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
      cancel_on_tap_outside: false,
    });

    gis.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      width: 360,
    });
  }, [showAuthModal, handleGoogleResponse]);

  if (!showAuthModal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Create your first video</h2>
          <button onClick={closeAuthModal} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-300">
            Sign in to get started. Your annotations are saved and waiting.
          </p>

          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <div ref={googleButtonRef} />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-xs text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          {/* Shared OTP flow — resetKey forces internal state reset when modal reopens */}
          <OtpAuthForm resetKey={showAuthModal} />
        </div>
      </div>
    </div>
  );
}
