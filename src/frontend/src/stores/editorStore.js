import { create } from 'zustand';

/**
 * Editor Store - Manages editor mode and UI layer selection
 *
 * This store consolidates cross-cutting editor state that was previously
 * managed via useState in App.jsx and passed down through props.
 *
 * State:
 * - editorMode: Current editing mode ('framing' | 'overlay' | 'annotate')
 * - modeSwitchDialog: Confirmation dialog state for mode changes
 * - selectedLayer: Active layer for keyboard navigation
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 */
export const useEditorStore = create((set, get) => ({
  // Editor mode: 'framing' | 'overlay' | 'annotate'
  editorMode: 'framing',

  // Mode switch confirmation dialog
  modeSwitchDialog: {
    isOpen: false,
    pendingMode: null,
  },

  // Selected layer for arrow key navigation: 'playhead' | 'crop' | 'highlight'
  selectedLayer: 'playhead',

  // Actions

  /**
   * Set the editor mode directly (use when no confirmation needed)
   */
  setEditorMode: (mode) => {
    console.log('[EditorStore] setEditorMode called:', mode, 'from:', get().editorMode);
    console.trace('[EditorStore] setEditorMode stack trace');
    set({ editorMode: mode });
  },

  /**
   * Open the mode switch confirmation dialog
   * @param {string} pendingMode - The mode user wants to switch to
   */
  openModeSwitchDialog: (pendingMode) => set({
    modeSwitchDialog: { isOpen: true, pendingMode }
  }),

  /**
   * Close the mode switch dialog without changing mode
   */
  closeModeSwitchDialog: () => set({
    modeSwitchDialog: { isOpen: false, pendingMode: null }
  }),

  /**
   * Confirm mode switch - closes dialog and changes mode
   */
  confirmModeSwitch: () => {
    const { modeSwitchDialog } = get();
    if (modeSwitchDialog.pendingMode) {
      set({
        editorMode: modeSwitchDialog.pendingMode,
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
   * Check if currently in framing mode
   */
  isFramingMode: () => get().editorMode === 'framing',

  /**
   * Check if currently in overlay mode
   */
  isOverlayMode: () => get().editorMode === 'overlay',

  /**
   * Check if currently in annotate mode
   */
  isAnnotateMode: () => get().editorMode === 'annotate',
}));

export default useEditorStore;
