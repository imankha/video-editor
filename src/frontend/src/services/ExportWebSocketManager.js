/**
 * ExportWebSocketManager - Global WebSocket manager for export progress tracking
 *
 * This service manages WebSocket connections for all active exports, independent
 * of React component lifecycle. This ensures progress tracking continues even
 * when navigating between screens.
 *
 * Features:
 * - Singleton instance for global access
 * - Automatic reconnection with exponential backoff
 * - Integration with exportStore for state updates
 * - Connection recovery for active exports after page refresh
 *
 * @see PARALLEL_EXPORT_PLAN.md for architecture details
 */

import { useExportStore } from '../stores';
import { ExportStatus } from '../constants/exportStatus';

// Reconnection configuration
const RECONNECT_CONFIG = {
  initialDelay: 1000,    // 1 second initial delay
  maxDelay: 30000,       // 30 seconds max delay
  backoffMultiplier: 2,  // Double delay each attempt
  maxAttempts: 10,       // Give up after 10 attempts
};

// Keepalive configuration
const KEEPALIVE_INTERVAL = 30000; // 30 seconds

class ExportWebSocketManager {
  constructor() {
    // Map of exportId -> WebSocket connection info
    // { ws: WebSocket, keepaliveInterval: number, reconnectAttempt: number, reconnectTimeout: number }
    this.connections = new Map();

    // Callbacks for external listeners (e.g., components that want to know about events)
    this.eventListeners = new Map();
  }

