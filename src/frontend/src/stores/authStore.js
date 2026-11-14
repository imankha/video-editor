import { create } from 'zustand';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { getUserId, setUserId, resetSession, clearProfileHeader, applyUrlProfile } from '../utils/sessionInit';
import { useCreditStore } from './creditStore';
import { useEditorStore, EDITOR_MODES, MODE_PATHS, parseEditorPath } from './editorStore';
import { useGamesDataStore } from './gamesDataStore';
import { useProjectsStore } from './projectsStore';
import { track } from '../utils/analytics';

let _checkAdminPromise = null;

// T13090: marks that this browser held a signed-in session, so a cold load that finds
// it gone can explain why instead of showing the bare sign-in card. Cleared by logout.
const HAD_SESSION_KEY = 'rb_had_session';
const readHadSession = () => {
  try { return localStorage.getItem(HAD_SESSION_KEY) === '1'; } catch { return false; }
};
const writeHadSession = (had) => {
  try {
    if (had) localStorage.setItem(HAD_SESSION_KEY, '1');
    else localStorage.removeItem(HAD_SESSION_KEY);
  } catch { /* storage blocked: the notice is best-effort */ }
};

// T14990: tab-scoped snapshot of the point the admin landed on, so
// ImpersonationBanner can offer "Reopen their page" at any later point in
// the session without a second backend round trip. Ephemeral per-device
// admin UI state (same narrow exception as a dismissed-hint flag), never
// the user's own data -- cleared implicitly when the tab/session ends.
const IMPERSONATION_LANDING_KEY = 'rb_impersonation_landing_point';

/** True when `path` names an object (`/g/{id}` or `/p/{id}`) -- the cases
 * where T14970's URL grammar requires an explicit `?profile=` or it treats
 * the link as an old bookmark and may switch the user's active profile. */
function _pathNamesAnObject(path) {
  return /\/(g|p)\/\d+/.test(path || '');
}

/**
 * T14990: build the impersonation landing URL from a (resolved) resume
 * point. Never a raw string-concat of point.path + query (the path may
 * already carry its own query string from the point's own capture) --
 * parses then re-sets the params that matter, preserving anything else.
 *
 * Falls back to '/' whenever landing in the point's own profile can't be
 * guaranteed: no point, no path, an object path with no profile_id, or an
 * object path whose profile_id didn't resolve to a real profile (deleted
 * since the point was written) -- the user's active profile must never
 * change as a side effect of impersonation (T7520/T14970 invariant).
 */
/**
 * T14990: read back the snapshot `startImpersonation` stored, for the banner's
 * "Reopen their page" link. Returns null when impersonation started with no
 * resolvable point (landed on '/', nothing to reopen).
 */
