/**
 * Session initialization — calls /api/auth/init and installs the
 * X-Profile-ID header on all subsequent fetch() requests.
 *
 * This is the frontend counterpart of backend session_init.py.
 * When real auth is added, call this after login instead of on app mount.
 */

import { API_BASE } from '../config';

let _profileId = null;
let _initPromise = null;

/**
 * Install a global fetch interceptor that adds X-Profile-ID to all
 * API requests. Called once after /api/auth/init returns.
 */
function installProfileHeader(profileId) {
  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    // Only add header to our API requests (relative URLs or same-origin)
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiRequest = url.startsWith('/api') || url.startsWith(`${API_BASE}/api`);

    if (isApiRequest && profileId) {
      init = { ...init };
      init.headers = {
        ...(init.headers || {}),
        'X-Profile-ID': profileId,
      };
    }
    return originalFetch.call(window, input, init);
  };
}

/**
 * Initialize the user session. Calls /api/auth/init, stores the profile ID,
 * and patches fetch() to include it on all subsequent requests.
 *
 * Safe to call multiple times — returns cached promise after first call.
 *
 * @returns {Promise<{profileId: string, userId: string, isNewUser: boolean}>}
 */
export async function initSession() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const response = await fetch(`${API_BASE}/api/auth/init`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Session init failed: ${response.status}`);
    }

    const data = await response.json();
    _profileId = data.profile_id;

    // Patch fetch() to include X-Profile-ID on all API requests
    installProfileHeader(_profileId);

    return {
      profileId: data.profile_id,
      userId: data.user_id,
      isNewUser: data.is_new_user,
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
