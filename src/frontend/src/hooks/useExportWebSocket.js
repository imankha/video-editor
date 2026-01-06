import { useEffect, useRef } from 'react';
import { useExportStore } from '../stores';

/**
 * useExportWebSocket - Manages WebSocket connection for export progress
 *
 * Connects to the export WebSocket when an export is in progress,
 * updates the global export progress in the exportStore, and
 * handles completion/error states.
 *
 * @param {Object} params
 * @param {Function} params.onExportComplete - Callback when export completes successfully
 * @param {Function} params.onExportError - Callback when export fails (optional)
 *
 * @see APP_REFACTOR_PLAN.md Task 2.2 for refactoring context
 */
export function useExportWebSocket({
  onExportComplete,
  onExportError,
}) {
  const wsRef = useRef(null);

  // Get export state from store
  const {
    exportingProject,
    setGlobalExportProgress,
    clearExport,
    clearGlobalExportProgress,
  } = useExportStore();

  useEffect(() => {
    // Only connect if we have an active export with an exportId
    if (!exportingProject?.exportId) {
      // Clean up any existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setGlobalExportProgress(null);
      return;
    }

    const exportId = exportingProject.exportId;
    console.log('[useExportWebSocket] Connecting for export:', exportId);

    // Use same host as the page to go through Vite proxy
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/export/${exportId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useExportWebSocket] WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[useExportWebSocket] Progress:', data);

      setGlobalExportProgress({
        progress: Math.round(data.progress),
        message: data.message || '',
      });

      // Handle completion
      if (data.status === 'complete') {
        console.log('[useExportWebSocket] Export complete');
        clearExport();
        clearGlobalExportProgress();
        onExportComplete?.();
      } else if (data.status === 'error') {
        console.error('[useExportWebSocket] Export error:', data.message);
        clearExport();
        clearGlobalExportProgress();
        onExportError?.(data.message);
      }
    };

    ws.onerror = (error) => {
      console.error('[useExportWebSocket] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[useExportWebSocket] WebSocket disconnected');
      wsRef.current = null;
    };

    // Cleanup on unmount or when exportingProject changes
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [
    exportingProject?.exportId,
    setGlobalExportProgress,
    clearExport,
    clearGlobalExportProgress,
    onExportComplete,
    onExportError,
  ]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}

export default useExportWebSocket;
