import { create } from 'zustand';

/**
 * Export Store - Manages export progress and status tracking
 *
 * This store consolidates export-related state that was previously
 * managed via useState in App.jsx and passed down through props.
 *
 * State:
 * - exportProgress: Current export progress (SSE updates)
 * - exportingProject: Which project is currently exporting
 * - globalExportProgress: WebSocket-based progress (persists across navigation)
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 */
export const useExportStore = create((set, get) => ({
  // Export progress from SSE updates
  // { current: number, total: number, phase: string, message: string } | null
  exportProgress: null,

  // Which project is currently exporting
  // { projectId: number, stage: 'framing' | 'overlay', exportId: string } | null
  exportingProject: null,

  // Global export progress from WebSocket (persists across navigation)
  // { progress: number, message: string } | null
  globalExportProgress: null,

  // Actions

  /**
   * Update export progress from SSE
   * @param {{ current: number, total: number, phase: string, message: string } | null} progress
   */
  setExportProgress: (progress) => set({ exportProgress: progress }),

  /**
   * Start tracking an export for a project
   * @param {number} projectId
   * @param {'framing' | 'overlay'} stage
   * @param {string} exportId
   */
  startExport: (projectId, stage, exportId) => set({
    exportingProject: { projectId, stage, exportId }
  }),

  /**
   * Clear export tracking (export finished or cancelled)
   */
  clearExport: () => set({
    exportingProject: null,
    exportProgress: null
  }),

  /**
   * Update global export progress (from WebSocket)
   * @param {{ progress: number, message: string } | null} progress
   */
  setGlobalExportProgress: (progress) => set({ globalExportProgress: progress }),

  /**
   * Clear global export progress
   */
  clearGlobalExportProgress: () => set({ globalExportProgress: null }),

  // Computed values

  /**
   * Check if any export is in progress
   */
  isExporting: () => get().exportingProject !== null,

  /**
   * Check if a specific project is exporting
   * @param {number} projectId
   */
  isProjectExporting: (projectId) => {
    const { exportingProject } = get();
    return exportingProject?.projectId === projectId;
  },

  /**
   * Get export progress as percentage (0-100)
   */
  getProgressPercent: () => {
    const { exportProgress } = get();
    if (!exportProgress || exportProgress.total === 0) return 0;
    return Math.round((exportProgress.current / exportProgress.total) * 100);
  },
}));

export default useExportStore;
