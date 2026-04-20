import { create } from 'zustand';
import { API_BASE } from '../config';
import { getUserId, setUserId, resetSession } from '../utils/sessionInit';
import { useCreditStore } from './creditStore';
import { useEditorStore } from './editorStore';
import { useGamesDataStore } from './gamesDataStore';
import { useProjectsStore } from './projectsStore';
import { track } from '../utils/analytics';

export const useAuthStore = create((set, get) => ({
  // State
  isAuthenticated: false,
  isAdmin: false,
  email: null,
  pictureUrl: null,  // T430: Google profile picture URL
  showAuthModal: false,
  showAccountSettings: false,  // T430: Account settings panel
  pendingAction: null,
  isCheckingSession: true,  // true until initial session check completes
  // T1510: impersonation state — { id, email, expires_at } | null
  impersonator: null,
  // Auth error surfaced to the user (e.g. cookie blocked after reload)
  authError: null,

  // T550: Check if the current user is an admin
  checkAdmin: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/me`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      set({ isAdmin: data.is_admin });
    } catch {
      // Best-effort — non-critical
    }
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
  onAuthSuccess: (email, userId, pictureUrl = null) => {
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
        showAuthModal: false,
        pendingAction: null,
        authError: null,
      });
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
    set({
      isAuthenticated: true,
      email,
      pictureUrl,
      showAuthModal: false,
      pendingAction: null,
      authError: null,
    });
    track('login');
    useCreditStore.getState().fetchCredits();
    get().checkAdmin();
    if (pendingAction) {
      console.log('[Auth] Running pending action');
      pendingAction();
    }
  },

  // Called on app load after session check
  setSessionState: (isAuthenticated, email = null, pictureUrl = null, impersonator = null) => {
    console.log(`[Auth] Session state: authenticated=${isAuthenticated}${email ? `, email=${email}` : ''}${impersonator ? ` (impersonated by ${impersonator.email})` : ''}`);
    set({
      isAuthenticated,
      email,
      pictureUrl,
      impersonator,
      isCheckingSession: false,
    });
    // T530: Fetch credit balance if authenticated
    if (isAuthenticated) {
      useCreditStore.getState().fetchCredits();
    }
    // T550: Check admin status
    if (isAuthenticated) {
      useAuthStore.getState().checkAdmin();
    }
  },

  // T405: Logout — invalidate session and clear cookie
  logout: async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort — clear local state regardless
    }
    set({
      isAuthenticated: false,
      isAdmin: false,
      email: null,
      pictureUrl: null,
      showAuthModal: false,
      showAccountSettings: false,
      pendingAction: null,
      isCheckingSession: false,
    });
    resetSession();
    window.location.reload();
  },

  // T1510: Start impersonating a target user. Admin gesture only.
  // Full page reload follows so all Zustand data stores reset naturally —
  // the stop flow does the same in reverse.
  startImpersonation: async (targetUserId) => {
    const res = await fetch(`${API_BASE}/api/admin/impersonate/${targetUserId}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Impersonation failed (${res.status}): ${body}`);
    }
    window.location.href = '/';
  },

  // T1510: Stop impersonating — server restores the admin's own session,
  // then we hard reload to wipe in-memory state from the impersonated user.
  stopImpersonation: async () => {
    try {
      await fetch(`${API_BASE}/api/admin/impersonate/stop`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort — reload regardless so the admin isn't stuck.
    }
    window.location.href = '/';
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
