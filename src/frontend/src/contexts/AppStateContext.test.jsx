import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { AppStateProvider, useAppState } from './AppStateContext';

describe('AppStateContext', () => {
  describe('useAppState', () => {
    it('throws error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAppState());
      }).toThrow('useAppState must be used within AppStateProvider');

      consoleSpy.mockRestore();
    });

    it('provides value when used within provider', () => {
      const mockValue = {
        editorMode: 'framing',
        setEditorMode: vi.fn(),
        selectedProjectId: 123,
        selectedProject: { id: 123, name: 'Test Project' },
        exportingProject: null,
        setExportingProject: vi.fn(),
        globalExportProgress: null,
        setGlobalExportProgress: vi.fn(),
      };

      const wrapper = ({ children }) => (
        <AppStateProvider value={mockValue}>
          {children}
        </AppStateProvider>
      );

      const { result } = renderHook(() => useAppState(), { wrapper });

      expect(result.current.editorMode).toBe('framing');
      expect(result.current.selectedProjectId).toBe(123);
      expect(result.current.selectedProject.name).toBe('Test Project');
      expect(result.current.exportingProject).toBeNull();
    });

    it('returns setters from context value', () => {
      const setEditorMode = vi.fn();
      const setExportingProject = vi.fn();

      const mockValue = {
        editorMode: 'overlay',
        setEditorMode,
        selectedProjectId: null,
        selectedProject: null,
        exportingProject: null,
        setExportingProject,
        globalExportProgress: null,
        setGlobalExportProgress: vi.fn(),
      };

      const wrapper = ({ children }) => (
        <AppStateProvider value={mockValue}>
          {children}
        </AppStateProvider>
      );

      const { result } = renderHook(() => useAppState(), { wrapper });

      expect(result.current.setEditorMode).toBe(setEditorMode);
      expect(result.current.setExportingProject).toBe(setExportingProject);
    });

    it('provides export progress state', () => {
      const mockValue = {
        editorMode: 'framing',
        setEditorMode: vi.fn(),
        selectedProjectId: 1,
        selectedProject: { id: 1, name: 'Exporting Project' },
        exportingProject: { projectId: 1, stage: 'framing', exportId: 'export_123' },
        setExportingProject: vi.fn(),
        globalExportProgress: { progress: 50, message: 'Processing...' },
        setGlobalExportProgress: vi.fn(),
      };

      const wrapper = ({ children }) => (
        <AppStateProvider value={mockValue}>
          {children}
        </AppStateProvider>
      );

      const { result } = renderHook(() => useAppState(), { wrapper });

      expect(result.current.exportingProject).toEqual({
        projectId: 1,
        stage: 'framing',
        exportId: 'export_123'
      });
      expect(result.current.globalExportProgress).toEqual({
        progress: 50,
        message: 'Processing...'
      });
    });
  });
});
