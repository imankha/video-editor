import { useCallback, useEffect, useRef } from 'react';
import { useExportStore } from '../stores';
import exportWebSocketManager from '../services/ExportWebSocketManager';

/**
 * Generate a unique ID for tracking export progress
 */
function generateExportId() {
  return 'export_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * useExportManager - React hook for managing video exports
 *
 * This hook provides a clean interface for components to:
 * - Start and track exports
 * - Get real-time progress updates
 * - Handle export completion/errors
 *
 * The underlying WebSocket connections are managed globally by ExportWebSocketManager,
 * so exports continue even when the component unmounts.
 *
 * @param {object} options
 * @param {number} options.projectId - Project ID to filter exports (optional)
 * @param {function} options.onComplete - Callback when any export completes
 * @param {function} options.onError - Callback when any export fails
 * @param {function} options.onProgress - Callback for progress updates
 *
 * @example
 * const { startExport, getExport, isProjectExporting } = useExportManager({
 *   projectId: 123,
 *   onComplete: (data, exportId) => console.log('Done!', exportId),
 * });
 *
 * const exportId = await startExport('overlay');
 */
export function useExportManager(options = {}) {
  const { projectId, onComplete, onError, onProgress } = options;

  // Store subscriptions for cleanup
  const unsubscribeRefs = useRef([]);

  // Get store state and actions
  const activeExports = useExportStore((state) => state.activeExports);
  const startExportInStore = useExportStore((state) => state.startExport);
  const getExport = useExportStore((state) => state.getExport);
  const getExportsByProject = useExportStore((state) => state.getExportsByProject);
  const getProcessingExports = useExportStore((state) => state.getProcessingExports);
  const isProjectExporting = useExportStore((state) => state.isProjectExporting);
  const getActiveExportCount = useExportStore((state) => state.getActiveExportCount);
  const removeExport = useExportStore((state) => state.removeExport);

  /**
   * Start a new export
   *
   * @param {string} type - Export type: 'framing' | 'overlay' | 'annotate'
   * @param {number} forProjectId - Project ID (uses options.projectId if not provided)
   * @returns {Promise<string>} - Export ID for tracking
   */
  const startExport = useCallback(async (type, forProjectId = projectId) => {
    if (!forProjectId) {
      throw new Error('Project ID is required to start export');
    }

    // Generate unique export ID
    const exportId = generateExportId();

    // Register in store
    startExportInStore(exportId, forProjectId, type);

    // Connect WebSocket for progress updates
    const callbacks = {
      onProgress: (progress, message) => {
        if (onProgress) onProgress(progress, message, exportId);
      },
      onComplete: (data) => {
        if (onComplete) onComplete(data, exportId);
      },
      onError: (error) => {
        if (onError) onError(error, exportId);
      },
    };

    await exportWebSocketManager.connect(exportId, callbacks);

    return exportId;
  }, [projectId, startExportInStore, onProgress, onComplete, onError]);

  /**
   * Connect to an existing export's WebSocket
   * Useful for reconnecting to an export started elsewhere
   *
   * @param {string} exportId - Existing export ID
   */
  const reconnectExport = useCallback(async (exportId) => {
    const callbacks = {
      onProgress: (progress, message) => {
        if (onProgress) onProgress(progress, message, exportId);
      },
      onComplete: (data) => {
        if (onComplete) onComplete(data, exportId);
      },
      onError: (error) => {
        if (onError) onError(error, exportId);
      },
    };

    await exportWebSocketManager.connect(exportId, callbacks);
  }, [onProgress, onComplete, onError]);

  /**
   * Get exports for the current project
   */
  const getProjectExports = useCallback(() => {
    if (!projectId) return [];
    return getExportsByProject(projectId);
  }, [projectId, getExportsByProject]);

  /**
   * Check if the current project has any active exports
   */
  const isCurrentProjectExporting = useCallback(() => {
    if (!projectId) return false;
    return isProjectExporting(projectId);
  }, [projectId, isProjectExporting]);

  /**
   * Get the most recent active export for the current project
   */
  const getCurrentExport = useCallback(() => {
    if (!projectId) return null;
    const exports = getExportsByProject(projectId);
    // Find most recent pending/processing export
    const active = exports.filter(e => e.status === 'pending' || e.status === 'processing');
    if (active.length === 0) return null;
    // Sort by startedAt descending and return first
    return active.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  }, [projectId, getExportsByProject]);

  /**
   * Clean up a completed/failed export from the store
   */
  const cleanupExport = useCallback((exportId) => {
    exportWebSocketManager.disconnect(exportId);
    removeExport(exportId);
  }, [removeExport]);

  // Set up global event listeners for the callbacks
  useEffect(() => {
    // Clean up previous subscriptions
    unsubscribeRefs.current.forEach(unsub => unsub());
    unsubscribeRefs.current = [];

    // Subscribe to events if callbacks provided
    if (onComplete) {
      const unsub = exportWebSocketManager.addEventListener('*', 'complete', onComplete);
      unsubscribeRefs.current.push(unsub);
    }

    if (onError) {
      const unsub = exportWebSocketManager.addEventListener('*', 'error', onError);
      unsubscribeRefs.current.push(unsub);
    }

    if (onProgress) {
      const unsub = exportWebSocketManager.addEventListener('*', 'progress', (data, exportId) => {
        onProgress(data.progress, data.message, exportId);
      });
      unsubscribeRefs.current.push(unsub);
    }

    // Cleanup on unmount
    return () => {
      unsubscribeRefs.current.forEach(unsub => unsub());
      unsubscribeRefs.current = [];
    };
  }, [onComplete, onError, onProgress]);

  // Recover connections on mount (in case of page refresh)
  useEffect(() => {
    exportWebSocketManager.recoverConnections();
  }, []);

  return {
    // State
    activeExports,

    // Actions
    startExport,
    reconnectExport,
    cleanupExport,

    // Selectors
    getExport,
    getExportsByProject,
    getProjectExports,
    getProcessingExports,
    isProjectExporting,
    isCurrentProjectExporting,
    getCurrentExport,
    getActiveExportCount,

    // WebSocket manager (for advanced use)
    wsManager: exportWebSocketManager,
  };
}

export default useExportManager;
