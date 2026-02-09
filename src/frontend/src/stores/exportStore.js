import { create } from 'zustand';
import { useToastStore } from '../components/shared/Toast';

/**
 * Export Store - Manages export progress and status tracking
 *
 * TRUE MVC ARCHITECTURE:
 * - Backend is the SINGLE SOURCE OF TRUTH for export state
 * - WebSocket pushes real-time updates to this store
 * - UI components react to store changes
 * - NO localStorage - prevents stale data and sync issues
 *
 * Data flow:
 * 1. Backend creates export_jobs record
 * 2. WebSocket sends progress updates → store.updateExportProgress()
 * 3. Store updates → React components re-render
 * 4. On app load: fetch /api/exports/active → store.setExportsFromServer()
 *
 * @see PARALLEL_EXPORT_PLAN.md for architecture details
 */
export const useExportStore = create((set, get) => ({
  // ===========================================
  // ACTIVE EXPORTS - Tracks all exports by ID
  // ===========================================
  // Object<exportId, ExportState> where ExportState is:
  // {
  //   exportId: string,
  //   projectId: number,
  //   projectName: string | null,
  //   type: 'framing' | 'overlay' | 'annotate',
  //   status: 'pending' | 'processing' | 'complete' | 'error',
  //   progress: { current: number, total: number, percent: number, message: string },
  //   startedAt: string (ISO),
  //   completedAt: string (ISO) | null,
  //   error: string | null,
  //   outputVideoId: number | null,
  //   outputFilename: string | null
  // }
  activeExports: {},

  // ===========================================
  // LEGACY STATE (for backward compatibility)
  // ===========================================
  exportProgress: null,
  exportingProject: null,
  globalExportProgress: null,
  exportCompleteToastId: null,

  // ===========================================
  // MVC ACTIONS - Backend is source of truth
  // ===========================================

  /**
   * Replace all exports with server data - called on app load
   * This is the PRIMARY way to populate the store.
   *
   * @param {Array} serverExports - Array of export objects from /api/exports/active
   */
  setExportsFromServer: (serverExports) => {
    console.log(`[ExportStore] setExportsFromServer called with ${serverExports.length} exports`);
    const exports = {};
    for (const exp of serverExports) {
      // T12: For annotate exports, use gameId/gameName instead of projectId/projectName
      const isAnnotate = exp.type === 'annotate';
      exports[exp.job_id] = {
        exportId: exp.job_id,
        projectId: exp.project_id,
        projectName: exp.project_name || null,
        type: exp.type,
        status: exp.status,
        progress: {
          current: exp.progress || 0,
          total: 100,
          percent: exp.progress || 0,
          message: exp.status === 'processing' ? 'Processing...' : ''
        },
        startedAt: exp.started_at || exp.created_at || new Date().toISOString(),
        completedAt: exp.completed_at || null,
        error: exp.error || null,
        outputVideoId: exp.output_video_id || null,
        outputFilename: exp.output_filename || null,
        // T12: Annotate export fields
        gameId: isAnnotate ? exp.game_id : null,
        gameName: isAnnotate ? exp.game_name : null,
      };
    }
    set({ activeExports: exports });
    console.log(`[ExportStore] Loaded ${serverExports.length} exports from server (total IDs: ${Object.keys(exports).join(', ') || 'none'})`);
  },

  /**
   * Start tracking a new export (optimistic update while backend creates record)
   * WebSocket updates will override this with real progress.
   *
   * T12: For annotate exports, pass { gameId, gameName } as second arg instead of projectId.
   * @param {string} exportId - Unique export identifier
   * @param {number|object} projectIdOrOptions - Project ID, or { gameId, gameName } for annotate
   * @param {string} type - Export type ('framing', 'overlay', 'annotate')
   */
  startExport: (exportId, projectIdOrOptions, type) => {
    set((state) => {
      // Guard against duplicate adds (e.g., React StrictMode double-render)
      if (state.activeExports[exportId]) {
        console.log(`[ExportStore] Export ${exportId} already exists, skipping add`);
        return state;
      }

      // T12: Support annotate exports with gameId instead of projectId
      const isAnnotate = type === 'annotate';
      let projectId, gameId, gameName;

      if (isAnnotate && typeof projectIdOrOptions === 'object') {
        projectId = 0;
        gameId = projectIdOrOptions.gameId;
        gameName = projectIdOrOptions.gameName;
        console.log(`[ExportStore] Adding new annotate export: ${exportId} for game ${gameId} (${gameName})`);
      } else {
        projectId = projectIdOrOptions;
        gameId = null;
        gameName = null;
        console.log(`[ExportStore] Adding new export: ${exportId} for project ${projectId}`);
      }

      return {
        activeExports: {
          ...state.activeExports,
          [exportId]: {
            exportId,
            projectId,
            type,
            status: 'pending',
            progress: { current: 0, total: 100, percent: 0, message: 'Starting export...' },
            startedAt: new Date().toISOString(),
            completedAt: null,
            error: null,
            outputVideoId: null,
            outputFilename: null,
            // T12: Annotate export fields
            gameId,
            gameName,
          },
        },
        // Legacy state for backward compatibility
        exportingProject: { projectId, stage: type, exportId },
      };
    });
  },

  /**
   * Update export progress - called by WebSocket handler
   *
   * MVC: The store should only reflect backend state. WebSocket messages
   * from the backend include projectId and type, which we use to create entries.
   *
   * T12: Annotate exports use gameId instead of projectId. We allow exports
   * with either projectId OR gameId (for annotate type).
   */
  updateExportProgress: (exportId, progress) => {
    set((state) => {
      const existing = state.activeExports[exportId];

      if (!existing) {
        // Export not in store yet - create from WebSocket data
        // T12: Allow annotate exports with gameId instead of projectId
        const isAnnotate = progress.type === 'annotate';
        const hasIdentifier = progress.projectId || (isAnnotate && progress.gameId);

        if (!hasIdentifier) {
          console.warn(`[ExportStore] Received progress for unknown export ${exportId} without projectId or gameId - ignoring`);
          return state; // Don't create entries without identifier
        }

        const displayName = isAnnotate
          ? progress.gameName || `Game ${progress.gameId}`
          : progress.projectName;

        console.log(`[ExportStore] Creating export ${exportId} from WebSocket (${isAnnotate ? 'game' : 'project'}: ${isAnnotate ? progress.gameId : progress.projectId}, name: ${displayName}, type: ${progress.type})`);

        return {
          activeExports: {
            ...state.activeExports,
            [exportId]: {
              exportId,
              projectId: progress.projectId || 0,
              projectName: progress.projectName || null,
              type: progress.type || 'unknown',
              status: 'processing',
              progress: {
                current: progress.current || 0,
                total: progress.total || 100,
                percent: progress.percent || Math.round((progress.current / progress.total) * 100) || 0,
                message: progress.message || '',
              },
              startedAt: new Date().toISOString(),
              completedAt: null,
              error: null,
              outputVideoId: null,
              outputFilename: null,
              // T12: Annotate export fields
              gameId: isAnnotate ? progress.gameId : null,
              gameName: isAnnotate ? progress.gameName : null,
            },
          },
          exportProgress: progress,
          globalExportProgress: { progress: progress.percent, message: progress.message },
        };
      }

      const percent = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : progress.percent || 0;

      // Update existing entry - also update projectId/type/projectName if they were missing
      return {
        activeExports: {
          ...state.activeExports,
          [exportId]: {
            ...existing,
            projectId: existing.projectId || progress.projectId, // Fill in if missing
            projectName: existing.projectName || progress.projectName || null, // Fill in if missing
            type: existing.type === 'unknown' ? (progress.type || existing.type) : existing.type,
            status: 'processing',
            progress: { ...progress, percent },
            // T12: Update gameId/gameName if missing
            gameId: existing.gameId || progress.gameId || null,
            gameName: existing.gameName || progress.gameName || null,
          },
        },
        exportProgress: progress,
        globalExportProgress: { progress: percent, message: progress.message },
      };
    });
  },

  /**
   * Mark export as complete - called by WebSocket handler
   */
  completeExport: (exportId, outputVideoId = null, outputFilename = null) => {
    set((state) => {
      const existing = state.activeExports[exportId];
      if (!existing) return state;

      return {
        activeExports: {
          ...state.activeExports,
          [exportId]: {
            ...existing,
            status: 'complete',
            progress: { current: 100, total: 100, percent: 100, message: 'Export complete!' },
            completedAt: new Date().toISOString(),
            outputVideoId,
            outputFilename,
          },
        },
        exportingProject: state.exportingProject?.exportId === exportId
          ? null
          : state.exportingProject,
        exportProgress: state.exportingProject?.exportId === exportId
          ? null
          : state.exportProgress,
      };
    });
  },

  /**
   * Mark export as failed - called by WebSocket handler
   */
  failExport: (exportId, error) => {
    set((state) => {
      const existing = state.activeExports[exportId];
      if (!existing) return state;

      return {
        activeExports: {
          ...state.activeExports,
          [exportId]: {
            ...existing,
            status: 'error',
            error: typeof error === 'string' ? error : error?.message || 'Export failed',
            completedAt: new Date().toISOString(),
          },
        },
        exportingProject: state.exportingProject?.exportId === exportId
          ? null
          : state.exportingProject,
        exportProgress: state.exportingProject?.exportId === exportId
          ? null
          : state.exportProgress,
      };
    });
  },

  /**
   * Remove an export from tracking (user dismissed it)
   */
  removeExport: (exportId) => {
    set((state) => {
      const { [exportId]: removed, ...remaining } = state.activeExports;
      return { activeExports: remaining };
    });
  },

  /**
   * Clear completed/failed exports older than specified hours
   */
  cleanupOldExports: (maxAgeHours = 24) => {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    set((state) => {
      const filtered = {};
      for (const [id, exp] of Object.entries(state.activeExports)) {
        const completedTime = exp.completedAt ? new Date(exp.completedAt).getTime() : null;
        // Keep if not completed, or completed within cutoff
        if (!completedTime || completedTime > cutoff) {
          filtered[id] = exp;
        }
      }
      return { activeExports: filtered };
    });
  },

  // ===========================================
  // SELECTORS
  // ===========================================

  getExport: (exportId) => get().activeExports[exportId],

  getExportsByProject: (projectId) => {
    return Object.values(get().activeExports)
      .filter((exp) => exp.projectId === projectId);
  },

  getProcessingExports: () => {
    return Object.values(get().activeExports)
      .filter((exp) => exp.status === 'pending' || exp.status === 'processing');
  },

  isProjectExporting: (projectId) => {
    return Object.values(get().activeExports)
      .some((exp) =>
        exp.projectId === projectId &&
        (exp.status === 'pending' || exp.status === 'processing')
      );
  },

  getActiveExportCount: () => {
    return Object.values(get().activeExports)
      .filter((exp) => exp.status === 'pending' || exp.status === 'processing')
      .length;
  },

  // ===========================================
  // LEGACY ACTIONS (for backward compatibility)
  // ===========================================

  setExportProgress: (progress) => set({ exportProgress: progress }),

  clearExport: () => set({
    exportingProject: null,
    exportProgress: null,
  }),

  setGlobalExportProgress: (progress) => set({ globalExportProgress: progress }),

  clearGlobalExportProgress: () => set({ globalExportProgress: null }),

  setExportCompleteToastId: (toastId) => set({ exportCompleteToastId: toastId }),

  dismissExportCompleteToast: () => {
    const { exportCompleteToastId } = get();
    if (exportCompleteToastId) {
      useToastStore.getState().removeToast(exportCompleteToastId);
      set({ exportCompleteToastId: null });
    }
  },

  isExporting: () => get().exportingProject !== null,

  getProgressPercent: () => {
    const { exportProgress } = get();
    if (!exportProgress || exportProgress.total === 0) return 0;
    return Math.round((exportProgress.current / exportProgress.total) * 100);
  },
}));

export default useExportStore;
