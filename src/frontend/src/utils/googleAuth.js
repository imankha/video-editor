import { API_BASE } from '../config';
import apiFetch from './apiFetch';

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
    const authBody = { token: response.credential };
    const raw = sessionStorage.getItem('campaignParams');
    if (raw) {
      const campaign = JSON.parse(raw);
      if (campaign.ref)          authBody.ref = campaign.ref;
      if (campaign.ref_sport)    authBody.ref_sport = campaign.ref_sport;
      if (campaign.utm_source)   authBody.utm_source = campaign.utm_source;
      if (campaign.utm_medium)   authBody.utm_medium = campaign.utm_medium;
      if (campaign.utm_campaign) authBody.utm_campaign = campaign.utm_campaign;
      if (campaign.utm_content)  authBody.utm_content = campaign.utm_content;
      if (campaign.utm_term)     authBody.utm_term = campaign.utm_term;
      if (campaign.click_source) authBody.click_source = campaign.click_source;
    }
    const res = await apiFetch(`${API_BASE}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authBody),
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

/**
 * Wait for GIS to become available, then init and hand the consumer the
 * handle. The GIS script tag is `async defer`, so on a slow network — or
 * after a transient load failure during PWA startup — `window.google` may
 * not exist when a consumer first mounts. A one-shot `ensureGisInitialized()`
 * would then give up forever, leaving the Google button permanently missing
 * until the page is reloaded.
 *
 * This polls until GIS appears (recovering when the network comes back),
 * calls `onReady(gis)`, and gives up via `onTimeout` only after `maxWaitMs`.
 * Resolves immediately if GIS is already loaded. Returns an unsubscribe to
 * cancel the wait (call it from the effect cleanup).
 */
export function onGisReady({ onReady, onTimeout, intervalMs = 500, maxWaitMs = 12000 }) {
  const immediate = ensureGisInitialized();
  if (immediate) {
    onReady(immediate);
    return () => {};
  }
  let cancelled = false;
  let waited = 0;
  const id = setInterval(() => {
    if (cancelled) return;
    const gis = ensureGisInitialized();
    if (gis) {
      clearInterval(id);
      onReady(gis);
      return;
    }
    waited += intervalMs;
    if (waited >= maxWaitMs) {
      clearInterval(id);
      if (onTimeout) onTimeout();
    }
  }, intervalMs);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}
