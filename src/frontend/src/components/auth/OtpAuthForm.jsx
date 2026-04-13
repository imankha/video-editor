import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '../shared';
import { useAuthStore } from '../../stores/authStore';
import { API_BASE } from '../../config';

/**
 * OtpCodeInput — 6-digit code entry with auto-advance and paste support.
 * Internal helper for OtpAuthForm.
 */
function OtpCodeInput({ value, onChange, disabled }) {
  const inputRefs = useRef([]);

  const handleChange = (index, e) => {
    const digit = e.target.value.replace(/\D/g, '').slice(-1);
    const newCode = [...value];
    newCode[index] = digit;
    onChange(newCode);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newCode = [...value];
    for (let i = 0; i < 6; i++) newCode[i] = pasted[i] || '';
    onChange(newCode);
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

/**
 * OtpAuthForm — email → 6-digit-code → verify flow used by AuthGateModal.
 * Extracted as a standalone component so T1330 can reuse it when the login
 * surface moves out of the mid-session modal.
 *
 * Calls authStore.onAuthSuccess on successful verification. Optional `resetKey`
 * prop forces an internal state reset when it changes (e.g. modal open/close).
 */
export function OtpAuthForm({ resetKey = null }) {
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);

  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Caller-driven reset (e.g. AuthGateModal closed → next open starts clean)
    setStep('email');
    setEmail('');
    setCode(['', '', '', '', '', '']);
    setLoading(false);
    setError(null);
  }, [resetKey]);

  const handleSendCode = useCallback(async (targetEmail) => {
    const target = (targetEmail || email).trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to send code');
      }
      setStep('code');
      setCode(['', '', '', '', '', '']);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleVerifyCode = useCallback(async (codeArr) => {
    const joined = (codeArr || code).join('');
    if (joined.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: joined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Verification failed');
      }
      const data = await res.json();
      onAuthSuccess(data.email, data.user_id, data.picture_url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [email, code, onAuthSuccess]);

  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    if (newCode.every(d => d !== '')) handleVerifyCode(newCode);
  }, [handleVerifyCode]);

  const handleChangeEmail = useCallback(() => {
    setStep('email');
    setCode(['', '', '', '', '', '']);
    setError(null);
  }, []);

  if (step === 'email') {
    return (
      <form
        className="space-y-3"
        onSubmit={e => { e.preventDefault(); handleSendCode(); }}
      >
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
          autoComplete="email"
        />
        {error && (
          <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            {error}
          </div>
        )}
        <Button
          variant="secondary"
          fullWidth
          loading={loading}
          disabled={!email.trim()}
          type="submit"
        >
          Send Code
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400 text-center">
        Enter the 6-digit code sent to <span className="text-white">{email}</span>
      </p>
      <OtpCodeInput value={code} onChange={handleCodeChange} disabled={loading} />
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
          {error}
        </div>
      )}
      <Button
        variant="secondary"
        fullWidth
        loading={loading}
        disabled={code.some(d => !d)}
        onClick={() => handleVerifyCode()}
      >
        Verify
      </Button>
      <div className="flex justify-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => handleSendCode(email)}
          disabled={loading}
          className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
        >
          Resend code
        </button>
        <span className="text-gray-600">|</span>
        <button
          type="button"
          onClick={handleChangeEmail}
          disabled={loading}
          className="text-gray-400 hover:text-gray-300 disabled:opacity-50"
        >
          Use different email
        </button>
      </div>
    </div>
  );
}
