import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './shared';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

export function AuthGateModal() {
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const googleButtonRef = useRef(null);

  const handleGoogleResponse = useCallback(async (response) => {
    if (!response?.credential) {
      setError('Google sign-in failed — no credential received. Please try again.');
      return;
    }
    setIsLoading(true);
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
        throw new Error(data.detail || data.message || 'Authentication failed');
      }

      const data = await res.json();
      onAuthSuccess(data.email, data.user_id);
    } catch (err) {
      console.error('[AuthGateModal] Google auth failed:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [onAuthSuccess]);

  // Initialize Google Sign-In button when modal opens
  useEffect(() => {
    if (!showAuthModal || !googleButtonRef.current) return;
    if (!window.google?.accounts?.id) {
      console.warn('[AuthGateModal] Google Identity Services not loaded');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse,
    });

    window.google.accounts.id.renderButton(googleButtonRef.current, {
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
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Create your first video</h2>
          <button onClick={closeAuthModal} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-300">
            Sign in to get started. Your annotations are saved and waiting.
          </p>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Google Sign-In (rendered by GIS library) */}
          <div className="flex justify-center">
            <div ref={googleButtonRef} />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700" />
            <span className="text-xs text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-700" />
          </div>

          {/* Email OTP (disabled until T401) */}
          <div className="space-y-3 opacity-50">
            <input
              type="email"
              placeholder="your@email.com"
              disabled
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <Button variant="secondary" fullWidth disabled>
              Send Code
            </Button>
            <p className="text-xs text-gray-500 text-center">
              Email sign-in coming soon
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
