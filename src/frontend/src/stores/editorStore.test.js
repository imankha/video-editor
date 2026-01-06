import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

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
