import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  // State
  isAuthenticated: false,
  email: null,
  showAuthModal: false,
  pendingAction: null,
  isCheckingSession: true,  // true until initial session check completes

  // Gate action: shows modal if not authenticated, runs action if authenticated
  requireAuth: (action) => {
    if (get().isAuthenticated) {
      action();
      return;
    }
    set({ showAuthModal: true, pendingAction: action });
  },

  // Called after successful Google sign-in (or OTP in T401)
  onAuthSuccess: (email) => {
    const { pendingAction } = get();
    set({
      isAuthenticated: true,
      email,
      showAuthModal: false,
      pendingAction: null,
    });
    // Run the action that was blocked by the auth gate
    if (pendingAction) {
      pendingAction();
    }
  },

  // Called on app load after session check
  setSessionState: (isAuthenticated, email = null) => {
    set({ isAuthenticated, email, isCheckingSession: false });
  },

  // Close modal without authenticating
  closeAuthModal: () => {
    set({ showAuthModal: false, pendingAction: null });
  },

  // Reset on profile switch
  reset: () => set({
    isAuthenticated: false,
    email: null,
    showAuthModal: false,
    pendingAction: null,
    isCheckingSession: false,
  }),
}));

// Selector hooks
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);
export const useAuthEmail = () => useAuthStore((state) => state.email);
export const useShowAuthModal = () => useAuthStore((state) => state.showAuthModal);
