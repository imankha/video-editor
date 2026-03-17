/**
 * Session initialization — resolves user identity from server, installs
 * X-Profile-ID and X-User-ID headers on all subsequent fetch() requests.
 *
 * T405: User identity comes from the SERVER, not the client.
 * - rb_session cookie → /api/auth/me → user_id (returning visitor)
 * - /api/auth/init-guest → new UUID + cookie (new visitor)
 * - No more ?user= URL param or localStorage user IDs
 *
 * T85b: reinstallProfileHeader() for profile switching.
 * The fetch interceptor reads from mutable variables,
 * so switching profiles just updates the variable — no re-patching needed.
 */

import axios from 'axios';
import { API_BASE } from '../config';

let _profileId = null;
let _currentProfileId = null;
let _currentUserId = null;
let _fetchPatched = false;
let _axiosPatched = false;
let _initPromise = null;
let _onGuestWrite = null;

/**
 * Register a callback that fires after any successful mutating API call
 * while the user is a guest. Used to track guest activity for the exit warning.
 */
export function setGuestWriteCallback(fn) {
  _onGuestWrite = fn;
}

/**
 * Install global fetch interceptor that adds X-Profile-ID and X-User-ID
 * to all API requests. Also ensures credentials: 'include' for cookies.
 */
function installFetchInterceptor() {
  if (_fetchPatched) return;

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiRequest = url.startsWith('/api') || url.startsWith('/storage') || url.startsWith(`${API_BASE}/api`) || url.startsWith(`${API_BASE}/storage`);

    if (isApiRequest) {
      init = { ...init };
      // Ensure cookies are sent (rb_session)
      if (!init.credentials) {
        init.credentials = 'include';
      }
      init.headers = {
        ...(init.headers || {}),
        ...(_currentProfileId ? { 'X-Profile-ID': _currentProfileId } : {}),
        ...(_currentUserId ? { 'X-User-ID': _currentUserId } : {}),
      };
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
      if (_currentProfileId) {
        config.headers['X-Profile-ID'] = _currentProfileId;
      }
      if (_currentUserId) {
        config.headers['X-User-ID'] = _currentUserId;
      }
    }
    return config;
  });

  // Fire guest-write callback on any successful mutating API call
  axios.interceptors.response.use((response) => {
    const method = response.config?.method?.toLowerCase();
    const isWrite = method && method !== 'get' && method !== 'head' && method !== 'options';
    if (isWrite && response.status < 400 && _onGuestWrite) {
      _onGuestWrite();
    }
    return response;
  });

  _axiosPatched = true;
}

// Patch interceptors at module load time (synchronous).
// _currentUserId is null until initSession() resolves — that's fine,
// the interceptor reads the mutable variable on each request.
installFetchInterceptor();
installAxiosInterceptor();

/**
 * Set the user ID for all subsequent API requests.
 * Called after /api/auth/me or /api/auth/init-guest returns the user_id.
 */
export function setUserId(userId) {
  _currentUserId = userId;
}

/**
 * Initialize the user session. Resolves user identity from server:
 *
 * 1. GET /api/auth/me — check for existing session (cookie-based)
 *    - If valid: use that user_id, set auth state
 * 2. If no session: POST /api/auth/init-guest — create anonymous user
 *    - Server generates UUID, creates session, sets cookie
 * 3. POST /api/auth/init — initialize profile + database for user
 *
 * Safe to call multiple times — returns cached promise after first call.
 *
 * @returns {Promise<{profileId: string, userId: string, isNewUser: boolean}>}
 */
export async function initSession() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { useAuthStore } = await import('../stores/authStore');
    let userId = null;

    // Step 1: Check for existing session via cookie
    const authExpected = sessionStorage.getItem('authExpected');
    if (authExpected) sessionStorage.removeItem('authExpected');
    try {
      const meResponse = await fetch(`${API_BASE}/api/auth/me`, {
        credentials: 'include',
      });
      if (meResponse.ok) {
        const meData = await meResponse.json();
        userId = meData.user_id;
        _currentUserId = userId;
        // Only authenticated if they have an email (Google sign-in).
        // A guest session has a user_id but no email — still not authenticated.
        useAuthStore.getState().setSessionState(!!meData.email, meData.email || null);
      } else if (authExpected) {
        console.error(`[Auth] Session cookie not received after sign-in for ${authExpected}. ` +
          'Cross-origin cookie blocked? Check SameSite/Secure settings and CORS config.');
      }
    } catch {
      // No session — will create guest below
    }

    // Step 2: No valid session — create anonymous guest
    if (!userId) {
      const guestResponse = await fetch(`${API_BASE}/api/auth/init-guest`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!guestResponse.ok) {
        throw new Error(`Guest init failed: ${guestResponse.status}`);
      }
      const guestData = await guestResponse.json();
      userId = guestData.user_id;
      _currentUserId = userId;
      _profileId = guestData.profile_id;
      _currentProfileId = guestData.profile_id;
      useAuthStore.getState().setSessionState(false);

      return {
        profileId: guestData.profile_id,
        userId: userId,
        isNewUser: guestData.is_new_user,
      };
    }

    // Step 3: Have a user_id (from session) — initialize profile
    const initResponse = await fetch(`${API_BASE}/api/auth/init`, {
      method: 'POST',
    });
    if (!initResponse.ok) {
      throw new Error(`Session init failed: ${initResponse.status}`);
    }
    const initData = await initResponse.json();
    _profileId = initData.profile_id;
    _currentProfileId = initData.profile_id;

    return {
      profileId: initData.profile_id,
      userId: userId,
      isNewUser: initData.is_new_user,
    };
  })();

  return _initPromise;
}

/**
 * Get the current profile ID (null if init hasn't completed).
 */
export function getProfileId() {
  return _profileId;
}

/**
 * Update the profile ID used in the X-Profile-ID header.
 * Called on profile switch — no need to re-patch fetch().
 *
 * @param {string} newProfileId - The new profile GUID to use
 */
export function reinstallProfileHeader(newProfileId) {
  _currentProfileId = newProfileId;
  _profileId = newProfileId;
}

/**
 * Get the current user ID (null until initSession resolves).
 */
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
