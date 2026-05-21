import { useEffect, useRef } from 'react';
import { useExportStore } from '../stores/exportStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { ExportStatus } from '../constants/exportStatus';
import { initSession } from '../utils/sessionInit';

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
      // T635: Wait for auth to complete before fetching exports
      // initSession() returns the cached promise if already resolved
      const session = await initSession();
      // T1330: no exports to recover pre-login.
      if (!session.isAuthenticated) return;
      console.log('[ExportRecovery] Fetching active exports from backend...');

      const [activeResult, unacknowledgedResult] = await Promise.allSettled([
        apiFetch(`${API_BASE}/api/exports/active`),
        apiFetch(`${API_BASE}/api/exports/unacknowledged`),
      ]);

      // Process active exports
      try {
        if (activeResult.status !== 'fulfilled') {
          console.error('[ExportRecovery] Failed to load exports:', activeResult.reason);
        } else if (!activeResult.value.ok) {
          console.warn('[ExportRecovery] Failed to fetch active exports:', activeResult.value.status);
        } else {
          const data = await activeResult.value.json();
          const serverExports = data.exports || [];

          console.log(`[ExportRecovery] Found ${serverExports.length} active exports`);

          setExportsFromServer(serverExports);

          for (const exp of serverExports) {
            if (exp.status === ExportStatus.PENDING || exp.status === ExportStatus.PROCESSING) {
              console.log(`[ExportRecovery] Checking Modal status for ${exp.job_id}`);

              const stillRunning = await checkModalStatusOnce(exp);

              if (stillRunning) {
                console.log(`[ExportRecovery] Connecting WebSocket for ${exp.job_id}`);

                setupSilenceTimeout(exp);

                await exportWebSocketManager.connect(exp.job_id, {
                  onProgress: () => {
                    resetSilenceTimeout(exp);
                  },
                  onComplete: () => {
                    clearSilenceTimeout(exp.job_id);
                  },
                  onError: () => {
                    clearSilenceTimeout(exp.job_id);
                  },
                });
              }
            }
          }

          console.log('[ExportRecovery] Recovery complete');
        }
      } catch (err) {
        console.error('[ExportRecovery] Failed to load exports:', err);
      }

      // Process unacknowledged exports (completed while user was away)
      try {
        if (unacknowledgedResult.status !== 'fulfilled') {
          console.error('[ExportRecovery] Failed to show completed export notifications:', unacknowledgedResult.reason);
        } else if (!unacknowledgedResult.value.ok) {
          console.warn('[ExportRecovery] Failed to fetch unacknowledged exports:', unacknowledgedResult.value.status);
        } else {
          const data = await unacknowledgedResult.value.json();
          const completedExports = data.exports || [];

          if (completedExports.length === 0) {
            console.log('[ExportRecovery] No unacknowledged completed exports');
          } else {
            console.log(`[ExportRecovery] Found ${completedExports.length} exports that completed while away`);

            const jobIdsToAcknowledge = [];
            for (const exp of completedExports) {
              if (exp.status === ExportStatus.COMPLETE) {
                completeExport(exp.job_id, exp.output_video_id, exp.output_filename);
              } else if (exp.status === ExportStatus.ERROR) {
                failExport(exp.job_id, exp.error || 'Export failed');
              }
              jobIdsToAcknowledge.push(exp.job_id);
            }

            if (jobIdsToAcknowledge.length > 0) {
              try {
                await apiFetch(`${API_BASE}/api/exports/acknowledge`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(jobIdsToAcknowledge),
                });
                console.log(`[ExportRecovery] Acknowledged ${jobIdsToAcknowledge.length} exports`);
              } catch (ackErr) {
                console.warn('[ExportRecovery] Failed to acknowledge exports:', ackErr);
              }
            }
          }
        }
      } catch (err) {
        console.error('[ExportRecovery] Failed to show completed export notifications:', err);
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
        const response = await apiFetch(`${API_BASE}/api/exports/${exp.job_id}/modal-status`);
        if (!response.ok) {
          console.warn(`[ExportRecovery] Failed to check Modal status for ${exp.job_id}`);
          return true; // Assume running if we can't check
        }

        const data = await response.json();
        console.log(`[ExportRecovery] Modal status for ${exp.job_id}:`, data.status);

        if (data.status === ExportStatus.COMPLETE) {
          // Modal finished - backend already finalized
          console.log(`[ExportRecovery] Export ${exp.job_id} completed on Modal`);
          // Update store — GlobalExportIndicator handles the toast
          completeExport(exp.job_id, data.working_video_id, data.output_filename);
          return false;
        } else if (data.status === 'running') {
          // Still running on Modal - resume progress simulation
          console.log(`[ExportRecovery] Export ${exp.job_id} still running on Modal, resuming progress`);

          // Start progress simulation on backend
          try {
            await apiFetch(`${API_BASE}/api/exports/${exp.job_id}/resume-progress`, { method: 'POST' });
            console.log(`[ExportRecovery] Started progress loop for ${exp.job_id}`);
          } catch (err) {
            console.warn(`[ExportRecovery] Failed to start progress loop for ${exp.job_id}:`, err);
          }

          // T12: Show initial progress while we wait for WebSocket updates
          // Include gameId/gameName for annotate exports
          updateExportProgress(exp.job_id, {
            projectId: exp.project_id,
            projectName: exp.project_name,
            type: exp.type,
            percent: 10, // Start at 10% (job already running)
            message: 'Reconnecting to cloud GPU...',
            // T12: Annotate export fields
            gameId: exp.game_id,
            gameName: exp.game_name,
          });
          return true;
        } else if (data.status === ExportStatus.ERROR) {
          // Modal job failed
          console.error(`[ExportRecovery] Export ${exp.job_id} failed on Modal:`, data.error);
          // Update store — GlobalExportIndicator handles the toast
          failExport(exp.job_id, data.error || 'Export failed on cloud GPU');
          return false;
        } else if (data.status === 'expired') {
          // Modal job expired (too old to recover)
          console.warn(`[ExportRecovery] Export ${exp.job_id} expired:`, data.message);
          failExport(exp.job_id, data.message || 'Export job expired');
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
