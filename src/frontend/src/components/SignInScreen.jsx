import { useState, useEffect, useRef } from 'react';
import { LogoWithText } from './Logo';
import { OtpAuthForm } from './auth/OtpAuthForm';
import {
  ensureGisInitialized,
  getLastAuthError,
  clearLastAuthError,
  onAuthError,
} from '../utils/googleAuth';
import { useAuthStore } from '../stores/authStore';

export function SignInScreen() {
  const authError = useAuthStore((s) => s.authError);
  const [error, setError] = useState(null);
  const [gisAvailable, setGisAvailable] = useState(true);
  const googleButtonRef = useRef(null);

  useEffect(() => {
    setError(getLastAuthError() || authError || null);
    const unsub = onAuthError((msg) => setError(msg));
    return () => {
      unsub();
      clearLastAuthError();
    };
  }, [authError]);

  useEffect(() => {
    if (!googleButtonRef.current) return;
    const gis = ensureGisInitialized();
    if (!gis) {
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
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="flex justify-center">
              <LogoWithText />
            </div>
            <p className="text-gray-400 text-sm">
              Learn from, organize, and celebrate your athlete's moments.
            </p>
          </div>

          <p className="text-white text-center font-medium">
            Sign in to get started
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
            <div className="flex-1 h-px bg-gray-600" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-600" />
          </div>

          <OtpAuthForm resetKey="sign-in-screen" />

          <p className="text-[11px] text-gray-400 text-center pt-1">
            By continuing, you agree to our{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
            {' '}and{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Terms of Service</a>.
          </p>
        </div>

      </div>
    </div>
  );
}
