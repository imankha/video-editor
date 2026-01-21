# Task 15: Frontend Workers Updates

## Overview
Update the frontend to work with Cloudflare Workers API, including WebSocket connections for real-time progress.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 14 complete (Backend routing to Workers)

## Testability
**After this task**: Phase 3 complete. Frontend works with Workers backend.

---

## What Changes

| Before | After |
|--------|-------|
| HTTP polling for progress | WebSocket for real-time updates |
| Single API endpoint | Can switch between local/Workers |
| No reconnection handling | Auto-reconnect WebSocket |

---

## Configuration Updates

### config.js

```javascript
// API configuration
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Optional: Direct Workers URL for WebSocket (if different from API)
export const WORKERS_WS_URL = import.meta.env.VITE_WORKERS_WS_URL || null;
```

### .env.local (Development)

```bash
VITE_API_URL=http://localhost:8000
```

### .env.production

```bash
VITE_API_URL=https://api.reelballers.com
# Or if using Workers directly:
# VITE_API_URL=https://reel-ballers-api.workers.dev
```

---

## Updated Export Store

### stores/exportStore.js

```javascript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { API_URL } from '../config';

export const useExportStore = create(
  persist(
    (set, get) => ({
      // Active jobs: { [jobId]: { status, progress, outputKey, error, wsUrl } }
      activeJobs: {},

      // WebSocket connections: { [jobId]: WebSocket }
      connections: {},

      /**
       * Start an export job
       */
      startExport: async (type, params) => {
        const endpoint = type === 'overlay'
          ? '/api/export/overlay/start'
          : type === 'framing'
          ? '/api/export/framing/start'
          : '/api/export/annotate/start';

        const response = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error('Failed to start export');
        }

        const data = await response.json();
        const { job_id, websocket_url } = data;

        // Add to active jobs
        set((state) => ({
          activeJobs: {
            ...state.activeJobs,
            [job_id]: {
              type,
              status: 'processing',
              progress: 0,
              wsUrl: websocket_url,
              startedAt: new Date().toISOString(),
            },
          },
        }));

        // Connect WebSocket if URL provided
        if (websocket_url) {
          get().connectWebSocket(job_id, websocket_url);
        } else {
          // Fall back to polling
          get().startPolling(job_id);
        }

        return job_id;
      },

      /**
       * Connect WebSocket for real-time updates
       */
      connectWebSocket: (jobId, wsUrl) => {
        // Don't reconnect if already connected
        if (get().connections[jobId]) return;

        console.log(`Connecting WebSocket for job ${jobId}`);
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log(`WebSocket connected for job ${jobId}`);
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          get().handleWebSocketMessage(jobId, data);
        };

        ws.onerror = (error) => {
          console.error(`WebSocket error for job ${jobId}:`, error);
        };

        ws.onclose = (event) => {
          console.log(`WebSocket closed for job ${jobId}:`, event.code);
          // Remove from connections
          set((state) => {
            const { [jobId]: removed, ...rest } = state.connections;
            return { connections: rest };
          });

          // If job still processing, try to reconnect or fall back to polling
          const job = get().activeJobs[jobId];
          if (job && (job.status === 'processing' || job.status === 'pending')) {
            if (event.code !== 1000) {
              // Abnormal close - retry after delay
              setTimeout(() => {
                const currentJob = get().activeJobs[jobId];
                if (currentJob?.wsUrl && currentJob.status === 'processing') {
                  get().connectWebSocket(jobId, currentJob.wsUrl);
                }
              }, 3000);
            }
          }
        };

        // Store connection
        set((state) => ({
          connections: { ...state.connections, [jobId]: ws },
        }));

        // Keep-alive ping
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);
      },

      /**
       * Handle WebSocket message
       */
      handleWebSocketMessage: (jobId, data) => {
        switch (data.type) {
          case 'status':
          case 'progress':
            set((state) => ({
              activeJobs: {
                ...state.activeJobs,
                [jobId]: {
                  ...state.activeJobs[jobId],
                  status: data.status || 'processing',
                  progress: data.progress ?? state.activeJobs[jobId]?.progress ?? 0,
                  message: data.message,
                },
              },
            }));
            break;

          case 'complete':
            set((state) => ({
              activeJobs: {
                ...state.activeJobs,
                [jobId]: {
                  ...state.activeJobs[jobId],
                  status: 'complete',
                  progress: 100,
                  outputUrl: data.output_url,
                  completedAt: new Date().toISOString(),
                },
              },
            }));
            get().disconnectWebSocket(jobId);
            break;

          case 'error':
            set((state) => ({
              activeJobs: {
                ...state.activeJobs,
                [jobId]: {
                  ...state.activeJobs[jobId],
                  status: 'error',
                  error: data.error,
                },
              },
            }));
            get().disconnectWebSocket(jobId);
            break;

          case 'pong':
            // Keep-alive response, ignore
            break;
        }
      },

      /**
       * Disconnect WebSocket
       */
      disconnectWebSocket: (jobId) => {
        const ws = get().connections[jobId];
        if (ws) {
          ws.close(1000, 'Job complete');
        }
      },

      /**
       * Fall back to polling (if WebSocket not available)
       */
      startPolling: (jobId) => {
        const poll = async () => {
          const job = get().activeJobs[jobId];
          if (!job || job.status === 'complete' || job.status === 'error') {
            return;
          }

          try {
            const response = await fetch(`${API_URL}/api/export/status/${jobId}`, {
              credentials: 'include',
            });
            const data = await response.json();

            set((state) => ({
              activeJobs: {
                ...state.activeJobs,
                [jobId]: {
                  ...state.activeJobs[jobId],
                  status: data.status,
                  progress: data.progress || 0,
                  outputUrl: data.output_key
                    ? `${API_URL}/api/storage/presigned-url?key=${encodeURIComponent(data.output_key)}`
                    : undefined,
                  error: data.error,
                },
              },
            }));

            if (data.status === 'processing' || data.status === 'pending') {
              setTimeout(poll, 2000);
            }
          } catch (error) {
            console.error('Polling error:', error);
            setTimeout(poll, 5000);
          }
        };

        poll();
      },

      /**
       * Get download URL for completed export
       */
      getDownloadUrl: async (jobId) => {
        const job = get().activeJobs[jobId];
        if (!job?.outputUrl) return null;

        // If outputUrl is already a full URL, return it
        if (job.outputUrl.startsWith('http')) {
          return job.outputUrl;
        }

        // Otherwise, it's a relative URL - fetch presigned URL
        const response = await fetch(`${API_URL}${job.outputUrl}`, {
          credentials: 'include',
        });
        const { url } = await response.json();
        return url;
      },

      /**
       * Clear a job from the store
       */
      clearJob: (jobId) => {
        get().disconnectWebSocket(jobId);
        set((state) => {
          const { [jobId]: removed, ...rest } = state.activeJobs;
          return { activeJobs: rest };
        });
      },

      /**
       * Recover jobs on app load
       */
      recoverJobs: () => {
        const { activeJobs } = get();
        Object.entries(activeJobs).forEach(([jobId, job]) => {
          if (job.status === 'processing' || job.status === 'pending') {
            if (job.wsUrl) {
              get().connectWebSocket(jobId, job.wsUrl);
            } else {
              get().startPolling(jobId);
            }
          }
        });
      },
    }),
    {
      name: 'export-store',
      partialize: (state) => ({
        activeJobs: state.activeJobs,
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

export function useExportRecovery() {
  const recoverJobs = useExportStore((s) => s.recoverJobs);

  useEffect(() => {
    // Recover jobs on mount
    recoverJobs();
  }, [recoverJobs]);
}
```

---

## Integration in App.jsx

```jsx
import { useExportRecovery } from './hooks/useExportRecovery';
import { GlobalExportIndicator } from './components/GlobalExportIndicator';

function App() {
  useExportRecovery();

  return (
    <div>
      {/* ... rest of app ... */}
      <GlobalExportIndicator />
    </div>
  );
}
```

---

## Testing

### Test with Workers backend

1. Start Workers dev server: `cd workers && npm run dev`
2. Start backend with `USE_WORKERS_EXPORT=true`
3. Start frontend: `npm run dev`
4. Start an export
5. Verify WebSocket connects and shows progress
6. Verify download works on completion

### Test recovery after page refresh

1. Start an export
2. Refresh the page mid-export
3. Verify WebSocket reconnects
4. Verify export completes

### Test fallback to polling

1. Disable WebSocket URL in backend response
2. Start an export
3. Verify polling works as fallback

---

## Handoff Notes

**Phase 3 Complete!**

The app now works with:
- FastAPI backend (optional, for development)
- Cloudflare Workers (production)
- RunPod GPU processing
- R2 storage

Next phases are optional:
- Phase 4: Payments & Users (if monetizing)
- Phase 5: DO+SQLite migration (if DB > 1MB)
