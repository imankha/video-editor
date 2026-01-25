import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { API_BASE } from '../config';

/**
 * ConnectionStatus - Shows a banner when backend is unreachable
 *
 * Checks /api/health on mount and shows error banner if it fails.
 * Auto-retries every 5 seconds when disconnected.
 *
 * States:
 * - null: Initial state, checking connection
 * - true: Connected to backend
 * - false: Cannot connect to backend
 */
export function ConnectionStatus() {
  // Start as null (unknown) rather than true (assumed connected)
  const [isConnected, setIsConnected] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [lastError, setLastError] = useState(null);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const response = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
        // Prevent caching of health checks
        headers: { 'Cache-Control': 'no-cache' }
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        setIsConnected(true);
        setLastError(null);
      } else {
        // Handle proxy errors (502, 503, 504) and other server errors
        setIsConnected(false);
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          setLastError('Backend server is not running');
        } else {
          setLastError(`Server error: ${response.status}`);
        }
      }
    } catch (err) {
      setIsConnected(false);
      if (err.name === 'AbortError') {
        setLastError('Connection timeout - backend not responding');
      } else if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        setLastError('Cannot connect to backend server');
      } else {
        setLastError('Backend server unavailable');
      }
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Auto-retry when disconnected
  useEffect(() => {
    if (isConnected === false) {
      const interval = setInterval(checkConnection, 5000);
      return () => clearInterval(interval);
    }
  }, [isConnected, checkConnection]);

  // Don't show anything if connected
  if (isConnected === true) return null;

  // Show checking state on initial load
  if (isConnected === null && isChecking) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-gray-700 text-white px-4 py-2 flex items-center justify-center gap-3 shadow-lg">
        <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
        <span className="font-medium">Connecting to server...</span>
      </div>
    );
  }

  // Show error state when disconnected
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 flex items-center justify-center gap-3 shadow-lg">
      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
      <span className="font-medium">
        {lastError || 'Cannot connect to backend server'}
      </span>
      <button
        onClick={checkConnection}
        disabled={isChecking}
        className="ml-2 px-3 py-1 bg-red-700 hover:bg-red-800 rounded text-sm flex items-center gap-1 disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
        {isChecking ? 'Checking...' : 'Retry'}
      </button>
    </div>
  );
}

export default ConnectionStatus;
