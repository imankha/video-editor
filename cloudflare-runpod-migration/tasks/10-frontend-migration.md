# Task 10: Frontend Migration

## Overview
Update the frontend to work with the new Cloudflare Workers API and WebSocket connections.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 06 complete (Workers API deployed)
- Task 09 complete (Backend updated)

## Time Estimate
1-2 hours

---

## Files to Modify

| File | Changes |
|------|---------|
| `stores/exportStore.js` | Update API calls, add Workers WebSocket |
| `services/ExportWebSocketManager.js` | Point to Workers WebSocket |
| `hooks/useExportManager.js` | Update for new response format |
| `hooks/useExportRecovery.js` | Update status polling |
| `components/GlobalExportIndicator.jsx` | Minor UI updates |
| `config.js` | Add Workers URL |

---

## Configuration Updates

### config.js

```javascript
// Add Workers API configuration
export const WORKERS_API_URL = import.meta.env.VITE_WORKERS_API_URL || 'http://localhost:8787';

// WebSocket URL (derived from API URL)
export const WORKERS_WS_URL = WORKERS_API_URL.replace('http', 'ws').replace('https', 'wss');

// Feature flag for gradual rollout
export const USE_CLOUD_EXPORTS = import.meta.env.VITE_USE_CLOUD_EXPORTS === 'true';
```

### .env.local (Development)

```bash
VITE_WORKERS_API_URL=http://localhost:8787
VITE_USE_CLOUD_EXPORTS=true
```

### .env.production

```bash
VITE_WORKERS_API_URL=https://reel-ballers-api.your-subdomain.workers.dev
VITE_USE_CLOUD_EXPORTS=true
```

---

## Updated Export Store

### stores/exportStore.js

