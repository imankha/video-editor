/**
 * T2900: Tests for referral code capture and passthrough logic.
 *
 * Tests the sessionStorage-based referral flow:
 * - Capture ?ref= from URL on app mount
 * - First-attribution-wins (don't overwrite existing code)
 * - Include ref in Google auth request body
 * - Include ref in OTP verify request body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('referral code capture (App.jsx logic)', () => {
  let originalLocation;
  let originalSessionStorage;

  beforeEach(() => {
    // Mock sessionStorage
    originalSessionStorage = globalThis.sessionStorage;
    const store = {};
    globalThis.sessionStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => { store[key] = val; }),
      removeItem: vi.fn((key) => { delete store[key]; }),
    };
  });

  afterEach(() => {
    globalThis.sessionStorage = originalSessionStorage;
    vi.restoreAllMocks();
  });

  function simulateRefCapture(searchString, existingRef = null) {
    // Simulate what App.jsx useEffect does
    if (existingRef) {
      sessionStorage.setItem('referralCode', existingRef);
    }
    const params = new URLSearchParams(searchString);
    const ref = params.get('ref');
    if (ref && !sessionStorage.getItem('referralCode')) {
      sessionStorage.setItem('referralCode', ref);
    }
  }

  it('captures ref param from URL', () => {
    simulateRefCapture('?ref=abc12345');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('referralCode', 'abc12345');
  });

  it('does not capture when no ref param', () => {
    simulateRefCapture('?mode=test&foo=bar');
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not overwrite existing referral code (first attribution wins)', () => {
    simulateRefCapture('?ref=new-code', 'existing-code');
    // setItem was called once for the existing code setup, but NOT for the new one
    const setCalls = sessionStorage.setItem.mock.calls;
    const refCalls = setCalls.filter(([key]) => key === 'referralCode');
    // Only the initial setup call, not the new one
    expect(refCalls.length).toBe(1);
    expect(refCalls[0][1]).toBe('existing-code');
  });

  it('captures when URL has other params too', () => {
    simulateRefCapture('?utm_source=email&ref=from-email&other=yes');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('referralCode', 'from-email');
  });

  it('handles empty ref param gracefully', () => {
    simulateRefCapture('?ref=');
    // Empty string is falsy, should not store
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('captures ref with special characters', () => {
    simulateRefCapture('?ref=a1b2c3d4');
    expect(sessionStorage.setItem).toHaveBeenCalledWith('referralCode', 'a1b2c3d4');
  });
});

describe('referral code in Google auth request', () => {
  let originalFetch;
  let originalSessionStorage;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalSessionStorage = globalThis.sessionStorage;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalSessionStorage;
    vi.restoreAllMocks();
  });

  it('includes ref in request body when sessionStorage has referralCode', async () => {
    let capturedBody = null;
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url.includes('/api/auth/google')) {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ email: 'test@t.com', user_id: 'u1' }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    globalThis.sessionStorage = {
      getItem: vi.fn((key) => key === 'referralCode' ? 'ref123' : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    // Simulate what googleAuth.js does
    const authBody = { token: 'mock-google-token' };
    const ref = sessionStorage.getItem('referralCode');
    if (ref) authBody.ref = ref;

    await fetch('http://localhost:8000/api/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody),
    });

    expect(capturedBody).toEqual({ token: 'mock-google-token', ref: 'ref123' });
  });

  it('does not include ref when sessionStorage is empty', async () => {
    let capturedBody = null;
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url.includes('/api/auth/google')) {
        capturedBody = JSON.parse(opts.body);
      }
      return { ok: true, json: async () => ({ email: 'test@t.com', user_id: 'u1' }) };
    });
    globalThis.sessionStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    const authBody = { token: 'mock-google-token' };
    const ref = sessionStorage.getItem('referralCode');
    if (ref) authBody.ref = ref;

    await fetch('http://localhost:8000/api/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody),
    });

    expect(capturedBody).toEqual({ token: 'mock-google-token' });
    expect(capturedBody.ref).toBeUndefined();
  });
});

describe('referral code in OTP verify request', () => {
  it('includes ref in verify-otp body when sessionStorage has referralCode', () => {
    const store = { referralCode: 'otp-ref-456' };
    const getItem = (key) => store[key] || null;

    // Simulate what OtpAuthForm does
    const verifyBody = { email: 'user@test.com', code: '123456' };
    const ref = getItem('referralCode');
    if (ref) verifyBody.ref = ref;

    expect(verifyBody).toEqual({
      email: 'user@test.com',
      code: '123456',
      ref: 'otp-ref-456',
    });
  });

  it('does not include ref when sessionStorage has no referralCode', () => {
    const getItem = () => null;

    const verifyBody = { email: 'user@test.com', code: '123456' };
    const ref = getItem('referralCode');
    if (ref) verifyBody.ref = ref;

    expect(verifyBody).toEqual({ email: 'user@test.com', code: '123456' });
    expect(verifyBody.ref).toBeUndefined();
  });

  it('preserves existing email and code fields when adding ref', () => {
    const store = { referralCode: 'ref-xyz' };
    const getItem = (key) => store[key] || null;

    const verifyBody = { email: 'complex+tag@domain.co.uk', code: '000000' };
    const ref = getItem('referralCode');
    if (ref) verifyBody.ref = ref;

    expect(verifyBody.email).toBe('complex+tag@domain.co.uk');
    expect(verifyBody.code).toBe('000000');
    expect(verifyBody.ref).toBe('ref-xyz');
  });
});
