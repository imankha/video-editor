# Task 09: Frontend Export Updates

## Overview
Update the frontend to work with the new async export flow (submit job, poll for status).

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 08 complete (Backend RunPod integration)

## Testability
**After this task**: User clicks export → sees progress indicator → can download when complete.

---

## What Changes

| Before | After |
|--------|-------|
| Export blocks until complete | Export returns immediately, UI polls |
| WebSocket for progress | HTTP polling for status |
| Download from local backend | Download from R2 presigned URL |

---

## Files to Modify

### stores/exportStore.js

```javascript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useExportStore = create(
  persist(
    (set, get) => ({
      // Active jobs: { [jobId]: { status, progress, outputKey, error } }
      activeJobs: {},

      /**
       * Start an export job
       */
      startExport: async (type, params) => {
        const endpoint = type === 'overlay'
          ? '/api/export/overlay/start'
          : type === 'framing'
          ? '/api/export/framing/start'
          : '/api/export/annotate/start';

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          throw new Error('Failed to start export');
        }

        const { job_id } = await response.json();

        // Add to active jobs
        set((state) => ({
          activeJobs: {
            ...state.activeJobs,
            [job_id]: {
              type,
              status: 'processing',
              progress: 0,
              startedAt: new Date().toISOString(),
            },
          },
        }));

        // Start polling
        get().pollJobStatus(job_id);

        return job_id;
      },

      /**
       * Poll job status until complete
       */
      pollJobStatus: async (jobId) => {
        const poll = async () => {
          try {
            const job = get().activeJobs[jobId];
            if (!job || job.status === 'complete' || job.status === 'error') {
              return; // Stop polling
            }

            const endpoint = job.type === 'overlay'
              ? `/api/export/overlay/status/${jobId}`
              : job.type === 'framing'
              ? `/api/export/framing/status/${jobId}`
              : `/api/export/annotate/status/${jobId}`;

            const response = await fetch(endpoint);
            const data = await response.json();

            set((state) => ({
              activeJobs: {
                ...state.activeJobs,
                [jobId]: {
                  ...state.activeJobs[jobId],
                  status: data.status,
                  progress: data.progress || 0,
                  outputKey: data.output_key,
                  error: data.error,
                },
              },
            }));

            // Continue polling if still processing
            if (data.status === 'processing' || data.status === 'pending') {
              setTimeout(poll, 2000); // Poll every 2 seconds
            }
          } catch (error) {
            console.error('Failed to poll job status:', error);
            setTimeout(poll, 5000); // Retry after 5 seconds on error
          }
        };

        poll();
      },

      /**
       * Get download URL for completed export
       */
      getDownloadUrl: async (jobId) => {
        const job = get().activeJobs[jobId];
        if (!job?.outputKey) return null;

        // Get presigned URL from backend
        const response = await fetch(`/api/storage/presigned-url?key=${encodeURIComponent(job.outputKey)}`);
        const { url } = await response.json();
        return url;
      },

      /**
       * Clear a job from the store
       */
      clearJob: (jobId) => {
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
            get().pollJobStatus(jobId);
          }
        });
      },
    }),
    {
      name: 'export-store',
    }
  )
);
```

### components/ExportProgress.jsx

```jsx
import { useExportStore } from '../stores/exportStore';
import { Loader2, CheckCircle, XCircle, Download } from 'lucide-react';

export function ExportProgress({ jobId, onClose }) {
  const job = useExportStore((s) => s.activeJobs[jobId]);
  const getDownloadUrl = useExportStore((s) => s.getDownloadUrl);
  const clearJob = useExportStore((s) => s.clearJob);

  const handleDownload = async () => {
    const url = await getDownloadUrl(jobId);
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleClose = () => {
    clearJob(jobId);
    onClose?.();
  };

  if (!job) return null;

  return (
    <div className="bg-gray-800 rounded-lg p-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">
          {job.type === 'overlay' ? 'Overlay Export' : 'Framing Export'}
        </span>
        {job.status === 'complete' && (
          <button onClick={handleClose} className="text-gray-400 hover:text-white">
            ×
          </button>
        )}
      </div>

      {job.status === 'pending' && (
        <div className="flex items-center gap-2 text-yellow-400">
          <Loader2 className="animate-spin" size={16} />
          <span>Queued...</span>
        </div>
      )}

      {job.status === 'processing' && (
        <div>
          <div className="flex items-center gap-2 text-blue-400 mb-2">
            <Loader2 className="animate-spin" size={16} />
            <span>Processing...</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {job.status === 'complete' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle size={16} />
            <span>Complete!</span>
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 rounded"
          >
            <Download size={14} />
            Download
          </button>
        </div>
      )}

      {job.status === 'error' && (
        <div className="flex items-center gap-2 text-red-400">
          <XCircle size={16} />
          <span>{job.error || 'Export failed'}</span>
        </div>
      )}
    </div>
  );
}
```

### hooks/useExportRecovery.js

```javascript
import { useEffect } from 'react';
import { useExportStore } from '../stores/exportStore';

export function useExportRecovery() {
  const recoverJobs = useExportStore((s) => s.recoverJobs);

  useEffect(() => {
    recoverJobs();
  }, [recoverJobs]);
}
```

---

## Integration Points

### In App.jsx

```jsx
import { useExportRecovery } from './hooks/useExportRecovery';

function App() {
  useExportRecovery(); // Resume polling for active jobs on mount
  // ...
}
```

### In OverlayScreen (example)

```jsx
import { useExportStore } from '../stores/exportStore';

function OverlayScreen() {
  const startExport = useExportStore((s) => s.startExport);
  const [activeJobId, setActiveJobId] = useState(null);

  const handleExport = async () => {
    const jobId = await startExport('overlay', {
      project_id: projectId,
      highlight_regions: regions,
      effect_type: 'blur',
    });
    setActiveJobId(jobId);
  };

  return (
    <div>
      <button onClick={handleExport}>Export</button>
      {activeJobId && <ExportProgress jobId={activeJobId} />}
    </div>
  );
}
```

---

## Handoff Notes

**For Task 10 (Testing):**
- Full export flow should work end-to-end
- Test: start export → see progress → download result
- Test: refresh page during export → polling resumes
- Test: export fails → error message shown
