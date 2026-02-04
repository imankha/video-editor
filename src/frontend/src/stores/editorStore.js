import { create } from 'zustand';

/**
 * Screen Types - Typed screen definitions for navigation
 *
 * Each screen has:
 * - type: Unique identifier (used for routing/comparison)
 * - label: Human-readable name (used in UI)
 *
 * Using objects instead of strings provides:
 * - Type safety (can't accidentally use wrong string)
 * - Exhaustive checking in switch statements
 * - Single source of truth for screen metadata
 */
export const SCREENS = {
  PROJECT_MANAGER: { type: 'project-manager', label: 'Projects' },
  FRAMING: { type: 'framing', label: 'Framing' },
  OVERLAY: { type: 'overlay', label: 'Overlay' },
  ANNOTATE: { type: 'annotate', label: 'Annotate' },
};

/**
 * Helper to get screen by type string (for backward compatibility)
 */
export const getScreenByType = (type) => {
  return Object.values(SCREENS).find(s => s.type === type) || SCREENS.PROJECT_MANAGER;
};

/**
 * Editor Store - Manages editor mode and UI layer selection
 *
 * This store consolidates cross-cutting editor state that was previously
 * managed via useState in App.jsx and passed down through props.
 *
 * State:
 * - editorMode: Current editing mode (string for backward compat, use screen.type)
 * - screen: Current screen object from SCREENS (new typed approach)
 * - modeSwitchDialog: Confirmation dialog state for mode changes
 * - selectedLayer: Active layer for keyboard navigation
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for migration plan
 */
export const useEditorStore = create((set, get) => ({
  // Current screen object (new typed approach)
  screen: SCREENS.FRAMING,

  // Editor mode: 'framing' | 'overlay' | 'annotate' | 'project-manager'
  // DEPRECATED: Use screen.type instead. Kept for backward compatibility.
  editorMode: 'framing',

  // Mode switch confirmation dialog
  modeSwitchDialog: {
    isOpen: false,
    pendingMode: null,
    sourceMode: null, // 'framing' or 'overlay' - which mode we're leaving
  },

  // Selected layer for arrow key navigation: 'playhead' | 'crop' | 'highlight'
  selectedLayer: 'playhead',

  // Actions

  /**
   * Navigate to a screen (new typed approach)
   * @param {Object} screen - Screen object from SCREENS
   */
  navigateTo: (screen) => set({
    screen,
    editorMode: screen.type, // Keep editorMode in sync for backward compat
  }),

  /**
   * Set the editor mode directly (use when no confirmation needed)
   * DEPRECATED: Use navigateTo(SCREENS.X) instead for type safety
   */
  setEditorMode: (mode) => set({
    editorMode: mode,
    screen: getScreenByType(mode), // Keep screen in sync
  }),

  /**
   * Open the mode switch confirmation dialog
   * @param {string} pendingMode - The mode user wants to switch to
   * @param {string} sourceMode - The mode we're leaving ('framing' or 'overlay')
   */
  openModeSwitchDialog: (pendingMode, sourceMode = 'framing') => set({
    modeSwitchDialog: { isOpen: true, pendingMode, sourceMode }
  }),

  /**
   * Close the mode switch dialog without changing mode
   */
  closeModeSwitchDialog: () => set({
    modeSwitchDialog: { isOpen: false, pendingMode: null, sourceMode: null }
  }),

  /**
   * Confirm mode switch - closes dialog and changes mode
   */
  confirmModeSwitch: () => {
    const { modeSwitchDialog } = get();
    if (modeSwitchDialog.pendingMode) {
      set({
        editorMode: modeSwitchDialog.pendingMode,
        screen: getScreenByType(modeSwitchDialog.pendingMode), // Keep screen in sync
        modeSwitchDialog: { isOpen: false, pendingMode: null }
      });
    }
  },

  /**
   * Set the selected layer for keyboard navigation
   * @param {'playhead' | 'crop' | 'highlight'} layer
   */
  setSelectedLayer: (layer) => set({ selectedLayer: layer }),

  // Computed/derived values as functions

  /**
   * Check if current screen matches the given screen
   * @param {Object} screen - Screen object from SCREENS
   */
  isScreen: (screen) => get().screen.type === screen.type,

  /**
   * Check if currently in framing mode
   * DEPRECATED: Use isScreen(SCREENS.FRAMING) instead
   */
  isFramingMode: () => get().editorMode === 'framing',

  /**
   * Check if currently in overlay mode
   * DEPRECATED: Use isScreen(SCREENS.OVERLAY) instead
   */
  isOverlayMode: () => get().editorMode === 'overlay',

  /**
   * Check if currently in annotate mode
   * DEPRECATED: Use isScreen(SCREENS.ANNOTATE) instead
   */
  isAnnotateMode: () => get().editorMode === 'annotate',

  /**
   * Check if currently in project manager
   */
  isProjectManager: () => get().editorMode === 'project-manager',
}));

export default useEditorStore;
