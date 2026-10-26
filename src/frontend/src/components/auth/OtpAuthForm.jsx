import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../shared';
import { useAuthStore } from '../../stores/authStore';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';

/**
 * OtpCodeInput — 6-digit code entry with auto-advance and paste support.
 * Internal helper for OtpAuthForm.
 */
function OtpCodeInput({ value, onChange, disabled, autoFocusFirst }) {
  const inputRefs = useRef([]);
  // onChange and onInput fire from the same native event against the same stale
  // `value` prop; track the code synchronously so the second handler is a no-op.
  const latestRef = useRef(value);
  latestRef.current = value;

  // Auto-focus the first input when the code step appears
  useEffect(() => {
    if (autoFocusFirst && inputRefs.current[0] && !disabled) {
      // Small delay to ensure the DOM is ready (fixes focus issues in some browsers)
      const timer = setTimeout(() => inputRefs.current[0]?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocusFirst, disabled]);

  const processDigit = (index, rawValue) => {
    const digit = rawValue.replace(/\D/g, '').slice(-1);
    const newCode = [...latestRef.current];
    newCode[index] = digit;
    latestRef.current = newCode;
    onChange(newCode);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleChange = (index, e) => {
    processDigit(index, e.target.value);
  };

  // onInput fires more reliably than onChange in some browsers (older Safari,
  // some Android keyboards). We use it as a fallback — if onChange already
  // processed the value, this is a no-op because the value matches state.
  const handleInput = (index, e) => {
    const raw = e.target.value || '';
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (digit !== latestRef.current[index]) {
      processDigit(index, raw);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData || { getData: () => '' })
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (!pasted) return;
    const newCode = [...value];
    for (let i = 0; i < 6; i++) newCode[i] = pasted[i] || '';
    latestRef.current = newCode;
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
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          onChange={e => handleChange(i, e)}
          onInput={e => handleInput(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          className="w-10 h-12 text-center text-lg font-mono bg-gray-900 border border-gray-600 rounded text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
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
const PENDING_KEY = 'rb_otp_pending_email';

// The sign-in card can remount while the user reads the code in their mail app;
// remember the pending email so the code step survives (cleared on success/reset).
function readPendingEmail() {
  try { return sessionStorage.getItem(PENDING_KEY) || ''; } catch { return ''; }
}
function writePendingEmail(email) {
  try {
    if (email) sessionStorage.setItem(PENDING_KEY, email);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable: step just won't survive a remount */ }
}

export function OtpAuthForm({ resetKey = null }) {
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);

  const [pendingEmail] = useState(readPendingEmail);
  const [step, setStep] = useState(pendingEmail ? 'code' : 'email'); // 'email' | 'code'
  const [email, setEmail] = useState(pendingEmail);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const verifyingRef = useRef(false);
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    // Caller-driven reset (e.g. AuthGateModal closed → next open starts clean).
    // Not on mount: a remount must keep the restored code step.
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    writePendingEmail('');
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
      const res = await apiFetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
        rbNonDataWrite: true, // T6020 follow-up: auth table write, not user-data
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to send code (${res.status})`);
      }
      setEmail(target);
      writePendingEmail(target);
      setStep('code');
      setCode(['', '', '', '', '', '']);
    } catch (err) {
      const msg = err.name === 'TypeError'
        ? 'Network error — check your internet connection and try again.'
        : (err.message || 'Failed to send code. Please try again.');
      setError(msg);
      console.error(`[Auth:OTP] send-otp failed: email=${target}, error=${err.message}, browser=${navigator.userAgent}`);
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleVerifyCode = useCallback(async (codeArr) => {
    const joined = (codeArr || code).join('');
    if (joined.length !== 6) return;
    if (verifyingRef.current) return; // one request per submit, however many handlers fire
    verifyingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const verifyBody = { email: email.trim(), code: joined };
      const raw = sessionStorage.getItem('campaignParams');
      if (raw) {
        const campaign = JSON.parse(raw);
        if (campaign.ref)          verifyBody.ref = campaign.ref;
        if (campaign.ref_sport)    verifyBody.ref_sport = campaign.ref_sport;
        if (campaign.utm_source)   verifyBody.utm_source = campaign.utm_source;
        if (campaign.utm_medium)   verifyBody.utm_medium = campaign.utm_medium;
        if (campaign.utm_campaign) verifyBody.utm_campaign = campaign.utm_campaign;
        if (campaign.utm_content)  verifyBody.utm_content = campaign.utm_content;
        if (campaign.utm_term)     verifyBody.utm_term = campaign.utm_term;
        if (campaign.click_source) verifyBody.click_source = campaign.click_source;
        if (campaign.referrer_host) verifyBody.referrer_host = campaign.referrer_host;
      }
      const res = await apiFetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
        // T6020 follow-up: login writes Postgres auth tables, never the
        // profile SQLite -- cannot produce a sync conflict, even though
        // logging in IS a user gesture. See rbNonDataWrite in syncStore.js.
        rbNonDataWrite: true,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Verification failed (${res.status})`);
      }
      const data = await res.json();
      writePendingEmail('');
      onAuthSuccess(data.email, data.user_id, data.picture_url, !!data.google_linked);
    } catch (err) {
      const msg = err.name === 'TypeError'
        ? 'Network error — check your internet connection and try again.'
        : (err.message || 'Verification failed. Please try again.');
      setError(msg);
      console.error(`[Auth:OTP] verify-otp failed: email=${email.trim()}, error=${err.message}, browser=${navigator.userAgent}`);
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  }, [email, code, onAuthSuccess]);

  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    if (newCode.every(d => d !== '')) handleVerifyCode(newCode);
  }, [handleVerifyCode]);

  const handleChangeEmail = useCallback(() => {
    writePendingEmail('');
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
        <label htmlFor="otp-email" className="block text-sm text-gray-300">
          Email address
        </label>
        <input
          id="otp-email"
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
      <OtpCodeInput value={code} onChange={handleCodeChange} disabled={loading} autoFocusFirst />
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