export function getImpersonationLandingPoint() {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_LANDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function buildImpersonationLandingUrl(point) {
  if (!point || !point.path) return '/';
  if (_pathNamesAnObject(point.path) && (!point.profile_id || point.profile_name == null)) {
    return '/';
  }
  const [pathname, search] = point.path.split('?');
  const params = new URLSearchParams(search || '');
  if (point.profile_id) params.set('profile', point.profile_id);
  if (typeof point.t === 'number') params.set('t', String(point.t));
  if (point.dialog) params.set('dialog', point.dialog);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const useAuthStore = create((set, get) => ({
  // State
  isAuthenticated: false,
  isAdmin: false,
  adminEnvironment: null,
  email: null,
  pictureUrl: null,  // T430: Google profile picture URL
  googleLinked: false,  // T13410: account has a linked Google identity (vs email-code only)
  showAuthModal: false,
  showAccountSettings: false,  // T430: Account settings panel
  needsTermsAcceptance: false,  // T1740: Passive terms acceptance for new users
  pendingAction: null,
  isCheckingSession: true,  // true until initial session check completes
  // T1510: impersonation state — { id, email, expires_at } | null
  impersonator: null,
  // Auth error surfaced to the user (e.g. cookie blocked after reload)
  authError: null,
  // T13090: a signed-in session was lost (replaced/expired) — sign-in card explains why
  sessionEnded: false,

  // T550: Check if the current user is an admin
  checkAdmin: async () => {
    if (_checkAdminPromise) return _checkAdminPromise;
    _checkAdminPromise = (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/admin/me`);
        if (!res.ok) {
          console.warn(`[Auth] checkAdmin: /api/admin/me returned ${res.status}`);
          return;
        }
        const data = await res.json();
        set({ isAdmin: data.is_admin, adminEnvironment: data.environment || null });
      } catch (err) {
        console.warn('[Auth] checkAdmin failed:', err.message || err);
      } finally {
        _checkAdminPromise = null;
      }
    })();
    return _checkAdminPromise;
  },

  // Gate action: shows modal if not authenticated, runs action if authenticated
  requireAuth: (action) => {
    if (get().isAuthenticated) {
      action();
      return;
    }
    // No gis.cancel() here — canceling an in-flight FedCM prompt emits a
    // noisy AbortError, and both surfaces now share the same callback, so
    // the floating One Tap coexisting with the modal is harmless.
    set({ showAuthModal: true, pendingAction: action });
  },

  // Called after successful Google sign-in (or OTP in T401)
  // T405: Also receives user_id for cross-device recovery (may differ from current guest)
  onAuthSuccess: (email, userId, pictureUrl = null, googleLinked = false) => {
    const { pendingAction } = get();
    console.log(`[Auth] onAuthSuccess: email=${email}, userId=${userId}, hasPendingAction=${!!pendingAction}`);

    const currentUserId = getUserId();
    // Cross-device recovery: the server returned a DIFFERENT user_id than what
    // we already have loaded in memory. We must reload to re-initialize stores
    // with the recovered user's data. This only applies when we already have a
    // user_id loaded (i.e. switching between two known accounts), NOT on first
    // login from unauthenticated state where currentUserId is null.
    const needsReload = currentUserId && userId && userId !== currentUserId;

    if (needsReload) {
      console.log(`[Auth] Cross-device recovery: switching ${currentUserId} → ${userId}, reloading`);
      setUserId(userId);
      set({
        isAuthenticated: true,
        email,
        pictureUrl,
        googleLinked,
        showAuthModal: false,
        pendingAction: null,
        authError: null,
        sessionEnded: false,
      });
      writeHadSession(true);
      // Save navigation state so the user returns to the same screen after reload
      const editorMode = useEditorStore.getState().editorMode;
      sessionStorage.setItem('authReturnMode', editorMode);
      const projectId = useProjectsStore.getState().selectedProjectId;
      if (projectId) {
        sessionStorage.setItem('authReturnProjectId', projectId.toString());
      }
      // T415: Save game context for annotation mode return
      const selectedGame = useGamesDataStore.getState().selectedGame;
      if (selectedGame) {
        sessionStorage.setItem('authReturnGameHash', selectedGame.blake3_hash || '');
        sessionStorage.setItem('authReturnGameName', selectedGame.name || '');
      }
      sessionStorage.setItem('authExpected', email);
      window.location.reload();
      return;
    }

    // First login or same-device login — no reload needed
    console.log(`[Auth] Login success: ${email} (user=${userId || currentUserId})`);
    if (userId) setUserId(userId);
    const openSession = () => {
      set({
        isAuthenticated: true,
        email,
        pictureUrl,
        googleLinked,
        showAuthModal: false,
        pendingAction: null,
        authError: null,
        sessionEnded: false,
      });
      writeHadSession(true);
      track('login');
      useCreditStore.getState().fetchCredits();
      get().checkAdmin();
      if (pendingAction) {
        console.log('[Auth] Running pending action');
        pendingAction();
      }
    };

    // T14970: this path skips initSession, so an editor URL's profile has not been settled.
    // It must be before the session opens, or the object opens in the active profile. Not a
    // reload: pendingAction is a closure and would not survive one.
    if (parseEditorPath().profileId) {
      applyUrlProfile().then(openSession);
      return;
    }
    openSession();
  },

  // Called on app load after session check.
  // skipFetches: true when bootstrap will provide credits data. Admin status is
  // NEVER covered by bootstrap (GET /api/bootstrap has no is_admin field) so
  // checkAdmin() always runs on its own — otherwise isAdmin silently resets to
  // false on every hard reload (e.g. impersonate/stop-impersonate) and never
  // gets recomputed.
  setSessionState: (isAuthenticated, email = null, pictureUrl = null, impersonator = null, { skipFetches = false, googleLinked = false } = {}) => {
    console.log(`[Auth] Session state: authenticated=${isAuthenticated}${email ? `, email=${email}` : ''}${impersonator ? ` (impersonated by ${impersonator.email})` : ''}`);
    const hadSession = readHadSession();
    set({
      isAuthenticated,
      email,
      pictureUrl,
      googleLinked,
      impersonator,
      isCheckingSession: false,
      sessionEnded: !isAuthenticated && hadSession,
    });
    if (isAuthenticated) {
      writeHadSession(true);
      useAuthStore.getState().checkAdmin();
      if (!skipFetches) {
        useCreditStore.getState().fetchCredits();
      }
    }
  },

  // T405: Logout — invalidate session and clear cookie
  logout: async () => {
    // T14980: owner ruling 2026-11-08 -- sign-out records no point and sends no exit
    // beacon, so the row keeps the page right before it. Dynamic import: resumePoint.js
    // imports this store back (same module-cycle shape as uiTelemetry), so importing it
    // at this module's top level would read a binding before the cycle settles.
    const { suppressNextResumePointExit } = await import('../utils/resumePoint');
    suppressNextResumePointExit();
    try {
      await apiFetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        rbNonDataWrite: true, // T6020 follow-up: auth table write, not user-data
      });
    } catch {
      // Best-effort — clear local state regardless
    }
    set({
      isAuthenticated: false,
      isAdmin: false,
      adminEnvironment: null,
      email: null,
      pictureUrl: null,
      googleLinked: false,
      showAuthModal: false,
      showAccountSettings: false,
      pendingAction: null,
      isCheckingSession: false,
      sessionEnded: false,
    });
    writeHadSession(false); // deliberate sign-out: no "session ended" notice next time
    clearProfileHeader(); // T7520: drop the stale profile header before reload
    resetSession();
    window.location.reload();
  },

  // T1510: Start impersonating a target user. Admin gesture only.
  // Full page reload follows so all Zustand data stores reset naturally —
  // the stop flow does the same in reverse.
  // T14990: lands on the target's resume point (the same page their own
  // restore would open, dialog reopened) instead of always '/' -- owner
  // ruling 2026-11-08: no new button, the existing email click does this.
  startImpersonation: async (targetUserId) => {
    const res = await apiFetch(`${API_BASE}/api/admin/impersonate/${targetUserId}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Impersonation failed (${res.status}): ${body}`);
    }
    const body = await res.json();
    // T7520: the session cookie has flipped to the impersonated user, but this
    // (admin) page keeps running until the navigation below. Clear the admin's
    // stale X-Profile-ID NOW so no in-flight request carries the impersonated
    // session + admin profile (which would create a cross-tenant profile DB).
    clearProfileHeader();
    const point = body.resume_point || null;
    const landingUrl = buildImpersonationLandingUrl(point);
    // T15580: snapshot ANY point the backend returned, even one whose profile
    // didn't resolve (buildImpersonationLandingUrl then falls back to '/' for
    // safety) -- the banner's own render-time call to buildImpersonationLandingUrl
    // applies that same fallback, so storing it is never unsafe. Only a truly
    // absent point (nothing to reopen) clears the key.
    try {
      if (point) sessionStorage.setItem(IMPERSONATION_LANDING_KEY, JSON.stringify(point));
      else sessionStorage.removeItem(IMPERSONATION_LANDING_KEY);
    } catch { /* storage blocked: the banner summary is best-effort */ }
    window.location.href = landingUrl;
  },

  // T1510: Stop impersonating — server restores the admin's own session,
  // then we hard reload to wipe in-memory state from the impersonated user.
  // Land back on the admin panel (cold-load mode is derived from the URL,
  // see editorStore's modeFromPath) rather than dropping the admin at home.
  stopImpersonation: async () => {
    try {
      await apiFetch(`${API_BASE}/api/admin/impersonate/stop`, {
        method: 'POST',
      });
    } catch {
      // Best-effort — reload regardless so the admin isn't stuck.
    }
    // T7520: session cookie is back to the admin, but the impersonated page is
    // still live until navigation. Clear the impersonated X-Profile-ID NOW so
    // no in-flight request writes into the admin's dir under the victim's
    // profile id (the confirmed prod artifact).
    clearProfileHeader();
    window.location.href = MODE_PATHS[EDITOR_MODES.ADMIN];
  },

  // T430: Toggle account settings panel
  openAccountSettings: () => set({ showAccountSettings: true }),
  closeAccountSettings: () => set({ showAccountSettings: false }),

  // Close modal without authenticating
  closeAuthModal: () => {
    set({ showAuthModal: false, pendingAction: null });
  },
}));

// Selector hooks
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthEmail = () => useAuthStore((state) => state.email);
export const useShowAuthModal = () => useAuthStore((state) => state.showAuthModal);
