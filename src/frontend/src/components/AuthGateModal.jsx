import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import {
  ensureGisInitialized,
  getLastAuthError,
  clearLastAuthError,
  onAuthError,
} from '../utils/googleAuth';
import { OtpAuthForm } from './auth/OtpAuthForm';

/**
 * AuthGateModal — mid-session auth prompt shown when an authenticated-only
 * action (e.g. "Add Game") fires while the user is not authenticated.
 *
 * Triggered via `requireAuth` from any gesture that must not run as a guest
 * (Add Game, Export, etc.). T1330 removes the guest path entirely; at that
 * point this modal becomes the primary login surface.
 *
 * Google credential verification and GIS init live in utils/googleAuth —
 * this modal only renders the button slot and subscribes to auth errors.
 */
export function AuthGateModal() {
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const authError = useAuthStore((s) => s.authError);
  const [error, setError] = useState(null);
  const [gisAvailable, setGisAvailable] = useState(true);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    if (!showAuthModal) {
      setError(null);
      clearLastAuthError();
      return;
    }
    // Show any error that occurred before the modal opened (e.g. a failed
    // One Tap credential verification, or a cookie-blocked error from reload).
    setError(getLastAuthError() || authError || null);
    const unsub = onAuthError((msg) => setError(msg));
    return unsub;
  }, [showAuthModal, authError]);

  useEffect(() => {
    if (!showAuthModal || !googleButtonRef.current) return;
    const gis = ensureGisInitialized();
    if (!gis) {
      console.error('[Auth:Modal] Google Identity Services not loaded. ' +
        'This may be caused by an ad blocker, script blocker, or network issue. ' +
        `Browser: ${navigator.userAgent}`);
      setGisAvailable(false);
      return;
    }
    setGisAvailable(true);
    gis.renderButton(googleButtonRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      width: 360,
    });
  }, [showAuthModal]);

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

          {!gisAvailable && (
            <p className="text-xs text-yellow-400 text-center">
              Google sign-in unavailable. An ad blocker or browser setting may be
              blocking it. Use email sign-in below instead.
            </p>
          )}

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
