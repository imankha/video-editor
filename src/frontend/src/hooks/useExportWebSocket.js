import { useEffect, useRef, useCallback } from 'react';
import { useExportStore } from '../stores';

/**
 * useExportWebSocket - Manages WebSocket connection for export progress
 *
 * Connects to the export WebSocket when an export is in progress,
 * updates the global export progress in the exportStore, and
 * handles completion/error states.
 *
 * Features:
 * - Auto-connects when export starts (exportingProject.exportId set)
 * - Keepalive pings every 15s to prevent proxy/browser timeouts
 * - Auto-reconnects on transient failures with exponential backoff
 * - Cleans up on export completion or cancellation
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
  const keepaliveIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const isCleaningUpRef = useRef(false);

  // Max reconnection attempts before giving up
  const MAX_RECONNECT_ATTEMPTS = 10;
  // Base delay for exponential backoff (ms)
  const BASE_RECONNECT_DELAY = 1000;
  // Keepalive ping interval (ms) - more frequent to prevent proxy timeouts
  const KEEPALIVE_INTERVAL = 15000;

  // Get export state from store
  const {
    exportingProject,
    setGlobalExportProgress,
    clearExport,
    clearGlobalExportProgress,
  } = useExportStore();

  // Create WebSocket connection
  const connect = useCallback((exportId) => {
    if (isCleaningUpRef.current) {
      console.log('[useExportWebSocket] Skipping connect - cleanup in progress');
      return;
    }

    console.log(`[useExportWebSocket] Connecting for export: ${exportId} (attempt ${reconnectAttemptRef.current + 1})`);

    // Use same host as the page to go through Vite proxy
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/export/${exportId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[useExportWebSocket] WebSocket connected');
      reconnectAttemptRef.current = 0; // Reset reconnect counter on successful connection

      // Start keepalive pings to prevent proxy/browser timeouts
      // Using 15s interval (more frequent than 30s) for better reliability
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current);
      }
      keepaliveIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send('ping');
            console.log('[useExportWebSocket] Sent keepalive ping');
          } catch (e) {
            console.warn('[useExportWebSocket] Failed to send keepalive:', e);
          }
        }
      }, KEEPALIVE_INTERVAL);
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
        isCleaningUpRef.current = true;
        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
          keepaliveIntervalRef.current = null;
        }
        clearExport();
        clearGlobalExportProgress();
        onExportComplete?.();
        isCleaningUpRef.current = false;
      } else if (data.status === 'error') {
        console.error('[useExportWebSocket] Export error:', data.message);
        isCleaningUpRef.current = true;
        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
          keepaliveIntervalRef.current = null;
        }
        clearExport();
        clearGlobalExportProgress();
        onExportError?.(data.message);
        isCleaningUpRef.current = false;
      }
    };

    ws.onerror = (error) => {
      console.error('[useExportWebSocket] WebSocket error:', error);
    };

    ws.onclose = (event) => {
      console.log(`[useExportWebSocket] WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);

      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current);
        keepaliveIntervalRef.current = null;
      }
      wsRef.current = null;

      // Auto-reconnect if export is still in progress and we haven't exceeded max attempts
      // Don't reconnect if we're cleaning up (export completed/errored)
      if (!isCleaningUpRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptRef.current++;
        const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current - 1), 30000);
        console.log(`[useExportWebSocket] Will attempt reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          // Re-check if export is still in progress before reconnecting
          // We need to get the current exportId from the closure
          connect(exportId);
        }, delay);
      } else if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[useExportWebSocket] Max reconnection attempts reached, giving up');
        // Don't clear export state - the export may still be running on the server
        // Just let the UI continue without live updates
      }
    };

    return ws;
  }, [setGlobalExportProgress, clearExport, clearGlobalExportProgress, onExportComplete, onExportError]);

  useEffect(() => {
    // Only connect if we have an active export with an exportId
    if (!exportingProject?.exportId) {
      // Clean up any existing connection
      isCleaningUpRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current);
        keepaliveIntervalRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      setGlobalExportProgress(null);
      isCleaningUpRef.current = false;
      return;
    }

    const exportId = exportingProject.exportId;
    isCleaningUpRef.current = false;
    reconnectAttemptRef.current = 0;
    connect(exportId);

    // Cleanup on unmount or when exportingProject changes
    return () => {
      isCleaningUpRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (keepaliveIntervalRef.current) {
        clearInterval(keepaliveIntervalRef.current);
        keepaliveIntervalRef.current = null;
      }
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
      }
    };
  }, [
    exportingProject?.exportId,
    setGlobalExportProgress,
    connect,
  ]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    reconnectAttempts: reconnectAttemptRef.current,
  };
}

export default useExportWebSocket;
