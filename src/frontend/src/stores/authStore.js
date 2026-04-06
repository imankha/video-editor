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
  hasGuestActivity: false,  // true once a guest user has done any write operation
  migrationPending: false,  // T820: true if a guest migration failed and needs retry

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

  // Mark that a guest has done meaningful work (triggers exit warning)
  markGuestActivity: () => {
    if (!get().isAuthenticated) {
      set({ hasGuestActivity: true });
    }
  },

  // Gate action: shows modal if not authenticated, runs action if authenticated
  requireAuth: (action) => {
    if (get().isAuthenticated) {
      action();
      return;
    }
    // Cancel Google One Tap before opening modal (prevents overlap)
    window.google?.accounts?.id?.cancel();
    set({ showAuthModal: true, pendingAction: action });
  },

  // Called after successful Google sign-in (or OTP in T401)
  // T405: Also receives user_id for cross-device recovery (may differ from current guest)
  onAuthSuccess: (email, userId, pictureUrl = null) => {
    const { pendingAction } = get();

    // T405: If the server returned a different user_id (cross-device recovery),
    // update the session headers and reload to pick up the recovered user's data
    const currentUserId = getUserId();
    if (userId && userId !== currentUserId) {
      setUserId(userId);
      set({
        isAuthenticated: true,
        email,
        pictureUrl,
        showAuthModal: false,
        pendingAction: null,
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
        // blake3_hash is stable across merge (game ID may differ in target DB)
        // Falls back to name for multi-video games where blake3_hash is null
        sessionStorage.setItem('authReturnGameHash', selectedGame.blake3_hash || '');
        sessionStorage.setItem('authReturnGameName', selectedGame.name || '');
      }
      // Reload to initialize with the recovered user's data.
      // Set flag so initSession can detect if the cookie didn't survive the reload.
      sessionStorage.setItem('authExpected', email);
      window.location.reload();
      return;
    }

    set({
      isAuthenticated: true,
      email,
      pictureUrl,
      showAuthModal: false,
      pendingAction: null,
    });
    track('login');
    // T530: Fetch credit balance after auth
    useCreditStore.getState().fetchCredits();
    // T550: Check admin status after auth
    get().checkAdmin();
    // Run the action that was blocked by the auth gate
    if (pendingAction) {
      pendingAction();
    }
  },

  // T820: Set migration pending state (called from sessionInit when /me returns migration_pending)
  setMigrationPending: (pending) => set({ migrationPending: pending }),

  // T820: Retry a failed migration
  retryMigration: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/retry-migration`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return { status: 'error' };
      const data = await res.json();
      if (data.status === 'success') {
        set({ migrationPending: false });
        // Reload to pick up migrated data
        window.location.reload();
      }
      return data;
    } catch {
      return { status: 'error' };
    }
  },

  // Called on app load after session check
  setSessionState: (isAuthenticated, email = null, pictureUrl = null) => {
    set({
      isAuthenticated,
      email,
      pictureUrl,
      isCheckingSession: false,
      // Clear guest activity once authenticated — no need for exit warning
      ...(isAuthenticated ? { hasGuestActivity: false } : {}),
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
