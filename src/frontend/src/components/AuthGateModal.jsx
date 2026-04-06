import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './shared';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

function OtpCodeInput({ value, onChange, disabled }) {
  const inputRefs = useRef([]);

  const handleChange = (index, e) => {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    const newCode = [...value];
    newCode[index] = digit;
    onChange(newCode);

    // Auto-advance to next input on digit entry
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    // Backspace on empty field moves to previous
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = [...value];
    for (let i = 0; i < 6; i++) {
      newCode[i] = pasted[i] || '';
    }
    onChange(newCode);
    // Focus the next empty field or last field
    const nextEmpty = newCode.findIndex(d => !d);
    const focusIdx = nextEmpty === -1 ? 5 : nextEmpty;
    inputRefs.current[focusIdx]?.focus();
  };

  return (
    <div className="flex justify-center gap-2">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={el => inputRefs.current[i] = el}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          disabled={disabled}
          className="w-10 h-12 text-center text-lg font-mono bg-gray-900 border border-gray-600 rounded text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}

export function AuthGateModal() {
  const showAuthModal = useAuthStore((s) => s.showAuthModal);
  const closeAuthModal = useAuthStore((s) => s.closeAuthModal);
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);
  const [error, setError] = useState(null);
  const googleButtonRef = useRef(null);

  // Email OTP state
  const [otpStep, setOtpStep] = useState('email'); // 'email' | 'code'
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState(null);

  // Reset OTP state when modal opens/closes
  useEffect(() => {
    if (!showAuthModal) {
      setOtpStep('email');
      setOtpEmail('');
      setOtpCode(['', '', '', '', '', '']);
      setOtpLoading(false);
      setOtpError(null);
      setError(null);
    }
  }, [showAuthModal]);

  // Google auth handler
  const handleGoogleResponse = useCallback(async (response) => {
    if (!response?.credential) {
      setError('Google sign-in failed — no credential received. Please try again.');
      return;
    }
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
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      setError(err.message);
    }
  }, [onAuthSuccess]);

  // Initialize Google Sign-In button when modal opens
  useEffect(() => {
    if (!showAuthModal || !googleButtonRef.current) return;
    if (!window.google?.accounts?.id) return;

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

  // Send OTP code
  const handleSendCode = useCallback(async (email) => {
    const target = email || otpEmail;
    if (!target.trim()) return;

    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to send code');
      }

      setOtpStep('code');
      setOtpCode(['', '', '', '', '', '']);
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  }, [otpEmail]);

  // Verify OTP code
  const handleVerifyCode = useCallback(async (codeArr) => {
    const code = (codeArr || otpCode).join('');
    if (code.length !== 6) return;

    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: otpEmail.trim(), code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Verification failed');
      }

      const data = await res.json();
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      setOtpError(err.message);
    } finally {
      setOtpLoading(false);
    }
  }, [otpEmail, otpCode, onAuthSuccess]);

  // Auto-submit when all 6 digits are entered
  const handleCodeChange = useCallback((newCode) => {
    setOtpCode(newCode);
    if (newCode.every(d => d !== '')) {
      handleVerifyCode(newCode);
    }
  }, [handleVerifyCode]);

  const handleChangeEmail = useCallback(() => {
    setOtpStep('email');
    setOtpCode(['', '', '', '', '', '']);
    setOtpError(null);
  }, []);

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

          {/* Google error message */}
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

          {/* Email OTP */}
          {otpStep === 'email' ? (
            <form
              className="space-y-3"
              onSubmit={e => { e.preventDefault(); handleSendCode(); }}
            >
              <input
                type="email"
                placeholder="your@email.com"
                value={otpEmail}
                onChange={e => setOtpEmail(e.target.value)}
                disabled={otpLoading}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                autoComplete="email"
              />
              {otpError && (
                <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
                  {otpError}
                </div>
              )}
              <Button
                variant="secondary"
                fullWidth
                loading={otpLoading}
                disabled={!otpEmail.trim()}
                type="submit"
              >
                Send Code
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 text-center">
                Enter the 6-digit code sent to <span className="text-white">{otpEmail}</span>
              </p>

              <OtpCodeInput
                value={otpCode}
                onChange={handleCodeChange}
                disabled={otpLoading}
              />

              {otpError && (
                <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
                  {otpError}
                </div>
              )}

              <Button
                variant="secondary"
                fullWidth
                loading={otpLoading}
                disabled={otpCode.some(d => !d)}
                onClick={() => handleVerifyCode()}
              >
                Verify
              </Button>

              <div className="flex justify-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => handleSendCode(otpEmail)}
                  disabled={otpLoading}
                  className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  Resend code
                </button>
                <span className="text-gray-600">|</span>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  disabled={otpLoading}
                  className="text-gray-400 hover:text-gray-300 disabled:opacity-50"
                >
                  Use different email
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
