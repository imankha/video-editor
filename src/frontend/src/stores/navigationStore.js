import { create } from 'zustand';

/**
 * Navigation store for app-wide screen transitions
 *
 * Modes:
 * - 'project-manager': Project/game selection
 * - 'annotate': Mark clips in game footage
 * - 'framing': Crop, trim, speed editing
 * - 'overlay': Highlight effects
 */
export const useNavigationStore = create((set, get) => ({
  // Current screen/mode
  mode: 'project-manager',

  // Previous mode (for back navigation)
  previousMode: null,

  // Selected project ID (null = no project selected)
  projectId: null,

  // Navigation history for breadcrumb-style navigation
  history: [],

  // Actions
  navigate: (newMode, options = {}) => {
    const { mode } = get();

    // Don't navigate to same mode
    if (newMode === mode) return;

    set({
      previousMode: mode,
      mode: newMode,
      history: [...get().history, mode].slice(-10), // Keep last 10
    });

    // Optional callback after navigation
    if (options.onNavigate) {
      options.onNavigate(newMode);
    }
  },

  goBack: () => {
    const { previousMode, history } = get();
    if (previousMode) {
      set({
        mode: previousMode,
        previousMode: history[history.length - 1] || null,
        history: history.slice(0, -1),
      });
    }
  },

  setProjectId: (id) => set({ projectId: id }),

  clearProject: () => set({
    projectId: null,
    mode: 'project-manager'
  }),

  // Reset to initial state
  reset: () => set({
    mode: 'project-manager',
    previousMode: null,
    projectId: null,
    history: [],
  }),
}));

// Selector hooks for common patterns
export const useCurrentMode = () => useNavigationStore(state => state.mode);
export const useProjectId = () => useNavigationStore(state => state.projectId);
export const useNavigate = () => useNavigationStore(state => state.navigate);
