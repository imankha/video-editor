/**
 * ExtractionWebSocketManager - WebSocket manager for extraction status updates
 *
 * Unlike ExportWebSocketManager which tracks individual exports, this service
 * uses a single broadcast channel to receive all extraction events.
 *
 * Events:
 * - extraction_complete: A clip has finished extracting
 * - extraction_failed: A clip extraction failed
 */

// Reconnection configuration
const RECONNECT_CONFIG = {
  initialDelay: 1000,    // 1 second initial delay
  maxDelay: 30000,       // 30 seconds max delay
  backoffMultiplier: 2,  // Double delay each attempt
  maxAttempts: 10,       // Give up after 10 attempts
};

const KEEPALIVE_INTERVAL = 30000; // 30 seconds

class ExtractionWebSocketManager {
  constructor() {
    this.ws = null;
    this.keepaliveInterval = null;
    this.reconnectAttempt = 0;
    this.reconnectTimeout = null;
    this.isConnected = false;
    this.shouldReconnect = false;

    // Event listeners: Map<eventType, Set<callback>>
    this.eventListeners = new Map();
  }

  /**
   * Build WebSocket URL for extractions
   */
  _buildWsUrl() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/ws/extractions`;
  }

  /**
   * Connect to the extraction WebSocket
   *
   * @returns {Promise<boolean>} - Resolves true if connected successfully
   */
  connect() {
    return new Promise((resolve) => {
      // Already connected
      if (this.isConnected) {
        resolve(true);
        return;
      }

      // Close existing connection if any
      this._closeConnection(false);

      this.shouldReconnect = true;
      const wsUrl = this._buildWsUrl();
      console.log(`[ExtractionWSManager] Connecting to ${wsUrl}`);

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        console.error('[ExtractionWSManager] Failed to create WebSocket:', err);
        resolve(false);
        return;
      }

      this.ws.onopen = () => {
        const wasReconnect = this.reconnectAttempt > 0;
        console.log(`[ExtractionWSManager] Connected${wasReconnect ? ' (reconnect)' : ''}`);
        this.isConnected = true;
        this.reconnectAttempt = 0;
        this._startKeepalive();
        // T249: Emit reconnect event so listeners can refresh stale data
        if (wasReconnect) {
          this._handleMessage({ type: 'reconnect' });
        }
        resolve(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (err) {
          // Might be a pong response
          if (event.data !== 'pong') {
            console.warn('[ExtractionWSManager] Failed to parse message:', event.data);
          }
        }
      };

      this.ws.onerror = (error) => {
        console.error('[ExtractionWSManager] WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        console.log(`[ExtractionWSManager] Disconnected (code: ${event.code})`);
        this.isConnected = false;
        this._stopKeepalive();

        if (this.shouldReconnect) {
          this._scheduleReconnect();
        }
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (!this.isConnected) {
          console.warn('[ExtractionWSManager] Connection timeout');
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect() {
    this.shouldReconnect = false;
    this._closeConnection(true);
  }

  /**
   * Handle incoming WebSocket messages
   */
  _handleMessage(data) {
    const eventType = data.type;
    console.log('[ExtractionWSManager] Received event:', eventType, data);

    // Notify listeners
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error('[ExtractionWSManager] Listener error:', err);
        }
      });
    }

    // Also notify wildcard listeners
    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error('[ExtractionWSManager] Wildcard listener error:', err);
        }
      });
    }
  }

  /**
   * Add an event listener
   *
   * @param {string} eventType - 'extraction_complete', 'extraction_failed', or '*' for all
   * @param {function} callback - Called with event data
   * @returns {function} - Unsubscribe function
   */
  addEventListener(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType).add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(eventType);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * Close the WebSocket connection
   */
  _closeConnection(clearReconnect = true) {
    if (clearReconnect && this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this._stopKeepalive();

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Schedule a reconnection attempt
   */
  _scheduleReconnect() {
    if (this.reconnectAttempt >= RECONNECT_CONFIG.maxAttempts) {
      console.warn('[ExtractionWSManager] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      RECONNECT_CONFIG.initialDelay * Math.pow(RECONNECT_CONFIG.backoffMultiplier, this.reconnectAttempt),
      RECONNECT_CONFIG.maxDelay
    );

    console.log(`[ExtractionWSManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  /**
   * Start keepalive ping/pong
   */
  _startKeepalive() {
    this._stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send('ping');
        } catch (err) {
          console.warn('[ExtractionWSManager] Keepalive failed:', err);
        }
      }
    }, KEEPALIVE_INTERVAL);
  }

  /**
   * Stop keepalive
   */
  _stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }
}

// Singleton instance
const extractionWebSocketManager = new ExtractionWebSocketManager();

export default extractionWebSocketManager;
