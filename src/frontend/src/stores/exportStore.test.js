import { describe, it, expect, beforeEach } from 'vitest';
import { useExportStore } from './exportStore';

describe('exportStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useExportStore.setState({
      exportProgress: null,
      exportingProject: null,
      globalExportProgress: null,
      activeExports: {},
    });
  });

  describe('initial state', () => {
    it('starts with null export progress', () => {
      expect(useExportStore.getState().exportProgress).toBe(null);
    });

    it('starts with no exporting project', () => {
      expect(useExportStore.getState().exportingProject).toBe(null);
    });

    it('starts with null global progress', () => {
      expect(useExportStore.getState().globalExportProgress).toBe(null);
    });
  });

  describe('exportProgress', () => {
    it('setExportProgress updates progress', () => {
      const progress = { current: 5, total: 10, phase: 'processing', message: 'Working...' };
      useExportStore.getState().setExportProgress(progress);
      expect(useExportStore.getState().exportProgress).toEqual(progress);
    });

    it('setExportProgress can clear progress with null', () => {
      useExportStore.getState().setExportProgress({ current: 1, total: 2 });
      useExportStore.getState().setExportProgress(null);
      expect(useExportStore.getState().exportProgress).toBe(null);
    });
  });

  describe('exportingProject', () => {
    // Note: startExport signature is (exportId, projectId, type)
    it('startExport sets exporting project', () => {
      useExportStore.getState().startExport('export-abc', 123, 'framing');
      expect(useExportStore.getState().exportingProject).toEqual({
        projectId: 123,
        stage: 'framing',
        exportId: 'export-abc'
      });
    });

    it('clearExport clears project and progress', () => {
      useExportStore.getState().startExport('export-xyz', 123, 'overlay');
      useExportStore.getState().setExportProgress({ current: 5, total: 10 });
      useExportStore.getState().clearExport();

      expect(useExportStore.getState().exportingProject).toBe(null);
      expect(useExportStore.getState().exportProgress).toBe(null);
    });
  });

  describe('globalExportProgress', () => {
    it('setGlobalExportProgress updates global progress', () => {
      const progress = { progress: 75, message: 'Almost done' };
      useExportStore.getState().setGlobalExportProgress(progress);
      expect(useExportStore.getState().globalExportProgress).toEqual(progress);
    });

    it('clearGlobalExportProgress clears global progress', () => {
      useExportStore.getState().setGlobalExportProgress({ progress: 50, message: 'test' });
      useExportStore.getState().clearGlobalExportProgress();
      expect(useExportStore.getState().globalExportProgress).toBe(null);
    });
  });

  describe('computed values', () => {
    it('isExporting returns false when no export', () => {
      expect(useExportStore.getState().isExporting()).toBe(false);
    });

    it('isExporting returns true during export', () => {
      useExportStore.getState().startExport('id', 1, 'framing');
      expect(useExportStore.getState().isExporting()).toBe(true);
    });

    it('isProjectExporting checks specific project', () => {
      useExportStore.getState().startExport('id', 42, 'overlay');
      expect(useExportStore.getState().isProjectExporting(42)).toBe(true);
      expect(useExportStore.getState().isProjectExporting(99)).toBe(false);
    });

    it('getProgressPercent returns 0 when no progress', () => {
      expect(useExportStore.getState().getProgressPercent()).toBe(0);
    });

    it('getProgressPercent calculates percentage', () => {
      useExportStore.getState().setExportProgress({ current: 3, total: 4 });
      expect(useExportStore.getState().getProgressPercent()).toBe(75);
    });

    it('getProgressPercent handles edge case of total 0', () => {
      useExportStore.getState().setExportProgress({ current: 0, total: 0 });
      expect(useExportStore.getState().getProgressPercent()).toBe(0);
    });
  });
});