```javascript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WORKERS_API_URL, WORKERS_WS_URL, USE_CLOUD_EXPORTS } from '../config';

/**
 * Export Store - Manages export job state
 *
 * Updated to support both local (FastAPI) and cloud (Workers) exports.
 */
export const useExportStore = create(
  persist(
    (set, get) => ({
      // Active exports: { [jobId]: ExportJob }
      activeExports: {},

      // WebSocket connections: { [jobId]: WebSocket }
      connections: {},

      /**
       * Start a new export job
       */
      startExport: async (projectId, type, params) => {
        if (USE_CLOUD_EXPORTS) {
          return get().startCloudExport(projectId, type, params);
        } else {
          return get().startLocalExport(projectId, type, params);
        }
      },

      /**
       * Start export via Cloudflare Workers
       */
      startCloudExport: async (projectId, type, params) => {
        try {
          // Submit job to Workers API
          const response = await fetch(`${WORKERS_API_URL}/api/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_id: projectId,
              type,
              input_video_key: params.input_video_key || '', // Will be set by backend
              params,
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to start export: ${response.statusText}`);
          }

          const data = await response.json();
          const jobId = data.job_id;

          // Add to active exports
          set((state) => ({
            activeExports: {
              ...state.activeExports,
              [jobId]: {
                jobId,
                projectId,
                type,
                status: 'pending',
                progress: 0,
                createdAt: new Date().toISOString(),
              },
            },
          }));

          // Connect WebSocket for real-time updates
          get().connectWebSocket(jobId);

          return { jobId, status: 'pending' };
        } catch (error) {
          console.error('Failed to start cloud export:', error);
          throw error;
        }
      },

      /**
       * Start export via local FastAPI (fallback)
       */
      startLocalExport: async (projectId, type, params) => {
        // Keep existing local export logic here
        // ...existing code...
      },

      /**
       * Connect WebSocket to Workers for job updates
       */
      connectWebSocket: (jobId) => {
        const wsUrl = `${WORKERS_WS_URL}/api/jobs/${jobId}/ws`;
        console.log(`Connecting to WebSocket: ${wsUrl}`);

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`WebSocket connected for job ${jobId}`);
          ws.send(JSON.stringify({ type: 'subscribe', job_id: jobId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          get().handleWebSocketMessage(jobId, data);
        };

        ws.onerror = (error) => {
          console.error(`WebSocket error for job ${jobId}:`, error);
        };

        ws.onclose = () => {
          console.log(`WebSocket closed for job ${jobId}`);
          // Remove from connections
          set((state) => {
            const { [jobId]: removed, ...rest } = state.connections;
            return { connections: rest };
          });
        };

        // Store connection
        set((state) => ({
          connections: { ...state.connections, [jobId]: ws },
        }));
      },

      /**
       * Handle incoming WebSocket message
       */
      handleWebSocketMessage: (jobId, data) => {
        console.log(`WebSocket message for ${jobId}:`, data);

        switch (data.type) {
          case 'progress':
            set((state) => ({
              activeExports: {
                ...state.activeExports,
                [jobId]: {
                  ...state.activeExports[jobId],
                  status: 'processing',
                  progress: data.progress,
                  message: data.message,
                },
              },
            }));
            break;

          case 'complete':
            set((state) => ({
              activeExports: {
                ...state.activeExports,
                [jobId]: {
                  ...state.activeExports[jobId],
                  status: 'complete',
                  progress: 100,
                  outputUrl: data.output_url,
                  completedAt: new Date().toISOString(),
                },
              },
            }));
            // Close WebSocket
            get().disconnectWebSocket(jobId);
            break;

          case 'error':
            set((state) => ({
              activeExports: {
                ...state.activeExports,
                [jobId]: {
                  ...state.activeExports[jobId],
                  status: 'error',
                  error: data.error,
                },
              },
            }));
            get().disconnectWebSocket(jobId);
            break;

          case 'status':
            // Initial status update
            set((state) => ({
              activeExports: {
                ...state.activeExports,
                [jobId]: {
                  ...state.activeExports[jobId],
                  status: data.status,
                  progress: data.progress || 0,
                },
              },
            }));
            break;
        }
      },

      /**
       * Disconnect WebSocket for a job
       */
      disconnectWebSocket: (jobId) => {
        const ws = get().connections[jobId];
        if (ws) {
          ws.close();
        }
      },

      /**
       * Poll job status (fallback if WebSocket disconnects)
       */
      pollJobStatus: async (jobId) => {
        try {
          const response = await fetch(`${WORKERS_API_URL}/api/jobs/${jobId}`);
          if (!response.ok) return null;

          const data = await response.json();

          set((state) => ({
            activeExports: {
              ...state.activeExports,
              [jobId]: {
                ...state.activeExports[jobId],
                status: data.status,
                progress: data.progress,
                outputUrl: data.output_url,
                error: data.error,
              },
            },
          }));

          return data;
        } catch (error) {
          console.error('Failed to poll job status:', error);
          return null;
        }
      },

      /**
       * Sync with server - called on app load
       */
      syncWithServer: async () => {
        const { activeExports } = get();

        for (const jobId of Object.keys(activeExports)) {
          const job = activeExports[jobId];

          // Skip completed/errored jobs
          if (job.status === 'complete' || job.status === 'error') continue;

          // Poll status
          const status = await get().pollJobStatus(jobId);

          if (status?.status === 'pending' || status?.status === 'processing') {
            // Reconnect WebSocket
            get().connectWebSocket(jobId);
          }
        }
      },

      /**
       * Clear completed export from store
       */
      clearExport: (jobId) => {
        get().disconnectWebSocket(jobId);
        set((state) => {
          const { [jobId]: removed, ...rest } = state.activeExports;
          return { activeExports: rest };
        });
      },

      /**
       * Download completed export
       */
      downloadExport: async (jobId) => {
        const job = get().activeExports[jobId];
        if (!job?.outputUrl) return;

        // Output URL is relative to Workers API
        const downloadUrl = job.outputUrl.startsWith('http')
          ? job.outputUrl
          : `${WORKERS_API_URL}${job.outputUrl}`;

        // Trigger download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `export-${jobId}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      },
    }),
    {
      name: 'export-store',
      partialize: (state) => ({
        // Only persist activeExports, not WebSocket connections
        activeExports: state.activeExports,
      }),
    }
  )
);
```

---

## Updated Export Recovery Hook

### hooks/useExportRecovery.js

```javascript
import { useEffect } from 'react';
import { useExportStore } from '../stores/exportStore';

/**
 * Hook to recover export state on app load
 *
 * - Syncs with server to get latest job status
 * - Reconnects WebSockets for active jobs
 * - Shows notifications for completed jobs
 */
