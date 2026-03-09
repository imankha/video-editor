import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { API_BASE } from '../config';

// Grace period: stay in friendly "Connecting..." state for this many failed attempts
// before escalating to the red error banner
const GRACE_ATTEMPTS = 3;

// Retry schedule: fast initial retries for cold start wake-ups, then slower
const RETRY_DELAYS = [1000, 2000, 5000]; // 1s, 2s, then 5s thereafter

// First health check gets a longer timeout to absorb cold starts
const INITIAL_TIMEOUT = 10000;
const NORMAL_TIMEOUT = 5000;

/**
 * ConnectionStatus - Shows a banner when backend is unreachable
 *
 * On mount, checks /api/health with a generous timeout (10s) to absorb cold starts.
 * If it fails, stays in a friendly "Connecting..." state for the first few attempts
 * with fast retries (1s, 2s) before escalating to a red error banner.
 *
 * Differentiates between:
 * - 503: Server waking up from suspend (friendly message)
 * - Network error / timeout: Actual connection problem (error message)
 */
export function ConnectionStatus() {
  const [isConnected, setIsConnected] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [lastError, setLastError] = useState(null);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const failCountRef = useRef(0);
  const isFirstCheckRef = useRef(true);
  const retryTimeoutRef = useRef(null);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    const timeout = isFirstCheckRef.current ? INITIAL_TIMEOUT : NORMAL_TIMEOUT;
    isFirstCheckRef.current = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' }
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        setIsConnected(true);
        setLastError(null);
        setIsWakingUp(false);
        failCountRef.current = 0;
      } else {
        failCountRef.current++;
        if (response.status === 503) {
          // 503 = Fly proxy waking a suspended machine
          setIsWakingUp(true);
          setLastError('Server is waking up, one moment...');
        } else if (response.status === 502 || response.status === 504) {
          setLastError('Backend server is not running');
        } else {
          setLastError(`Server error: ${response.status}`);
        }
        setIsConnected(false);
      }
    } catch (err) {
      failCountRef.current++;
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

  // Auto-retry with progressive delays when disconnected
  useEffect(() => {
    if (isConnected === false) {
      const attemptIndex = Math.min(failCountRef.current, RETRY_DELAYS.length - 1);
      const delay = RETRY_DELAYS[attemptIndex];
      retryTimeoutRef.current = setTimeout(checkConnection, delay);
      return () => clearTimeout(retryTimeoutRef.current);
    }
  }, [isConnected, isChecking, checkConnection]);

  // Don't show anything if connected
  if (isConnected === true) return null;

  // Show friendly "Connecting..." state during initial check and grace period
  const inGracePeriod = failCountRef.current < GRACE_ATTEMPTS;
  if (isConnected === null || inGracePeriod || isWakingUp) {
    const message = isWakingUp
      ? 'Server is waking up, one moment...'
      : 'Connecting to server...';

    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-gray-700 text-white px-4 py-2 flex items-center justify-center gap-3 shadow-lg">
        <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
        <span className="font-medium">{message}</span>
      </div>
    );
  }

  // Show error state after grace period exhausted
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