  /**
   * Build WebSocket URL for an export
   */
  _buildWsUrl(exportId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/ws/export/${exportId}`;
  }

  /**
   * Connect to WebSocket for a specific export
   *
   * @param {string} exportId - Unique export identifier
   * @param {object} callbacks - Optional callbacks for events
   * @param {function} callbacks.onProgress - Called on progress update
   * @param {function} callbacks.onComplete - Called when export completes
   * @param {function} callbacks.onError - Called on error
   * @returns {Promise<boolean>} - Resolves true if connected successfully
   */
  connect(exportId, callbacks = {}) {
    return new Promise((resolve) => {
      // Close existing connection if any
      if (this.connections.has(exportId)) {
        this._closeConnection(exportId, false);
      }

      const wsUrl = this._buildWsUrl(exportId);
      console.log(`[ExportWSManager] Connecting to ${wsUrl}`);

      const ws = new WebSocket(wsUrl);

      // Store connection info
      const connectionInfo = {
        ws,
        keepaliveInterval: null,
        reconnectAttempt: 0,
        reconnectTimeout: null,
        callbacks,
      };
      this.connections.set(exportId, connectionInfo);

      // Connection timeout
      const timeout = setTimeout(() => {
        console.warn(`[ExportWSManager] Connection timeout for ${exportId}`);
        resolve(false);
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        console.log(`[ExportWSManager] Connected to ${exportId}`);

        // Reset reconnect attempts on successful connection
        connectionInfo.reconnectAttempt = 0;

        // Start keepalive pings
        connectionInfo.keepaliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send('ping');
              console.debug(`[ExportWSManager] Sent keepalive ping for ${exportId}`);
            } catch (e) {
              console.warn(`[ExportWSManager] Failed to send keepalive for ${exportId}:`, e);
            }
          }
        }, KEEPALIVE_INTERVAL);

        resolve(true);
      };

      ws.onmessage = (event) => {
        this._handleMessage(exportId, event.data, callbacks);
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        console.warn(`[ExportWSManager] WebSocket error for ${exportId}:`, error);
        // Don't resolve false here - let onclose handle reconnection
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        console.log(`[ExportWSManager] WebSocket closed for ${exportId}, code: ${event.code}`);

        // Clear keepalive
        if (connectionInfo.keepaliveInterval) {
          clearInterval(connectionInfo.keepaliveInterval);
          connectionInfo.keepaliveInterval = null;
        }

        // Check if export is still active and we should reconnect
        const exportState = useExportStore.getState().activeExports[exportId];
        if (exportState && (exportState.status === 'pending' || exportState.status === 'processing')) {
          // Export still active, attempt reconnection
          this._scheduleReconnect(exportId, callbacks);
        } else {
          // Export completed or we intentionally closed
          this.connections.delete(exportId);
        }

        resolve(false);
      };
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  _handleMessage(exportId, data, callbacks) {
    // Skip ping/pong heartbeat messages (they're not JSON)
    // Handle various formats: exact match, trimmed, or with quotes
    const trimmedData = typeof data === 'string' ? data.trim() : String(data);
    if (trimmedData === 'pong' || trimmedData === 'ping' ||
        trimmedData === '"pong"' || trimmedData === '"ping"' ||
        trimmedData.toLowerCase() === 'pong' || trimmedData.toLowerCase() === 'ping') {
      return;
    }

    // Skip empty messages
    if (!trimmedData || trimmedData === '""' || trimmedData === "''") {
      return;
    }

    try {
      const message = JSON.parse(trimmedData);
      console.debug(`[ExportWSManager] Message for ${exportId}:`, message);

      // Extract all fields from the message - backend sends projectId, type, and projectName
      const { progress, message: progressMessage, status, projectId, type, projectName } = message;

      // Update export store
      const store = useExportStore.getState();

      if (status === ExportStatus.COMPLETE) {
        store.completeExport(
          exportId,
          message.outputVideoId || null,
          message.outputFilename || null
        );

        // Notify callback (wrap in try-catch - callback may reference unmounted component)
        if (callbacks.onComplete) {
          try {
            callbacks.onComplete(message);
          } catch (e) {
            console.warn(`[ExportWSManager] onComplete callback error (continuing):`, e);
          }
        }

        // Emit event - ALWAYS do this even if callback failed
        this._emitEvent(exportId, 'complete', message);

        // Close connection - export is done
        this._closeConnection(exportId, true);
      } else if (status === ExportStatus.ERROR) {
        store.failExport(exportId, message.error || 'Export failed');

        // Notify callback (wrap in try-catch - callback may reference unmounted component)
        if (callbacks.onError) {
          try {
            callbacks.onError(message.error);
          } catch (e) {
            console.warn(`[ExportWSManager] onError callback error (continuing):`, e);
          }
        }

        // Emit event - ALWAYS do this even if callback failed
        this._emitEvent(exportId, 'error', message);

        // Close connection - export failed
        this._closeConnection(exportId, true);
      } else {
        // Progress update - include projectId, type, and projectName from backend
        store.updateExportProgress(exportId, {
          current: progress,
          total: 100,
          percent: progress,
          message: progressMessage || '',
          projectId,    // From backend WebSocket message
          type,         // From backend WebSocket message
          projectName,  // From backend WebSocket message
        });

        // Notify callback (wrap in try-catch - callback may reference unmounted component)
        if (callbacks.onProgress) {
          try {
            callbacks.onProgress(progress, progressMessage);
          } catch (e) {
            console.warn(`[ExportWSManager] onProgress callback error (continuing):`, e);
          }
        }

        // Emit event
        this._emitEvent(exportId, 'progress', { progress, message: progressMessage });
      }
    } catch (e) {
      // Only warn if it's an unexpected message (not empty/whitespace)
      if (trimmedData && trimmedData.length > 0) {
        console.warn(`[ExportWSManager] Failed to parse message for ${exportId}:`, {
          error: e.message,
          dataLength: trimmedData.length,
          dataPreview: trimmedData.substring(0, 100)
        });
      }
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  _scheduleReconnect(exportId, callbacks) {
    const connectionInfo = this.connections.get(exportId);
    if (!connectionInfo) return;

    const { reconnectAttempt } = connectionInfo;

    if (reconnectAttempt >= RECONNECT_CONFIG.maxAttempts) {
      console.warn(`[ExportWSManager] Max reconnect attempts reached for ${exportId}`);
      this.connections.delete(exportId);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      RECONNECT_CONFIG.initialDelay * Math.pow(RECONNECT_CONFIG.backoffMultiplier, reconnectAttempt),
      RECONNECT_CONFIG.maxDelay
    );

    console.log(`[ExportWSManager] Scheduling reconnect for ${exportId} in ${delay}ms (attempt ${reconnectAttempt + 1})`);

    connectionInfo.reconnectAttempt = reconnectAttempt + 1;
    connectionInfo.reconnectTimeout = setTimeout(() => {
      // Check if export is still active before reconnecting
      const exportState = useExportStore.getState().activeExports[exportId];
      if (exportState && (exportState.status === 'pending' || exportState.status === 'processing')) {
        this.connect(exportId, callbacks);
      } else {
        this.connections.delete(exportId);
      }
    }, delay);
  }

  /**
   * Close a WebSocket connection
   *
   * @param {string} exportId - Export to disconnect
   * @param {boolean} permanent - If true, don't attempt reconnection
   */
  _closeConnection(exportId, permanent = false) {
    const connectionInfo = this.connections.get(exportId);
    if (!connectionInfo) return;

    // Clear keepalive
    if (connectionInfo.keepaliveInterval) {
      clearInterval(connectionInfo.keepaliveInterval);
    }

    // Clear reconnect timeout
    if (connectionInfo.reconnectTimeout) {
      clearTimeout(connectionInfo.reconnectTimeout);
    }

    // Close WebSocket
    if (connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
      connectionInfo.ws.close();
    }

    if (permanent) {
      this.connections.delete(exportId);
    }
  }

  /**
   * Disconnect a specific export
   *
   * @param {string} exportId - Export to disconnect
   */
  disconnect(exportId) {
    console.log(`[ExportWSManager] Disconnecting ${exportId}`);
    this._closeConnection(exportId, true);
  }

  /**
   * Disconnect all active connections
   */
  disconnectAll() {
    console.log(`[ExportWSManager] Disconnecting all (${this.connections.size} connections)`);
    for (const exportId of this.connections.keys()) {
      this._closeConnection(exportId, true);
    }
    this.connections.clear();
  }

  /**
   * Check if connected to a specific export
   *
   * @param {string} exportId - Export to check
   * @returns {boolean} - True if WebSocket is open
   */
  isConnected(exportId) {
    const connectionInfo = this.connections.get(exportId);
    return connectionInfo?.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Recover connections for active exports (e.g., after page refresh)
   *
   * Checks exportStore for pending/processing exports and reconnects to their
   * WebSocket endpoints. Call this on app initialization.
   */
  async recoverConnections() {
    const { activeExports } = useExportStore.getState();
    const activeIds = Object.keys(activeExports).filter(id => {
      const exp = activeExports[id];
      return exp.status === 'pending' || exp.status === 'processing';
    });

    if (activeIds.length === 0) {
      console.log('[ExportWSManager] No active exports to recover');
      return;
    }

    console.log(`[ExportWSManager] Recovering connections for ${activeIds.length} active exports`);

    // Connect to all active exports in parallel
    await Promise.all(
      activeIds.map(exportId => this.connect(exportId))
    );
  }

  /**
   * Add an event listener for export events
   *
   * @param {string} exportId - Export to listen to, or '*' for all
   * @param {string} event - Event type: 'progress', 'complete', 'error'
   * @param {function} callback - Callback function
   * @returns {function} - Unsubscribe function
   */
  addEventListener(exportId, event, callback) {
    const key = `${exportId}:${event}`;
    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, new Set());
    }
    this.eventListeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(key);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.eventListeners.delete(key);
        }
      }
    };
  }

  /**
   * Emit an event to listeners
   */
  _emitEvent(exportId, event, data) {
    console.log(`[ExportWSManager] Emitting '${event}' event for ${exportId}`);

    // Emit to specific export listeners
    const specificKey = `${exportId}:${event}`;
    const specificListeners = this.eventListeners.get(specificKey);
    if (specificListeners) {
      console.log(`[ExportWSManager] Found ${specificListeners.size} specific listener(s) for ${specificKey}`);
      specificListeners.forEach(cb => {
        try {
          cb(data, exportId);
        } catch (e) {
          console.warn(`[ExportWSManager] Event listener error:`, e);
        }
      });
    }

    // Emit to wildcard listeners
    const wildcardKey = `*:${event}`;
    const wildcardListeners = this.eventListeners.get(wildcardKey);
    if (wildcardListeners) {
      console.log(`[ExportWSManager] Found ${wildcardListeners.size} wildcard listener(s) for ${wildcardKey}`);
      wildcardListeners.forEach(cb => {
        try {
          cb(data, exportId);
        } catch (e) {
          console.warn(`[ExportWSManager] Event listener error:`, e);
        }
      });
    }

    if (!specificListeners && !wildcardListeners) {
      console.log(`[ExportWSManager] No listeners found for '${event}' event`);
    }
  }

  /**
   * Get status of all connections
   *
   * @returns {object} - Map of exportId -> connection status
   */
  getConnectionStatus() {
    const status = {};
    for (const [exportId, info] of this.connections) {
      status[exportId] = {
        connected: info.ws?.readyState === WebSocket.OPEN,
        reconnectAttempt: info.reconnectAttempt,
        readyState: info.ws?.readyState,
      };
    }
    return status;
  }
}

// Singleton instance
const exportWebSocketManager = new ExportWebSocketManager();

// Export both the class (for testing) and the singleton instance
export { ExportWebSocketManager };
export default exportWebSocketManager;
