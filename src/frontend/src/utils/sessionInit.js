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
import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import apiFetch from './apiFetch';
import { checkServerVersion } from './appVersion';
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
      const response = await apiFetch(url, options);
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
// 1s ttfb is baseline R2 sync cost (see T1590), so anything under ~2s is
// expected behavior, not a signal worth logging.
const SLOW_FETCH_MS = 2000;

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
      // jsdom (test env) has no window.matchMedia -- feature-detect same as
      // every other matchMedia call site in this codebase (useIsMobile.js,
      // useTilePreview.js, RecapPlayerModal.jsx, etc).
      const isPwa = typeof window.matchMedia === 'function'
        && window.matchMedia('(display-mode: standalone)').matches;
      const isMobile = window.innerWidth <= 768;
      const platform = `${isPwa ? 'pwa' : 'webapp'}-${isMobile ? 'mobile' : 'desktop'}`;
      // T14970: a caller may name a profile for one read (deep-link lookup across the
      // user's profiles). The backend still refuses a profile the user does not own.
      const profileId = init.headers?.['X-Profile-ID'] || _currentProfileId;
      init.headers = {
        ...(init.headers || {}),
        'X-Request-ID': reqId,
        ...(profileId ? { 'X-Profile-ID': profileId } : {}),
        ...(_currentUserId ? { 'X-User-ID': _currentUserId } : {}),
        ...(isPwa ? { 'X-PWA': '1' } : {}),
        'X-Platform': platform,
      };

      const t0 = performance.now();
      const method = (init.method || 'GET').toUpperCase();
      const pathOnly = url.replace(API_BASE, '').split('?')[0];
      const promise = originalFetch.call(window, input, init);
      promise.then(
        (response) => {
          // This whole callback is passive diagnostics (build-version probe +
          // slow-fetch logging + perf marks) riding an already-in-flight response
          // -- it must never affect the real response the caller awaits, and a
          // response shaped unlike a real fetch Response (e.g. a test's plain
          // mock object with no `.headers`) must not turn into an unhandled
          // rejection here (onFulfilled exceptions reject the derived promise
          // from `.then()`, which nothing awaits).
          try {
            // Tbug40p: passive truth check — every API response already in flight
            // doubles as a build-number probe (zero extra requests). Gate iff the
            // server's build is strictly newer than this client's baked build.
            // Tbug41s made this async (it may consult the ServiceWorker for a waiting
            // bundle); deliberately not awaited — the response path must not wait on a
            // gate decision. Trailing catch keeps a probe failure off the console as an
            // unhandled rejection.
            checkServerVersion(response.headers?.get('X-App-Build')).catch(() => {});

            // T13810: expose the request id so write/fetch trace entries can name
            // the exact backend request ([REQ]/[STATE] log lines carry the same id).
            response.reqId = reqId;

            const ttfb = Math.round(performance.now() - t0);
            // Clone + read body to measure body transfer time
            if (PROFILING_ENABLED) {
              const tBody0 = performance.now();
              response.clone().text().then((bodyText) => {
                const bodyMs = Math.round(performance.now() - tBody0);
                const total = Math.round(performance.now() - t0);
                const sizeKB = (bodyText.length / 1024).toFixed(1);
                if (total >= SLOW_FETCH_MS) {

                  console.warn(
                    `[SLOW FETCH] ${method} ${pathOnly} total=${total}ms ttfb=${ttfb}ms body=${bodyMs}ms size=${sizeKB}KB req_id=${reqId} status=${response.status}`
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

                console.warn(
                  `[SLOW FETCH] ${method} ${pathOnly} ${elapsed}ms req_id=${reqId} status=${response.status}`
                );
              }
            }
          } catch { /* diagnostics only — never affect the real response */ }
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

    // T11500: DEV-only ?dev_account=<preset> link login (gesture = clicking the link).
    // Success navigates away; failure strips the param and records the error.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev_account')) {
      const { loginFromUrlParam } = await import('./devAccounts');
      const { useDevAccountStore } = await import('../stores/devAccountStore');
      const devError = await loginFromUrlParam();
      if (devError) useDevAccountStore.getState().setError(devError);
    }

    let userId = null;
    let email = null;
    let pictureUrl = null;
    let googleLinked = false;
    let impersonator = null;

    try {
      const meResponse = await fetchWithRetry(`${API_BASE}/api/auth/me`, undefined, { retries: 2, baseDelay: 500 });
      if (meResponse.ok) {
        const meData = await meResponse.json();
        userId = meData.user_id;
        email = meData.email || null;
        pictureUrl = meData.picture_url || null;
        googleLinked = !!meData.google_linked;
        impersonator = meData.impersonator || null;
        _currentUserId = userId;
        if (meData.needs_terms_acceptance) {
          useAuthStore.setState({ needsTermsAcceptance: true });
        }
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
      // T11500: DEV-only probe; isCheckingSession stays true until it resolves.
      if (import.meta.env.DEV) {
        const { probeDevAccounts } = await import('./devAccounts');
        const { useDevAccountStore } = await import('../stores/devAccountStore');
        useDevAccountStore.getState().setFromProbe(await probeDevAccounts());
      }
      useAuthStore.getState().setSessionState(false);
      updatePreloader(40, 'Getting things ready...');
      return { profileId: null, userId: null, isNewUser: false, isAuthenticated: false, profileReady: Promise.resolve() };
    }

    // T3360: Phase A complete (auth/me resolved). Do NOT call setSessionState
    // yet -- that happens after Phase B sets _currentProfileId, preventing
    // reactive fetches from arriving at the backend without X-Profile-ID.

    // Phase B: fire auth/init (profile DB download) -- callers can await
    // profileReady to know when profile-dependent endpoints are safe.
    updatePreloader(25, 'Initializing profile...');
    const cachedProfileId = _currentProfileId || sessionStorage.getItem('rb_profile_id');
    const initBody = cachedProfileId ? JSON.stringify({ profile_id: cachedProfileId }) : '{}';
    const profileReady = fetchWithRetry(`${API_BASE}/api/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: initBody,
      rbNonDataWrite: true, // T6020: fires on every app load, not a user gesture
    }).then(async (initResponse) => {
      if (!initResponse.ok) {
        throw new Error(`Session init failed: ${initResponse.status}`);
      }
      const initData = await initResponse.json();

      // T14970: /auth/init treats profile_id as a hint and answers with the active profile, so
      // an unowned value would quietly fall back; the URL's profile is checked here instead.
      const tabProfileId = await resolveTabProfile(initData.profile_id);

      _profileId = tabProfileId;
      _currentProfileId = tabProfileId;
      sessionStorage.setItem('rb_profile_id', tabProfileId);

      // NOW set session state -- _currentProfileId is set so all subsequent
      // requests will include X-Profile-ID header.
      useAuthStore.getState().setSessionState(true, email, pictureUrl, impersonator, { skipFetches: true, googleLinked });
      updatePreloader(40, 'Getting things ready...');

      if (useAuthStore.getState().needsTermsAcceptance) {
        apiFetch(`${API_BASE}/api/auth/accept-terms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terms_version: '2026-05-07' }),
          rbNonDataWrite: true, // T6020: session-init reconciliation, not a user gesture
        }).then(() => {
          useAuthStore.setState({ needsTermsAcceptance: false });
        }).catch(() => {});
      }

      return initData;
    });

    return {
      userId,
      isAuthenticated: true,
      profileReady,
    };
  })();

  return _initPromise;
}

