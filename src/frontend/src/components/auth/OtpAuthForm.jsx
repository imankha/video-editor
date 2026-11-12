import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '../shared';
import { useAuthStore } from '../../stores/authStore';
import { API_BASE } from '../../config';
import apiFetch from '../../utils/apiFetch';
import { readPendingOtp, writePendingOtp, clearPendingOtp, trackOtpRequest } from '../../utils/otpFlow';
import { ERROR_COPY, ACCOUNT_COPY } from '../../config/displayNames';
import { serverError, userErrorMessage } from '../../utils/userError';

/**
 * OtpCodeInput — 6-digit code entry with auto-advance and paste support.
 * Internal helper for OtpAuthForm.
 */
function OtpCodeInput({ value, onChange, disabled, autoFocusFirst, focusResetToken }) {
  const inputRefs = useRef([]);
  // onChange and onInput fire from the same native event against the same stale
  // `value` prop; track the code synchronously so the second handler is a no-op.
  const latestRef = useRef(value);
  latestRef.current = value;

  // Auto-focus the first input when the code step appears, and again whenever
  // the parent bumps focusResetToken (e.g. after an invalid-code error clears
  // the boxes -- the retry must start from box 0, not wherever focus landed).
  useEffect(() => {
    if (autoFocusFirst && inputRefs.current[0] && !disabled) {
      // Small delay to ensure the DOM is ready (fixes focus issues in some browsers)
      const timer = setTimeout(() => inputRefs.current[0]?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocusFirst, disabled, focusResetToken]);

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
// The sign-in card can remount while the user reads the code in their mail app;
// the pending email (utils/otpFlow) keeps the code step across it, cleared on success/reset.
function readPendingEmail() {
  return readPendingOtp()?.email ?? '';
}
function writePendingEmail(email) {
  if (email) writePendingOtp(email);
  else clearPendingOtp();
}

// The sign-in modal calls this when it closes, so reopening starts at the email step.
export function clearPendingOtpEmail() {
  clearPendingOtp();
}

export function OtpAuthForm({ resetKey = null }) {
  const onAuthSuccess = useAuthStore((s) => s.onAuthSuccess);

  const [pendingEmail] = useState(readPendingEmail);
  const [step, setStep] = useState(pendingEmail ? 'code' : 'email'); // 'email' | 'code'
  const [email, setEmail] = useState(pendingEmail);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [focusResetToken, setFocusResetToken] = useState(0);

  const verifyingRef = useRef(false);
  // Tracks whether `code` was already fully filled before the most recent edit, so a
  // single-digit edit of a leftover (wrong) code doesn't immediately re-submit a code
  // that's still mostly the old wrong digits -- only a fresh transition into "complete"
  // auto-submits.
  const codeWasCompleteRef = useRef(false);
  const lastResetKey = useRef(resetKey);

  const resetCode = useCallback(() => {
    setCode(['', '', '', '', '', '']);
    codeWasCompleteRef.current = false;
    setFocusResetToken((t) => t + 1);
  }, []);

  useEffect(() => {
    // Caller-driven reset (e.g. AuthGateModal closed → next open starts clean).
    // Not on mount: a remount must keep the restored code step.
    if (lastResetKey.current === resetKey) return;
    lastResetKey.current = resetKey;
    writePendingEmail('');
    setStep('email');
    setEmail('');
    resetCode();
    setLoading(false);
    setError(null);
  }, [resetKey, resetCode]);

  const handleSendCode = useCallback(async (targetEmail) => {
    const target = (targetEmail || email).trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const res = await trackOtpRequest(() => apiFetch(`${API_BASE}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target }),
        rbNonDataWrite: true, // T6020 follow-up: auth table write, not user-data
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw serverError(res, data, ERROR_COPY.SEND_CODE);
      }
      setEmail(target);
      writePendingEmail(target);
      setStep('code');
      resetCode();
    } catch (err) {
      const msg = err.name === 'TypeError'
        ? ERROR_COPY.CONNECTION
        : userErrorMessage(err, ERROR_COPY.SEND_CODE);
      setError(msg);
      console.error(`[Auth:OTP] send-otp failed: email=${target}, error=${err.message}, browser=${navigator.userAgent}`);
    } finally {
      setLoading(false);
    }
  }, [email, resetCode]);

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
        if (campaign.country)      verifyBody.country = campaign.country;
        if (campaign.landing_path) verifyBody.landing_path = campaign.landing_path;
      }
      const res = await trackOtpRequest(() => apiFetch(`${API_BASE}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
        // T6020 follow-up: login writes Postgres auth tables, never the
        // profile SQLite -- cannot produce a sync conflict, even though
        // logging in IS a user gesture. See rbNonDataWrite in syncStore.js.
        rbNonDataWrite: true,
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw serverError(res, data, ERROR_COPY.CHECK_CODE);
      }
      const data = await res.json();
      writePendingEmail('');
      onAuthSuccess(data.email, data.user_id, data.picture_url, !!data.google_linked);
    } catch (err) {
      const msg = err.name === 'TypeError'
        ? ERROR_COPY.CONNECTION
        : userErrorMessage(err, ERROR_COPY.CHECK_CODE);
      setError(msg);
      console.error(`[Auth:OTP] verify-otp failed: email=${email.trim()}, error=${err.message}, browser=${navigator.userAgent}`);
      // A failed verify (wrong code, expired code, ...) must not leave the boxes holding
      // the rejected digits -- the retry needs fresh, empty boxes focused at box 0, or a
      // single corrected digit silently re-submits a code still made of old wrong digits.
      resetCode();
    } finally {
      verifyingRef.current = false;
      setLoading(false);
    }
  }, [email, code, onAuthSuccess, resetCode]);

  const handleCodeChange = useCallback((newCode) => {
    setCode(newCode);
    const isComplete = newCode.every(d => d !== '');
    if (isComplete && !codeWasCompleteRef.current) handleVerifyCode(newCode);
    codeWasCompleteRef.current = isComplete;
  }, [handleVerifyCode]);

  const handleChangeEmail = useCallback(() => {
    writePendingEmail('');
    setStep('email');
    resetCode();
    setError(null);
  }, [resetCode]);

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
          className="w-full px-3 py-2 coarse-pointer:min-h-[44px] bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
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
          {ACCOUNT_COPY.SEND_CODE}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400 text-center">
        Enter the 6-digit code sent to <span className="text-white">{email}</span>
      </p>
      <OtpCodeInput value={code} onChange={handleCodeChange} disabled={loading} autoFocusFirst focusResetToken={focusResetToken} />
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
          className="flex items-center justify-center coarse-pointer:min-h-[44px] text-blue-400 hover:text-blue-300 disabled:opacity-50"
        >
          {ACCOUNT_COPY.RESEND_CODE}
        </button>
        <span className="text-gray-600 self-center">|</span>
        <button
          type="button"
          onClick={handleChangeEmail}
          disabled={loading}
          className="flex items-center justify-center coarse-pointer:min-h-[44px] text-gray-400 hover:text-gray-300 disabled:opacity-50"
        >
          {ACCOUNT_COPY.USE_DIFFERENT_EMAIL}
        </button>
      </div>
    </div>
  );
}
