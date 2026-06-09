import { create } from 'zustand';
import { SECTION_NAMES } from '../config/displayNames';
import { useFramingStore } from './framingStore';
import { useProjectDataStore } from './projectDataStore';
import { useOverlayStore } from './overlayStore';
import { useProjectsStore } from './projectsStore';
import { useVideoStore } from './videoStore';

/**
 * Editor Modes - String constants for mode comparisons
 *
 * Use these instead of magic strings like 'framing' or 'overlay'.
 * This prevents typos and enables IDE autocomplete.
 */
export const EDITOR_MODES = {
  FRAMING: 'framing',
  OVERLAY: 'overlay',
  ANNOTATE: 'annotate',
  PROJECT_MANAGER: 'project-manager',
  ADMIN: 'admin',
};

export const MODE_PATHS = {
  [EDITOR_MODES.PROJECT_MANAGER]: '/home',
  [EDITOR_MODES.ANNOTATE]: '/annotate',
  [EDITOR_MODES.FRAMING]: '/framing',
  [EDITOR_MODES.OVERLAY]: '/overlay',
  [EDITOR_MODES.ADMIN]: '/admin',
};

export const PATH_TO_MODE = Object.fromEntries(
  Object.entries(MODE_PATHS).map(([mode, path]) => [path, mode])
);

function updatePath(mode) {
  const path = MODE_PATHS[mode];
  if (path && window.location.pathname !== path) {
    window.history.pushState({ mode }, '', path);
  }
}

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
  PROJECT_MANAGER: { type: EDITOR_MODES.PROJECT_MANAGER, label: SECTION_NAMES.DRAFTS },
  FRAMING: { type: EDITOR_MODES.FRAMING, label: 'Framing' },
  OVERLAY: { type: EDITOR_MODES.OVERLAY, label: 'Overlay' },
  ANNOTATE: { type: EDITOR_MODES.ANNOTATE, label: 'Annotate' },
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
const initialMode = (() => {
  const path = window.location.pathname;
  return PATH_TO_MODE[path]
    || (path.startsWith('/home') ? EDITOR_MODES.PROJECT_MANAGER : null);
})();

export const useEditorStore = create((set, get) => ({
  // Current screen object (new typed approach)
  screen: initialMode ? getScreenByType(initialMode) : SCREENS.FRAMING,

  // Editor mode: 'framing' | 'overlay' | 'annotate' | 'project-manager'
  // DEPRECATED: Use screen.type instead. Kept for backward compatibility.
  editorMode: initialMode || EDITOR_MODES.FRAMING,

  // Mode switch confirmation dialog
  modeSwitchDialog: {
    isOpen: false,
    pendingMode: null,
    sourceMode: null, // 'framing' or 'overlay' - which mode we're leaving
  },

  // Selected layer for arrow key navigation: 'playhead' | 'crop' | 'highlight'
  selectedLayer: 'playhead',

  // Whether a clip is currently selected in annotate mode (drives quest panel auto-collapse)
  annotateHasSelectedClip: false,
  setAnnotateHasSelectedClip: (value) => set({ annotateHasSelectedClip: value }),

  // Actions

  /**
   * Navigate to a screen (new typed approach)
   * @param {Object} screen - Screen object from SCREENS
   */
  navigateTo: (screen) => {
    updatePath(screen.type);
    set({
      screen,
      editorMode: screen.type,
    });
  },

  /**
   * Set the editor mode directly (use when no confirmation needed)
   * DEPRECATED: Use navigateTo(SCREENS.X) instead for type safety
   */
  setEditorMode: (mode) => {
    updatePath(mode);
    set({
      editorMode: mode,
      screen: getScreenByType(mode),
    });
  },

  /**
   * Update mode to match browser history (popstate) without pushing a new entry.
   */
  setEditorModeFromPopState: (mode) => {
    set({
      editorMode: mode,
      screen: getScreenByType(mode),
    });
  },

  /**
   * Redirect to a mode, replacing the current history entry (no new pushState).
   * Use for error/fallback redirects to avoid back-button loops.
   */
  redirectToMode: (mode) => {
    const path = MODE_PATHS[mode];
    if (path) {
      window.history.replaceState({ mode }, '', path);
    }
    set({
      editorMode: mode,
      screen: getScreenByType(mode),
    });
  },

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
      updatePath(modeSwitchDialog.pendingMode);
      set({
        editorMode: modeSwitchDialog.pendingMode,
        screen: getScreenByType(modeSwitchDialog.pendingMode),
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
  isFramingMode: () => get().editorMode === EDITOR_MODES.FRAMING,

  /**
   * Check if currently in overlay mode
   * DEPRECATED: Use isScreen(SCREENS.OVERLAY) instead
   */
  isOverlayMode: () => get().editorMode === EDITOR_MODES.OVERLAY,

  /**
   * Check if currently in annotate mode
   * DEPRECATED: Use isScreen(SCREENS.ANNOTATE) instead
   */
  isAnnotateMode: () => get().editorMode === EDITOR_MODES.ANNOTATE,

  /**
   * Check if currently in project manager
   */
  isProjectManager: () => get().editorMode === EDITOR_MODES.PROJECT_MANAGER,
}));

export default useEditorStore;

// Popstate handler — registered at module scope (outside React lifecycle) so it
// survives React StrictMode's mount-cleanup-remount cycle in development.
// All state reads use getState() at call time so there are no stale closures.
// On HMR re-evaluation, the old handler is removed and a new one registered
// so it always references the current store instance.
function handlePopState() {
  const pathname = window.location.pathname;
  const targetMode = PATH_TO_MODE[pathname]
    || (pathname.startsWith('/home') ? EDITOR_MODES.PROJECT_MANAGER : undefined);
  const currentMode = useEditorStore.getState().editorMode;
  if (!targetMode || targetMode === currentMode) return;

  if (currentMode === EDITOR_MODES.FRAMING
      && useFramingStore.getState().framingChangedSinceExport
      && useProjectDataStore.getState().workingVideo?.url) {
    window.history.pushState({ mode: currentMode }, '', MODE_PATHS[currentMode]);
    useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.FRAMING);
    return;
  }

  if (currentMode === EDITOR_MODES.OVERLAY
      && useOverlayStore.getState().overlayChangedSinceExport
      && useProjectsStore.getState().selectedProject?.has_final_video) {
    window.history.pushState({ mode: currentMode }, '', MODE_PATHS[currentMode]);
    useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.OVERLAY);
    return;
  }

  if (targetMode === EDITOR_MODES.PROJECT_MANAGER) {
    useProjectsStore.getState().clearSelection();
    requestAnimationFrame(() => useProjectsStore.getState().fetchProjects());
  }

  useVideoStore.getState().reset();
  useEditorStore.getState().setEditorModeFromPopState(targetMode);
}

if (window.__popstateHandler) {
  window.removeEventListener('popstate', window.__popstateHandler);
} else {
  window.history.replaceState(
    { mode: useEditorStore.getState().editorMode },
    '',
    MODE_PATHS[useEditorStore.getState().editorMode] || '/home'
  );
}
window.__popstateHandler = handlePopState;
window.addEventListener('popstate', handlePopState);
