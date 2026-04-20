/**
 * Session initialization — resolves user identity from server, installs
 * X-Profile-ID and X-User-ID headers on all subsequent fetch() requests.
 *
 * T1330: guest accounts removed. If /me returns 401, we set
 * `isAuthenticated=false` and resolve without a user_id. No init-guest
 * fallback; the app renders the empty shell until the user logs in.
 */

import axios from 'axios';
import { API_BASE } from '../config';
import { PROFILING_ENABLED } from './profiling';

let _profileId = null;
let _currentProfileId = null;
let _currentUserId = null;
let _fetchPatched = false;
let _axiosPatched = false;
let _initPromise = null;

/** Update the preloader progress bar (no-op if preloader already dismissed). */
function updatePreloader(percent, message) {
  if (window.__preloaderUpdate) window.__preloaderUpdate(percent, message);
}

/**
 * Retry a fetch call with exponential backoff. Handles 5xx and network
 * failures — used for cold-start resilience on Fly.io wake-ups.
 */
async function fetchWithRetry(url, options, { retries = 3, baseDelay = 1000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) return response;
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[sessionInit] ${url} returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        updatePreloader(5 + attempt * 5, 'Waking up server...');
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[sessionInit] ${url} returned ${response.status} after ${retries + 1} attempts`);
        return response;
      }
    } catch (err) {
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[sessionInit] ${url} network error: ${err.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        updatePreloader(5 + attempt * 5, 'Waking up server...');
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[sessionInit] ${url} network error after ${retries + 1} attempts: ${err.message}`);
        throw err;
      }
    }
  }
}

/**
 * Install global fetch interceptor that adds X-Profile-ID and X-User-ID
 * to all API requests. Also ensures credentials: 'include' for cookies.
 */
const SLOW_FETCH_MS = 500;

