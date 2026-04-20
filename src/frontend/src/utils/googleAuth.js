import { API_BASE } from '../config';

/**
 * Shared Google Identity Services (GIS) initialization.
 *
 * GIS complains loudly ("google.accounts.id.initialize() is called multiple
 * times") when re-initialized with a different callback, and re-initializing
 * aborts any in-flight FedCM prompt. This module guarantees a single init
 * per page load: the callback routes every credential to `handleCredential`,
 * which POSTs to /api/auth/google and resolves via authStore.onAuthSuccess.
 *
 * Consumers (GoogleOneTap, AuthGateModal) call `ensureGisInitialized()` and
 * then invoke `gis.prompt()` / `gis.renderButton(...)` as needed — they do
 * NOT call `gis.initialize()` themselves.
 *
 * Error surfacing: the last credential error is cached on the module and
 * exposed via `getLastAuthError()` / `clearLastAuthError()` so the modal
 * can render it. A listener API (`onAuthError`) lets the modal refresh when
 * an error arrives asynchronously.
 */

let _initialized = false;
let _lastError = null;
const _errorListeners = new Set();

function emitError(msg) {
  _lastError = msg;
  for (const fn of _errorListeners) fn(msg);
}

export function getLastAuthError() {
  return _lastError;
}

export function clearLastAuthError() {
  _lastError = null;
}

export function onAuthError(fn) {
  _errorListeners.add(fn);
  return () => _errorListeners.delete(fn);
}

async function handleCredential(response) {
  // Lazy import avoids a circular dep (authStore imports from sessionInit
  // which is fine, but this module shouldn't statically pull authStore).
  const { useAuthStore } = await import('../stores/authStore');
  if (!response?.credential) {
    const reason = response ? `response keys: ${Object.keys(response).join(',')}` : 'response is null/undefined';
    console.error(`[Auth:Google] No credential in callback. ${reason}. Browser: ${navigator.userAgent}`);
    emitError('Google sign-in failed. Please try again, or use email sign-in below.');
    return;
  }
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
      console.error(`[Auth:Google] Backend rejected token: status=${res.status}, detail=${detail}, browser=${navigator.userAgent}`);
      emitError(`Sign-in failed: ${detail}. Please try again, or use email sign-in.`);
      return;
    }
    const data = await res.json();
    clearLastAuthError();
    useAuthStore.getState().onAuthSuccess(data.email, data.user_id, data.picture_url);
  } catch (err) {
    const msg = err.name === 'TypeError'
      ? 'Network error — check your internet connection and try again.'
      : (err.message || 'Network error');
    console.error(`[Auth:Google] Credential exchange failed: ${err.message}, browser=${navigator.userAgent}`);
    emitError(msg);
  }
}

/**
 * Initialize GIS exactly once. Safe to call from any consumer. Returns the
 * `google.accounts.id` handle, or null if GIS isn't loaded yet.
 */
export function ensureGisInitialized() {
  const gis = window.google?.accounts?.id;
  if (!gis) return null;
  if (_initialized) return gis;
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('[googleAuth] VITE_GOOGLE_CLIENT_ID missing');
  }
  gis.initialize({
    client_id: clientId,
    callback: handleCredential,
    use_fedcm_for_prompt: true,
  });
  _initialized = true;
  return gis;
}
