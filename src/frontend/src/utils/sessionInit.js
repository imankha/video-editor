/**
 * Session initialization — calls /api/auth/init and installs the
 * X-Profile-ID and X-User-ID headers on all subsequent fetch() requests.
 *
 * This is the frontend counterpart of backend session_init.py.
 * When real auth is added, call this after login instead of on app mount.
 *
 * T85b: Added reinstallProfileHeader() for profile switching.
 * The fetch interceptor reads from a mutable _currentProfileId variable,
 * so switching profiles just updates the variable — no re-patching needed.
 *
 * T220: Added URL-based user ID (?user=param -> localStorage -> X-User-ID header).
 * For multi-tester support without auth. Will be removed when real auth is added.
 */

import { API_BASE } from '../config';

let _profileId = null;
let _currentProfileId = null;
let _currentUserId = null;
let _fetchPatched = false;
let _initPromise = null;

/**
 * Resolve user ID from URL param (?user=) or localStorage.
 * Sanitizes to alphanumeric + underscore + hyphen only.
 * Cleans the URL after reading the param.
 */
function resolveUserId() {
  const params = new URLSearchParams(window.location.search);
  const urlUser = params.get('user');
  if (urlUser) {
    const sanitized = urlUser.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitized) {
      localStorage.setItem('reel-ballers-user-id', sanitized);
      params.delete('user');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      return sanitized;
    }
  }
  const stored = localStorage.getItem('reel-ballers-user-id');
  if (stored) return stored;

  // No user set — generate a random guest ID so this visitor gets their own
  // isolated account instead of defaulting to the backend's fallback user.
  const guestId = 'guest_' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('reel-ballers-user-id', guestId);
  return guestId;
}

/**
 * Install a global fetch interceptor that adds X-Profile-ID and X-User-ID to all
 * API requests. Called once at module load time and again after profile switches.
 *
 * Uses _currentProfileId (mutable) so profile switching doesn't
 * require re-patching fetch.
 */
function installProfileHeader(profileId) {
  _currentProfileId = profileId;

  if (_fetchPatched) return; // Only patch once

  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    // Only add header to our API requests (relative URLs or same-origin)
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiRequest = url.startsWith('/api') || url.startsWith(`${API_BASE}/api`);

    if (isApiRequest) {
      init = { ...init };
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

// Patch window.fetch at module load time (synchronous) so X-User-ID is present
// on ALL requests — including those fired by stores before initSession() resolves.
_currentUserId = resolveUserId();
installProfileHeader(null);

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
    _currentProfileId = data.profile_id;

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
 * Get the current user ID (null if no user param was provided).
 */
export function getUserId() {
  return _currentUserId;
}
