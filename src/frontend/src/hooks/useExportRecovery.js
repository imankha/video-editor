import { useEffect, useRef } from 'react';
import { useExportStore } from '../stores/exportStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { toast } from '../components/shared';
import { API_BASE } from '../config';

/**
 * useExportRecovery - Fetches active exports from backend on app startup
 *
 * TRUE MVC ARCHITECTURE:
 * - Backend is the SINGLE SOURCE OF TRUTH
 * - On app load, fetch current state from backend
 * - Connect WebSockets for real-time updates
 * - NO localStorage involved - store starts empty, populated from backend
 *
 * This hook should be called once at the app root level (App.jsx).
 */
export function useExportRecovery() {
  const hasRecovered = useRef(false);
  const setExportsFromServer = useExportStore((state) => state.setExportsFromServer);

  useEffect(() => {
    // Only run once
    if (hasRecovered.current) return;
    hasRecovered.current = true;

    async function loadExportsFromBackend() {
      console.log('[ExportRecovery] Fetching active exports from backend...');

      try {
        const response = await fetch(`${API_BASE}/api/exports/active`);
        if (!response.ok) {
          console.warn('[ExportRecovery] Failed to fetch active exports:', response.status);
          return;
        }

        const data = await response.json();
        const serverExports = data.exports || [];

        console.log(`[ExportRecovery] Found ${serverExports.length} active exports`);

        // Populate store with server data (this is the source of truth)
        setExportsFromServer(serverExports);

        // Connect WebSockets for any processing exports
        for (const exp of serverExports) {
          if (exp.status === 'pending' || exp.status === 'processing') {
            console.log(`[ExportRecovery] Connecting WebSocket for ${exp.job_id}`);
            await exportWebSocketManager.connect(exp.job_id, {
              onComplete: () => {
                toast.success('Export Complete', {
                  message: `${exp.type} export finished successfully`,
                  duration: 5000,
                });
              },
              onError: (error) => {
                toast.error('Export Failed', {
                  message: error || 'An error occurred during export',
                  duration: 8000,
                });
              },
            });
          }
        }

        console.log('[ExportRecovery] Recovery complete');
      } catch (err) {
        console.error('[ExportRecovery] Failed to load exports:', err);
      }
    }

    loadExportsFromBackend();
  }, [setExportsFromServer]);
}

export default useExportRecovery;
