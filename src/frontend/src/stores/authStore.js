import { create } from 'zustand';
import { API_BASE } from '../config';
import { getUserId, setUserId, resetSession } from '../utils/sessionInit';
import { useCreditStore } from './creditStore';
import { useEditorStore } from './editorStore';
import { useProjectsStore } from './projectsStore';

export const useAuthStore = create((set, get) => ({
  // State
  isAuthenticated: false,
  isAdmin: false,
  email: null,
  showAuthModal: false,
  pendingAction: null,
  isCheckingSession: true,  // true until initial session check completes
  hasGuestActivity: false,  // true once a guest user has done any write operation

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
    set({ showAuthModal: true, pendingAction: action });
  },

  // Called after successful Google sign-in (or OTP in T401)
  // T405: Also receives user_id for cross-device recovery (may differ from current guest)
  onAuthSuccess: (email, userId) => {
    const { pendingAction } = get();

    // T405: If the server returned a different user_id (cross-device recovery),
    // update the session headers and reload to pick up the recovered user's data
    const currentUserId = getUserId();
    if (userId && userId !== currentUserId) {
      setUserId(userId);
      set({
        isAuthenticated: true,
        email,
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
      // Reload to initialize with the recovered user's data.
      // Set flag so initSession can detect if the cookie didn't survive the reload.
      sessionStorage.setItem('authExpected', email);
      window.location.reload();
      return;
    }

    set({
      isAuthenticated: true,
      email,
      showAuthModal: false,
      pendingAction: null,
    });
    // T530: Fetch credit balance after auth
    useCreditStore.getState().fetchCredits();
    // T550: Check admin status after auth
    get().checkAdmin();
    // Run the action that was blocked by the auth gate
    if (pendingAction) {
      pendingAction();
    }
  },

  // Called on app load after session check
  setSessionState: (isAuthenticated, email = null) => {
    set({
      isAuthenticated,
      email,
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
      showAuthModal: false,
      pendingAction: null,
      isCheckingSession: false,
    });
    resetSession();
    window.location.reload();
  },

  // Close modal without authenticating
  closeAuthModal: () => {
    set({ showAuthModal: false, pendingAction: null });
  },
}));

// Selector hooks
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthEmail = () => useAuthStore((state) => state.email);
export const useShowAuthModal = () => useAuthStore((state) => state.showAuthModal);