/**
 * T14970: name this tab's profile on a same-origin media URL. <video> and <img> cannot send
 * X-Profile-ID, so without this they read the ACTIVE profile's row for the same id. Always
 * named, even when the tab matches the active profile now: another tab can switch the account
 * at any moment, and this one would not hear about it.
 */
export function withTabProfile(url) {
  if (!_currentProfileId) return url;
  const isSameOrigin = url.startsWith('/') || (API_BASE && url.startsWith(API_BASE));
  if (!isSameOrigin) return url;
  const [path, fragment] = url.split('#');
  const joined = `${path}${path.includes('?') ? '&' : '?'}profile_id=${_currentProfileId}`;
  return fragment ? `${joined}#${fragment}` : joined;
}

/**
 * T14970: the profile this tab should use, given the one it would otherwise have. An editor
 * URL names its profile, and that must be settled before anything loads. Held by this tab
 * only: restoring a page never writes the active profile. A profile that cannot be used
 * lands on Games; the URL's object never opens in another profile.
 */
async function resolveTabProfile(fallbackProfileId) {
  const { parseEditorPath, useEditorStore } = await import('../stores/editorStore');
  const urlProfileId = parseEditorPath().profileId;
  if (!urlProfileId || urlProfileId === fallbackProfileId) return fallbackProfileId;

  const { owned, unavailable } = await checkUrlProfile(urlProfileId);
  if (owned) return urlProfileId;
  const kind = window.location.pathname.startsWith('/annotate') ? DEEP_LINK_KIND.GAME : DEEP_LINK_KIND.PROJECT;
  useEditorStore.getState().rejectUrlProfile({ kind, unavailable });
  return fallbackProfileId;
}

/** For a sign-in on the page, which skips initSession. Resolve before opening the session. */
export async function applyUrlProfile() {
  const tabProfileId = await resolveTabProfile(_currentProfileId);
  if (!tabProfileId) return;
  _profileId = tabProfileId;
  _currentProfileId = tabProfileId;
}

/** Is an editor URL's profile one this user owns? `unavailable` means the check itself failed. */
async function checkUrlProfile(profileId) {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/profiles`);
    if (!response.ok) return { owned: false, unavailable: true };
    const { profiles } = await response.json();
    return { owned: profiles.some((p) => p.id === profileId), unavailable: false };
  } catch (err) {
    console.warn('[sessionInit] could not check the URL profile:', err.message);
    return { owned: false, unavailable: true };
  }
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
 * T7520: Clear the X-Profile-ID header immediately.
 *
 * During an impersonation start/stop (or logout) the session cookie flips the
 * moment the fetch resolves, but the OLD page keeps running until
 * `window.location.href`/`reload()` navigates. Any request that fires in that
 * window would otherwise carry the NEW session's user together with the STALE
 * impersonated profile id still held here — which the backend guard now rejects
 * (404), and which previously created a cross-tenant profile.sqlite. Dropping
 * the module-scoped header AND the persisted sessionStorage copy closes that
 * window so no such request is even emitted.
 */
export function clearProfileHeader() {
  _currentProfileId = null;
  _profileId = null;
  sessionStorage.removeItem('rb_profile_id');
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
