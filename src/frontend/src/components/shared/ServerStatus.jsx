import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { API_BASE } from '../../config';

/**
 * ServerStatus - Shows an error banner when the backend server is unreachable.
 *
 * Checks server health on mount and periodically retries when disconnected.
 * Displays a dismissible error banner at the top of the page.
 */
export function ServerStatus() {
  const [serverDown, setServerDown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const checkHealth = async () => {
    setChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${API_BASE}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        setServerDown(false);
        setDismissed(false); // Reset dismissed state when server comes back
      } else {
        setServerDown(true);
      }
    } catch (err) {
      setServerDown(true);
    } finally {
      setChecking(false);
    }
  };

  // Check health on mount
  useEffect(() => {
    checkHealth();
  }, []);

  // Retry every 10 seconds when server is down
  useEffect(() => {
    if (serverDown && !dismissed) {
      const interval = setInterval(checkHealth, 10000);
      return () => clearInterval(interval);
    }
  }, [serverDown, dismissed]);

  if (!serverDown || dismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 shadow-lg">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} />
          <span className="font-medium">
            Backend server is not responding. Please start the server on port 8000.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={checkHealth}
            disabled={checking}
            className="flex items-center gap-1 px-3 py-1 bg-red-700 hover:bg-red-800 rounded transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
            <span>{checking ? 'Checking...' : 'Retry'}</span>
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-3 py-1 bg-red-700 hover:bg-red-800 rounded transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default ServerStatus;
