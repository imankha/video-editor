import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { API_BASE } from '../config';

/**
 * ConnectionStatus - Shows a banner when backend is unreachable
 *
 * Checks /api/health on mount and shows error banner if it fails.
 * Auto-retries every 5 seconds when disconnected.
 */
export function ConnectionStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [lastError, setLastError] = useState(null);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        setIsConnected(true);
        setLastError(null);
      } else {
        setIsConnected(false);
        setLastError(`Server error: ${response.status}`);
      }
    } catch (err) {
      setIsConnected(false);
      if (err.name === 'AbortError') {
        setLastError('Connection timeout');
      } else {
        setLastError('Backend server unavailable');
      }
    } finally {
      setIsChecking(false);
    }
  };

  // Check on mount
  useEffect(() => {
    checkConnection();
  }, []);

  // Auto-retry when disconnected
  useEffect(() => {
    if (!isConnected) {
      const interval = setInterval(checkConnection, 5000);
      return () => clearInterval(interval);
    }
  }, [isConnected]);

  // Don't show anything if connected
  if (isConnected) return null;

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
