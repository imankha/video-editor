import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore, resolveEditorScreen, APP_SCREENS, EDITOR_MODES } from './editorStore';
import { useProjectsStore } from './projectsStore';

describe('editorStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useEditorStore.setState({
      editorMode: 'framing',
      modeSwitchDialog: { isOpen: false, pendingMode: null },
      selectedLayer: 'playhead',
    });
  });

  describe('editorMode', () => {
    it('starts in framing mode', () => {
      expect(useEditorStore.getState().editorMode).toBe('framing');
    });

    it('setEditorMode changes the mode', () => {
      useEditorStore.getState().setEditorMode('overlay');
      expect(useEditorStore.getState().editorMode).toBe('overlay');
    });

    it('setEditorMode to annotate works', () => {
      useEditorStore.getState().setEditorMode('annotate');
      expect(useEditorStore.getState().editorMode).toBe('annotate');
    });
  });

  describe('modeSwitchDialog', () => {
    it('starts closed with no pending mode', () => {
      const { modeSwitchDialog } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
    });

    it('openModeSwitchDialog opens dialog with pending mode', () => {
      useEditorStore.getState().openModeSwitchDialog('overlay');
      const { modeSwitchDialog } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(true);
      expect(modeSwitchDialog.pendingMode).toBe('overlay');
    });

    it('closeModeSwitchDialog closes without changing mode', () => {
      useEditorStore.getState().openModeSwitchDialog('overlay');
      useEditorStore.getState().closeModeSwitchDialog();

      const { modeSwitchDialog, editorMode } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
      expect(editorMode).toBe('framing'); // Mode unchanged
    });

    it('confirmModeSwitch changes mode and closes dialog', () => {
      useEditorStore.getState().openModeSwitchDialog('annotate');
      useEditorStore.getState().confirmModeSwitch();

      const { modeSwitchDialog, editorMode } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
      expect(editorMode).toBe('annotate');
    });

    it('confirmModeSwitch does nothing if no pending mode', () => {
      useEditorStore.getState().confirmModeSwitch();
      expect(useEditorStore.getState().editorMode).toBe('framing');
    });
  });

  describe('selectedLayer', () => {
    it('starts with playhead selected', () => {
      expect(useEditorStore.getState().selectedLayer).toBe('playhead');
    });

    it('setSelectedLayer changes layer', () => {
      useEditorStore.getState().setSelectedLayer('crop');
      expect(useEditorStore.getState().selectedLayer).toBe('crop');
    });

    it('can select highlight layer', () => {
      useEditorStore.getState().setSelectedLayer('highlight');
      expect(useEditorStore.getState().selectedLayer).toBe('highlight');
    });
  });

  describe('resolveEditorScreen', () => {
    let warn, error;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('routes PROJECT_MANAGER home even when a project is still selected (the blank-screen bug)', () => {
      expect(resolveEditorScreen(EDITOR_MODES.PROJECT_MANAGER, true)).toBe(APP_SCREENS.HOME);
      expect(resolveEditorScreen(EDITOR_MODES.PROJECT_MANAGER, false)).toBe(APP_SCREENS.HOME);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it('routes FRAMING/OVERLAY to the editor when a project is selected', () => {
      expect(resolveEditorScreen(EDITOR_MODES.FRAMING, true)).toBe(APP_SCREENS.EDITOR);
      expect(resolveEditorScreen(EDITOR_MODES.OVERLAY, true)).toBe(APP_SCREENS.EDITOR);
      expect(warn).not.toHaveBeenCalled();
    });

    it('routes FRAMING/OVERLAY home and warns when no project is selected', () => {
      expect(resolveEditorScreen(EDITOR_MODES.OVERLAY, false)).toBe(APP_SCREENS.HOME);
      expect(warn).toHaveBeenCalled();
    });

    it('routes ANNOTATE to the editor with or without a project', () => {
      expect(resolveEditorScreen(EDITOR_MODES.ANNOTATE, false)).toBe(APP_SCREENS.EDITOR);
      expect(resolveEditorScreen(EDITOR_MODES.ANNOTATE, true)).toBe(APP_SCREENS.EDITOR);
    });

    it('routes any unhandled mode home and logs an error', () => {
      expect(resolveEditorScreen('totally-unknown-mode', true)).toBe(APP_SCREENS.HOME);
      expect(error).toHaveBeenCalled();
    });
  });

  describe('goToProjectManager', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('clears the selection and switches to project-manager mode atomically', () => {
      useProjectsStore.setState({ selectedProjectId: 45, selectedProject: { id: 45 } });
      useEditorStore.setState({ editorMode: 'overlay' });

      useEditorStore.getState().goToProjectManager();

      expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
      expect(useProjectsStore.getState().selectedProjectId).toBe(null);
      expect(useProjectsStore.getState().selectedProject).toBe(null);
    });
  });

  describe('mode helpers', () => {
    it('isFramingMode returns true in framing mode', () => {
      expect(useEditorStore.getState().isFramingMode()).toBe(true);
      expect(useEditorStore.getState().isOverlayMode()).toBe(false);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(false);
    });

    it('isOverlayMode returns true in overlay mode', () => {
      useEditorStore.getState().setEditorMode('overlay');
      expect(useEditorStore.getState().isFramingMode()).toBe(false);
      expect(useEditorStore.getState().isOverlayMode()).toBe(true);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(false);
    });

    it('isAnnotateMode returns true in annotate mode', () => {
      useEditorStore.getState().setEditorMode('annotate');
      expect(useEditorStore.getState().isFramingMode()).toBe(false);
      expect(useEditorStore.getState().isOverlayMode()).toBe(false);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(true);
    });
  });
});
