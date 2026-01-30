import { useEffect, useRef } from 'react';
import { useExportStore } from '../stores/exportStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { toast } from '../components/shared';
import { API_BASE } from '../config';

// Re-poll Modal status after this many ms of WebSocket silence
const SILENCE_TIMEOUT_MS = 60000; // 60 seconds

/**
 * useExportRecovery - Fetches active exports from backend on app startup
 *
 * TRUE MVC ARCHITECTURE:
 * - Backend is the SINGLE SOURCE OF TRUTH
 * - On app load, fetch current state from backend
 * - For Modal jobs, poll /modal-status ONCE to check real status
 * - Connect WebSockets for real-time updates
 * - Re-poll /modal-status if WebSocket silent for 60s
 * - NO localStorage involved - store starts empty, populated from backend
 *
 * This hook should be called once at the app root level (App.jsx).
 */
export function useExportRecovery() {
  const hasRecovered = useRef(false);
  const silenceTimeouts = useRef(new Map()); // Track silence timeouts per export
  const setExportsFromServer = useExportStore((state) => state.setExportsFromServer);
  const updateExportProgress = useExportStore((state) => state.updateExportProgress);
  const completeExport = useExportStore((state) => state.completeExport);
  const failExport = useExportStore((state) => state.failExport);

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

        // For each processing export, check Modal status ONCE
        // This handles the case where Modal finished while user was away
        for (const exp of serverExports) {
          if (exp.status === 'pending' || exp.status === 'processing') {
            console.log(`[ExportRecovery] Checking Modal status for ${exp.job_id}`);

            // Poll Modal status once to check real state
            const stillRunning = await checkModalStatusOnce(exp);

            if (stillRunning) {
              // Connect WebSocket for still-processing exports
              console.log(`[ExportRecovery] Connecting WebSocket for ${exp.job_id}`);

              // Set up silence timeout - if no WebSocket progress in 60s, re-poll
              setupSilenceTimeout(exp);

              await exportWebSocketManager.connect(exp.job_id, {
                onProgress: () => {
                  // Reset silence timeout on any progress
                  resetSilenceTimeout(exp);
                },
                onComplete: () => {
                  clearSilenceTimeout(exp.job_id);
                  toast.success('Export Complete', {
                    message: `${exp.type} export finished successfully`,
                    duration: 5000,
                  });
                },
                onError: (error) => {
                  clearSilenceTimeout(exp.job_id);
                  toast.error('Export Failed', {
                    message: error || 'An error occurred during export',
                    duration: 8000,
                  });
                },
              });
            }
          }
        }

        console.log('[ExportRecovery] Recovery complete');
      } catch (err) {
        console.error('[ExportRecovery] Failed to load exports:', err);
      }
    }

    /**
     * Set up a timeout to re-poll /modal-status if WebSocket is silent.
     * This handles the case where backend crashed and progress loop is gone.
     */
    function setupSilenceTimeout(exp) {
      clearSilenceTimeout(exp.job_id);

      const timeoutId = setTimeout(async () => {
        console.log(`[ExportRecovery] WebSocket silent for ${SILENCE_TIMEOUT_MS}ms, re-polling Modal status for ${exp.job_id}`);
        const stillRunning = await checkModalStatusOnce(exp);

        if (stillRunning) {
          // Still running, set up another timeout
          setupSilenceTimeout(exp);
        }
      }, SILENCE_TIMEOUT_MS);

      silenceTimeouts.current.set(exp.job_id, timeoutId);
    }

    /**
     * Reset the silence timeout (called when WebSocket receives progress).
     */
    function resetSilenceTimeout(exp) {
      setupSilenceTimeout(exp);
    }

    /**
     * Clear the silence timeout.
     */
    function clearSilenceTimeout(jobId) {
      const timeoutId = silenceTimeouts.current.get(jobId);
      if (timeoutId) {
        clearTimeout(timeoutId);
        silenceTimeouts.current.delete(jobId);
      }
    }

    /**
     * Check Modal job status once.
     * Returns true if job is still running, false if complete/error/expired.
     */
    async function checkModalStatusOnce(exp) {
      try {
        const response = await fetch(`${API_BASE}/api/exports/${exp.job_id}/modal-status`);
        if (!response.ok) {
          console.warn(`[ExportRecovery] Failed to check Modal status for ${exp.job_id}`);
          return true; // Assume running if we can't check
        }

        const data = await response.json();
        console.log(`[ExportRecovery] Modal status for ${exp.job_id}:`, data.status);

        if (data.status === 'complete') {
          // Modal finished - backend already finalized
          console.log(`[ExportRecovery] Export ${exp.job_id} completed on Modal`);
          completeExport(exp.job_id, data.working_video_id, data.output_filename);
          toast.success('Export Complete', {
            message: `${exp.type} export finished while you were away`,
            duration: 5000,
          });
          return false;
        } else if (data.status === 'running') {
          // Still running on Modal - show indeterminate progress
          console.log(`[ExportRecovery] Export ${exp.job_id} still running on Modal`);
          updateExportProgress(exp.job_id, {
            projectId: exp.project_id,
            projectName: exp.project_name,
            type: exp.type,
            percent: -1, // Indeterminate
            message: 'Processing on cloud GPU...',
          });
          return true;
        } else if (data.status === 'error') {
          // Modal job failed
          console.error(`[ExportRecovery] Export ${exp.job_id} failed on Modal:`, data.error);
          failExport(exp.job_id, data.error || 'Export failed on cloud GPU');
          toast.error('Export Failed', {
            message: data.error || 'Export failed on cloud GPU',
            duration: 8000,
          });
          return false;
        } else if (data.status === 'expired') {
          // Modal job expired (too old to recover)
          console.warn(`[ExportRecovery] Export ${exp.job_id} expired:`, data.message);
          failExport(exp.job_id, data.message || 'Export job expired');
          toast.warning('Export Expired', {
            message: data.message || 'This export is too old to recover',
            duration: 8000,
          });
          return false;
        } else if (data.status === 'not_modal') {
          // Not a Modal job or no call_id - just show as processing
          console.log(`[ExportRecovery] Export ${exp.job_id} is not a Modal job or has no call_id`);
          return true;
        }

        return true; // Default: assume running
      } catch (err) {
        console.error(`[ExportRecovery] Error checking Modal status for ${exp.job_id}:`, err);
        return true; // Assume running if error
      }
    }

    loadExportsFromBackend();

    // Cleanup timeouts on unmount
    return () => {
      for (const timeoutId of silenceTimeouts.current.values()) {
        clearTimeout(timeoutId);
      }
      silenceTimeouts.current.clear();
    };
  }, [setExportsFromServer, updateExportProgress, completeExport, failExport]);
}

export default useExportRecovery;