function installFetchInterceptor() {
  if (_fetchPatched) return;

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiRequest = url.startsWith('/api') || url.startsWith('/storage') || url.startsWith(`${API_BASE}/api`) || url.startsWith(`${API_BASE}/storage`);

    if (isApiRequest) {
      const reqId = crypto.randomUUID().slice(0, 8);
      init = { ...init };
      if (!init.credentials) {
        init.credentials = 'include';
      }
      init.headers = {
        ...(init.headers || {}),
        'X-Request-ID': reqId,
        ...(_currentProfileId ? { 'X-Profile-ID': _currentProfileId } : {}),
        ...(_currentUserId ? { 'X-User-ID': _currentUserId } : {}),
      };

      const t0 = performance.now();
      const method = (init.method || 'GET').toUpperCase();
      const pathOnly = url.replace(API_BASE, '').split('?')[0];
      const promise = originalFetch.call(window, input, init);
      promise.then(
        (response) => {
          const ttfb = Math.round(performance.now() - t0);
          // Clone + read body to measure body transfer time
          if (PROFILING_ENABLED) {
            const tBody0 = performance.now();
            response.clone().text().then(() => {
              const bodyMs = Math.round(performance.now() - tBody0);
              const total = Math.round(performance.now() - t0);
              if (total >= SLOW_FETCH_MS) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[SLOW FETCH] ${method} ${pathOnly} total=${total}ms ttfb=${ttfb}ms body=${bodyMs}ms req_id=${reqId} status=${response.status}`
                );
              }
              // User Timing mark for DevTools Performance timeline
              try {
                const markName = `api:${method}:${pathOnly}`;
                performance.mark(`${markName}:start`, { startTime: t0 });
                performance.mark(`${markName}:end`);
                performance.measure(markName, `${markName}:start`, `${markName}:end`);
                performance.clearMarks(`${markName}:start`);
                performance.clearMarks(`${markName}:end`);
              } catch { /* timing API unavailable */ }
            }, () => {});
          } else {
            const elapsed = Math.round(performance.now() - t0);
            if (elapsed >= SLOW_FETCH_MS) {
              // eslint-disable-next-line no-console
              console.warn(
                `[SLOW FETCH] ${method} ${pathOnly} ${elapsed}ms req_id=${reqId} status=${response.status}`
              );
            }
          }
        },
        () => {},
      );
      return promise;
    }
    return originalFetch.call(window, input, init);
  };

  _fetchPatched = true;
}

/**
 * Install axios interceptor that adds X-Profile-ID and X-User-ID
 * to all API requests. Also ensures withCredentials for cookies.
 */
function installAxiosInterceptor() {
  if (_axiosPatched) return;

  axios.interceptors.request.use((config) => {
    const url = config.url || '';
    const isApiRequest = url.startsWith('/api') || url.startsWith('/storage') || url.startsWith(`${API_BASE}/api`) || url.startsWith(`${API_BASE}/storage`);

    if (isApiRequest) {
      config.withCredentials = true;
      config.headers['X-Request-ID'] = crypto.randomUUID().slice(0, 8);
      if (_currentProfileId) {
        config.headers['X-Profile-ID'] = _currentProfileId;
      }
      if (_currentUserId) {
        config.headers['X-User-ID'] = _currentUserId;
      }
    }
    return config;
  });

  _axiosPatched = true;
}

installFetchInterceptor();
installAxiosInterceptor();

/**
 * Set the user ID for all subsequent API requests.
 * Called after /api/auth/me returns the user_id, or after onAuthSuccess.
 */
export function setUserId(userId) {
  _currentUserId = userId;
}

/**
 * Initialize the user session.
 *
 * 1. GET /api/auth/me — check for existing authenticated session
 *    - ok → use user_id, call /init to load profile
 *    - 401 → resolve with {userId: null, isAuthenticated: false}
 *
 * Safe to call multiple times — returns cached promise after first call.
 *
 * @returns {Promise<{profileId: string|null, userId: string|null, isNewUser: boolean, isAuthenticated: boolean}>}
 */
export async function initSession() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { useAuthStore } = await import('../stores/authStore');

    updatePreloader(10, 'Connecting to server...');
    const authExpected = sessionStorage.getItem('authExpected');
    if (authExpected) sessionStorage.removeItem('authExpected');

    let userId = null;
    let email = null;
    let pictureUrl = null;
    let impersonator = null;

    try {
      const meResponse = await fetchWithRetry(`${API_BASE}/api/auth/me`, {
        credentials: 'include',
      });
      if (meResponse.ok) {
        const meData = await meResponse.json();
        userId = meData.user_id;
        email = meData.email || null;
        pictureUrl = meData.picture_url || null;
        impersonator = meData.impersonator || null;
        _currentUserId = userId;
        console.log(`[Auth:Init] /me OK: user=${userId}, email=${email}${impersonator ? ` [impersonated by ${impersonator.email}]` : ''}`);
      } else {
        console.log(`[Auth:Init] /me returned ${meResponse.status} — unauthenticated`);
        if (authExpected) {
          // The user just completed sign-in but the session cookie didn't
          // survive the page reload. Most common cause: the browser is
          // blocking cross-site cookies (third-party cookie settings,
          // privacy mode, or SameSite/Secure mismatch).
          const errorMsg = 'Sign-in completed but your browser blocked the session cookie. ' +
            'Please disable "Block third-party cookies" in your browser settings, or try a different browser.';
          console.error(`[Auth:Init] Session cookie lost after sign-in for ${authExpected}. ` +
            'Cross-origin cookie blocked? Check SameSite/Secure settings and CORS config. ' +
            `Browser: ${navigator.userAgent}`);
          useAuthStore.setState({ authError: errorMsg });
        }
      }
    } catch (err) {
      console.warn('[sessionInit] /me check failed:', err.message || err);
    }

    if (!userId) {
      useAuthStore.getState().setSessionState(false);
      updatePreloader(40, 'Getting things ready...');
      return { profileId: null, userId: null, isNewUser: false, isAuthenticated: false };
    }

    // Authenticated — load profile + mark session state
    useAuthStore.getState().setSessionState(true, email, pictureUrl, impersonator);

    updatePreloader(25, 'Initializing profile...');
    const initResponse = await fetchWithRetry(`${API_BASE}/api/auth/init`, {
      method: 'POST',
    });
    if (!initResponse.ok) {
      throw new Error(`Session init failed: ${initResponse.status}`);
    }
    const initData = await initResponse.json();
    _profileId = initData.profile_id;
    _currentProfileId = initData.profile_id;
    updatePreloader(40, 'Getting things ready...');

    return {
      profileId: initData.profile_id,
      userId,
      isNewUser: initData.is_new_user,
      isAuthenticated: true,
    };
  })();

  return _initPromise;
}

export function getProfileId() {
  return _profileId;
}

/**
 * Update the profile ID used in the X-Profile-ID header.
 * Called on profile switch — no need to re-patch fetch().
 */
export function reinstallProfileHeader(newProfileId) {
  _currentProfileId = newProfileId;
  _profileId = newProfileId;
}

export function getUserId() {
  return _currentUserId;
}

/**
 * Reset session state. Called after auth changes (login/logout)
 * to force re-initialization on next initSession() call.
 */
export function resetSession() {
  _initPromise = null;
  _currentUserId = null;
  _currentProfileId = null;
  _profileId = null;
}