export function useExportRecovery() {
  const syncWithServer = useExportStore((state) => state.syncWithServer);
  const activeExports = useExportStore((state) => state.activeExports);

  useEffect(() => {
    // Sync on mount
    syncWithServer();

    // Check for jobs that completed while away
    Object.values(activeExports).forEach((job) => {
      if (job.status === 'complete' && !job.notified) {
        // Show notification
        console.log(`Export ${job.jobId} completed while you were away`);
        // You could show a toast here
      }
    });
  }, []);

  return { activeExports };
}
```

---

## Updated Export Manager Hook

### hooks/useExportManager.js

```javascript
import { useCallback } from 'react';
import { useExportStore } from '../stores/exportStore';

/**
 * Hook for managing exports from components
 */
export function useExportManager() {
  const startExport = useExportStore((state) => state.startExport);
  const activeExports = useExportStore((state) => state.activeExports);
  const clearExport = useExportStore((state) => state.clearExport);
  const downloadExport = useExportStore((state) => state.downloadExport);

  const startOverlayExport = useCallback(
    async (projectId, params) => {
      return startExport(projectId, 'overlay', params);
    },
    [startExport]
  );

  const startFramingExport = useCallback(
    async (projectId, clipIndex, cropKeyframes) => {
      return startExport(projectId, 'framing', {
        clip_index: clipIndex,
        crop_keyframes: cropKeyframes,
      });
    },
    [startExport]
  );

  const getExportForProject = useCallback(
    (projectId) => {
      return Object.values(activeExports).find(
        (job) => job.projectId === projectId && job.status !== 'complete'
      );
    },
    [activeExports]
  );

  return {
    startOverlayExport,
    startFramingExport,
    getExportForProject,
    activeExports,
    clearExport,
    downloadExport,
  };
}
```

---

## Updated Global Export Indicator

### components/GlobalExportIndicator.jsx

```jsx
import React from 'react';
import { useExportStore } from '../stores/exportStore';
import { Loader2, CheckCircle, XCircle, Download } from 'lucide-react';

export function GlobalExportIndicator() {
  const activeExports = useExportStore((state) => state.activeExports);
  const downloadExport = useExportStore((state) => state.downloadExport);
  const clearExport = useExportStore((state) => state.clearExport);

  const exports = Object.values(activeExports);

  if (exports.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {exports.map((job) => (
        <div
          key={job.jobId}
          className="bg-gray-800 rounded-lg shadow-lg p-4 min-w-[300px] border border-gray-700"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">
              {job.type === 'overlay' ? 'Overlay Export' : 'Framing Export'}
            </span>
            {job.status === 'complete' && (
              <button
                onClick={() => clearExport(job.jobId)}
                className="text-gray-400 hover:text-white"
              >
                ×
              </button>
            )}
          </div>

          {job.status === 'pending' && (
            <div className="flex items-center gap-2 text-yellow-400">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">Queued...</span>
            </div>
          )}

          {job.status === 'processing' && (
            <div>
              <div className="flex items-center gap-2 text-blue-400 mb-2">
                <Loader2 className="animate-spin" size={16} />
                <span className="text-sm">{job.message || 'Processing...'}</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 mt-1">{job.progress}%</span>
            </div>
          )}

          {job.status === 'complete' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle size={16} />
                <span className="text-sm">Complete!</span>
              </div>
              <button
                onClick={() => downloadExport(job.jobId)}
                className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm"
              >
                <Download size={14} />
                Download
              </button>
            </div>
          )}

          {job.status === 'error' && (
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={16} />
              <span className="text-sm">{job.error || 'Export failed'}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## Integration in App.jsx

```jsx
import { useExportRecovery } from './hooks/useExportRecovery';
import { GlobalExportIndicator } from './components/GlobalExportIndicator';

function App() {
  // Recover export state on mount
  useExportRecovery();

  return (
    <div>
      {/* ... rest of app ... */}

      {/* Global export indicator - shows in corner */}
      <GlobalExportIndicator />
    </div>
  );
}
```

---

## Testing

1. **Start local Workers dev server:**
   ```bash
   cd workers && npm run dev
   ```

2. **Start frontend:**
   ```bash
   cd src/frontend && npm run dev
   ```

3. **Test export flow:**
   - Start an overlay export
   - Watch progress updates in GlobalExportIndicator
   - Verify download works on completion

4. **Test recovery:**
   - Start an export
   - Refresh the page
   - Verify export state is recovered
   - Verify WebSocket reconnects

---

## Handoff Notes

**For Task 11 (Testing):**
- Frontend is updated for cloud exports
- Test WebSocket connection reliability
- Test offline/reconnection scenarios
- Test download functionality
