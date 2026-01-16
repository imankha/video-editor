# Parallel Export System - Implementation Plan

## Overview

This document outlines the refactoring needed to support:
1. **Multiple concurrent video exports** with proper progress tracking
2. **GPU-accelerated video encoding** to prevent UI/main thread freezes
3. **Persistent progress tracking** that survives navigation
4. **Proper completion notifications** regardless of current screen

---

## Current Architecture Issues

### Issue 1: Progress Bar Resets on Navigation
**Root Cause**: WebSocket connection lives in `ExportButton.jsx` - unmounts on navigation, loses progress.

**Files**:
- `src/frontend/src/components/ExportButton.jsx` (Lines 156-159, 198, 210-216)
- `src/frontend/src/stores/exportStore.js`

### Issue 2: UI Stalls During Navigation
**Root Cause**: No visibility into export once you leave - WebSocket closes, no reconnection logic.

**Files**:
- `src/frontend/src/components/ExportButton.jsx` (Lines 198, 210-216)
- `src/frontend/src/screens/ProjectsScreen.jsx` (Lines 128-171)

### Issue 3: Project Not Marked Complete
**Root Cause**: `ProjectsScreen` receives completion via WebSocket but doesn't refresh project list.

**Files**:
- `src/frontend/src/screens/ProjectsScreen.jsx` (Lines 143-157)

### Issue 4: No Completion Toast After Navigation
**Root Cause**: Toast created inside `ExportButton` which unmounts on navigation.

**Files**:
- `src/frontend/src/components/ExportButton.jsx` (Line 669)
- `src/frontend/src/stores/exportStore.js` (Line 32, 75, 80-85)

### Issue 5: FFmpeg Uses CPU, Not GPU
**Root Cause**: FFmpeg commands use `libx264` (CPU) instead of hardware encoders like NVENC.

**Files**:
- `src/backend/app/services/ffmpeg_service.py` (Lines 177-180)
- `src/backend/app/ai_upscaler/video_encoder.py` (Lines 519-528, 675-744)

---

## Architecture Diagram

### Current (Broken)
```
┌─────────────────┐     ┌─────────────────┐
│  ExportButton   │     │  ProjectsScreen │
│  (Component)    │     │  (Component)    │
├─────────────────┤     ├─────────────────┤
│ - WebSocket     │     │ - WebSocket     │  ← Duplicate, uncoordinated
│ - Progress UI   │     │ - Pending list  │
│ - Toast trigger │     │ - No refresh    │
└────────┬────────┘     └────────┬────────┘
         │ unmounts              │ unmounts
         ▼                       ▼
    [CONNECTION LOST]       [CONNECTION LOST]
```

### Target (Fixed)
```
┌─────────────────────────────────────────────────────────────┐
│                 ExportManager (Global Service)               │
│  - Lives in Zustand store, persists across navigation       │
│  - Single WebSocket manager for ALL exports                 │
│  - Tracks Map<exportId, ExportState>                        │
│  - Handles completion callbacks globally                    │
│  - Triggers toasts from anywhere                            │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
    Export #1            Export #2            Export #3
    (Framing)            (Overlay)            (Annotate)
         │                    │                    │
┌────────┴────────┐  ┌───────┴────────┐  ┌───────┴────────┐
│  ExportButton   │  │  ExportButton  │  │  ExportButton  │
│  (UI only)      │  │  (UI only)     │  │  (UI only)     │
│  - Reads from   │  │  - Reads from  │  │  - Reads from  │
│    global store │  │    global store│  │    global store│
└─────────────────┘  └────────────────┘  └────────────────┘
```

---

## Implementation Phases

### Phase 1: Global Export Manager (Frontend)
**Goal**: Centralize WebSocket management and progress tracking.

#### Task 1.1: Create Export Manager Store
**File**: `src/frontend/src/stores/exportStore.js`

```javascript
// NEW STATE
activeExports: Map<exportId, {
  projectId: number,
  type: 'framing' | 'overlay' | 'annotate',
  status: 'pending' | 'processing' | 'complete' | 'error',
  progress: { current: number, total: number, message: string },
  startedAt: Date,
  completedAt: Date | null,
  error: string | null
}>

// NEW ACTIONS
startExport(exportId, projectId, type)
updateExportProgress(exportId, progress)
completeExport(exportId, outputVideoId)
failExport(exportId, error)
removeExport(exportId)
getExportsByProject(projectId)
getActiveExports()
```

**Checklist**:
- [ ] Add `activeExports` Map to store state
- [ ] Add CRUD actions for export tracking
- [ ] Add selectors for querying exports
- [ ] Persist to localStorage for page refresh recovery

---

#### Task 1.2: Create WebSocket Manager
**File**: `src/frontend/src/services/ExportWebSocketManager.js` (NEW)

```javascript
class ExportWebSocketManager {
  connections: Map<exportId, WebSocket>

  connect(exportId, callbacks)
  disconnect(exportId)
  disconnectAll()
  reconnect(exportId)
  isConnected(exportId)

  // Called on app startup to reconnect to pending exports
  async recoverConnections(activeExportIds)
}

export const exportWSManager = new ExportWebSocketManager();
```

**Checklist**:
- [ ] Create singleton WebSocket manager class
- [ ] Implement connection pooling by exportId
- [ ] Add automatic reconnection with exponential backoff
- [ ] Add ping/pong keep-alive
- [ ] Handle connection errors gracefully
- [ ] Export singleton instance

---

#### Task 1.3: Create useExportManager Hook
**File**: `src/frontend/src/hooks/useExportManager.js` (NEW)

```javascript
export function useExportManager() {
  // Connect to exportStore
  const activeExports = useExportStore(state => state.activeExports);
  const startExport = useExportStore(state => state.startExport);
  // ... other actions

  // Initialize WebSocket connections on mount
  useEffect(() => {
    // Recover any active exports from store
    activeExports.forEach((export, id) => {
      if (export.status === 'processing') {
        exportWSManager.connect(id, {
          onProgress: (p) => updateExportProgress(id, p),
          onComplete: (output) => handleExportComplete(id, output),
          onError: (err) => failExport(id, err)
        });
      }
    });

    return () => {
      // Don't disconnect on unmount - exports continue in background
    };
  }, []);

  const handleExportComplete = (exportId, output) => {
    completeExport(exportId, output);
    showCompletionToast(exportId);
    refreshProjects();
  };

  return {
    activeExports,
    startNewExport,
    cancelExport,
    getExportProgress,
    // ...
  };
}
```

**Checklist**:
- [ ] Create hook that bridges store and WebSocket manager
- [ ] Implement export lifecycle methods
- [ ] Add global completion handler with toast
- [ ] Add project refresh on completion
- [ ] Handle recovery on app startup

---

#### Task 1.4: Refactor ExportButton
**File**: `src/frontend/src/components/ExportButton.jsx`

**Changes**:
- Remove local WebSocket management (Lines 198-216)
- Remove local progress state
- Use `useExportManager` hook instead
- Keep UI rendering logic

**Checklist**:
- [ ] Remove `wsRef` and WebSocket connection code
- [ ] Remove local `progress` state
- [ ] Import and use `useExportManager` hook
- [ ] Read progress from global store
- [ ] Trigger export via global manager
- [ ] Simplify component to UI-only

---

#### Task 1.5: Refactor ProjectsScreen
**File**: `src/frontend/src/screens/ProjectsScreen.jsx`

**Changes**:
- Remove duplicate WebSocket logic (Lines 128-171)
- Use `useExportManager` hook for pending export tracking
- Add `fetchProjects()` call on export completion

**Checklist**:
- [ ] Remove `pendingExports` state and WebSocket code
- [ ] Use `useExportManager` to get active exports
- [ ] Display export progress from global store
- [ ] Refresh project list on any export completion

---

#### Task 1.6: Add Global Export Status Indicator
**File**: `src/frontend/src/components/GlobalExportIndicator.jsx` (NEW)

```jsx
// Shows in header/navbar when exports are running
function GlobalExportIndicator() {
  const activeExports = useExportStore(state => state.activeExports);
  const runningCount = [...activeExports.values()]
    .filter(e => e.status === 'processing').length;

  if (runningCount === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-blue-600 rounded">
      <Loader className="animate-spin" size={14} />
      <span>{runningCount} export{runningCount > 1 ? 's' : ''} running</span>
    </div>
  );
}
```

**Checklist**:
- [ ] Create indicator component
- [ ] Add to App.jsx header/navbar
- [ ] Show count of running exports
- [ ] Click to expand and see details
- [ ] Link to individual export progress

---

### Phase 2: GPU-Accelerated Video Encoding (Backend)

**Goal**: Use NVIDIA NVENC for FFmpeg encoding to offload from CPU.

#### Task 2.1: Detect GPU Capabilities
**File**: `src/backend/app/services/ffmpeg_service.py`

```python
def get_available_encoders():
    """Check which hardware encoders are available."""
    result = subprocess.run(
        ['ffmpeg', '-encoders'],
        capture_output=True, text=True
    )
    encoders = {
        'h264_nvenc': 'h264_nvenc' in result.stdout,  # NVIDIA
        'h264_qsv': 'h264_qsv' in result.stdout,      # Intel QuickSync
        'h264_amf': 'h264_amf' in result.stdout,      # AMD
        'libx264': True  # Always available (CPU fallback)
    }
    return encoders

def get_best_encoder():
    """Return best available H.264 encoder."""
    encoders = get_available_encoders()
    if encoders['h264_nvenc']:
        return 'h264_nvenc', {'preset': 'p4', 'rc': 'vbr', 'cq': '19'}
    elif encoders['h264_qsv']:
        return 'h264_qsv', {'preset': 'medium', 'global_quality': '19'}
    elif encoders['h264_amf']:
        return 'h264_amf', {'quality': 'balanced', 'rc': 'vbr_latency'}
    else:
        return 'libx264', {'preset': 'fast', 'crf': '18'}
```

**Checklist**:
- [ ] Add encoder detection function
- [ ] Add encoder preference logic (NVENC > QSV > AMF > CPU)
- [ ] Cache detection result (run once on startup)
- [ ] Log which encoder is being used

---

#### Task 2.2: Update FFmpeg Service for GPU Encoding
**File**: `src/backend/app/services/ffmpeg_service.py`

**Current** (Lines 177-180):
```python
'-c:v', 'libx264',
'-preset', 'fast',
'-crf', '18',
```

**New**:
```python
encoder, params = get_best_encoder()
if encoder == 'h264_nvenc':
    cmd.extend([
        '-c:v', 'h264_nvenc',
        '-preset', params['preset'],  # p1 (fastest) to p7 (slowest)
        '-rc', params['rc'],          # vbr, cbr, cqp
        '-cq', params['cq'],          # quality (0-51, lower=better)
        '-b:v', '0',                  # Let CQ control quality
    ])
else:
    cmd.extend([
        '-c:v', 'libx264',
        '-preset', params['preset'],
        '-crf', params['crf'],
    ])
```

**Functions to update**:
- [ ] `concatenate_with_cut()` (Line 172-188)
- [ ] `concatenate_with_fade()` (Line 268-280)
- [ ] `concatenate_with_dissolve()` (Line 352-364)
- [ ] `extract_clip()` (Line 403-445)

---

#### Task 2.3: Update Video Encoder for GPU Encoding
**File**: `src/backend/app/ai_upscaler/video_encoder.py`

**Current** (Lines 519-528):
```python
if export_mode == 'fast':
    codec = 'libx264'
    preset = 'ultrafast'
    crf = '20'
else:
    codec = 'libx264'
    preset = 'fast'
    crf = '18'
```

**New**:
```python
encoder, params = get_best_encoder()

if encoder == 'h264_nvenc':
    codec = 'h264_nvenc'
    if export_mode == 'fast':
        preset = 'p1'  # Fastest NVENC preset
        cq = '23'
    else:
        preset = 'p4'  # Balanced quality/speed
        cq = '19'
    encoding_params = ['-preset', preset, '-rc', 'vbr', '-cq', cq, '-b:v', '0']
else:
    codec = 'libx264'
    if export_mode == 'fast':
        preset = 'ultrafast'
        crf = '20'
    else:
        preset = 'fast'
        crf = '18'
    encoding_params = ['-preset', preset, '-crf', crf]
```

**Checklist**:
- [ ] Update Pass 1 command (Lines 560-650)
- [ ] Update Pass 2 command (Lines 652-804)
- [ ] Handle NVENC-specific parameters
- [ ] Add fallback to CPU if GPU encoding fails

---

#### Task 2.4: Add GPU Encoding Configuration
**File**: `src/backend/app/config.py` (or create)

```python
class EncodingConfig:
    # Preferred encoder order
    ENCODER_PRIORITY = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264']

    # NVENC settings by quality mode
    NVENC_PRESETS = {
        'fast': {'preset': 'p1', 'cq': '23'},
        'balanced': {'preset': 'p4', 'cq': '19'},
        'quality': {'preset': 'p7', 'cq': '15'}
    }

    # CPU fallback settings
    CPU_PRESETS = {
        'fast': {'preset': 'ultrafast', 'crf': '23'},
        'balanced': {'preset': 'fast', 'crf': '18'},
        'quality': {'preset': 'slow', 'crf': '15'}
    }

    # Force CPU encoding (for debugging)
    FORCE_CPU_ENCODING = False
```

**Checklist**:
- [ ] Create encoding configuration
- [ ] Add environment variable overrides
- [ ] Add logging for encoder selection
- [ ] Add debug mode to force CPU

---

### Phase 3: Export Recovery and Persistence

#### Task 3.1: Backend - Export Status API
**File**: `src/backend/app/routers/exports.py`

```python
@router.get("/active", response_model=List[ExportJobResponse])
async def get_active_exports():
    """Return all currently processing exports."""
    return await get_exports_by_status(['pending', 'processing'])

@router.get("/recent", response_model=List[ExportJobResponse])
async def get_recent_exports(hours: int = 24):
    """Return exports from last N hours."""
    since = datetime.utcnow() - timedelta(hours=hours)
    return await get_exports_since(since)
```

**Checklist**:
- [ ] Add endpoint for active exports
- [ ] Add endpoint for recent exports
- [ ] Include progress data in response
- [ ] Support filtering by project

---

#### Task 3.2: Frontend - Recovery on App Load
**File**: `src/frontend/src/App.jsx` or `src/frontend/src/hooks/useExportRecovery.js`

```javascript
// On app startup
useEffect(() => {
  async function recoverExports() {
    // 1. Check localStorage for known active exports
    const stored = localStorage.getItem('activeExports');

    // 2. Query backend for current status
    const response = await fetch('/api/exports/active');
    const serverExports = await response.json();

    // 3. Reconcile and reconnect WebSockets
    serverExports.forEach(exp => {
      if (exp.status === 'processing') {
        startExport(exp.id, exp.projectId, exp.type);
        exportWSManager.connect(exp.id, callbacks);
      } else if (exp.status === 'complete') {
        // Show completion toast if we didn't know about it
        if (!stored?.includes(exp.id)) {
          showCompletionToast(exp.id);
        }
      }
    });
  }

  recoverExports();
}, []);
```

**Checklist**:
- [ ] Query backend for active exports on startup
- [ ] Reconnect WebSockets for processing exports
- [ ] Show missed completion toasts
- [ ] Sync local state with server state

---

#### Task 3.3: LocalStorage Persistence
**File**: `src/frontend/src/stores/exportStore.js`

```javascript
// Zustand persist middleware
export const useExportStore = create(
  persist(
    (set, get) => ({
      activeExports: new Map(),
      // ... actions
    }),
    {
      name: 'export-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist serializable data
        activeExports: Array.from(state.activeExports.entries())
      }),
      onRehydrate: (state) => {
        // Convert back to Map after rehydration
        if (state?.activeExports) {
          state.activeExports = new Map(state.activeExports);
        }
      }
    }
  )
);
```

**Checklist**:
- [ ] Add Zustand persist middleware
- [ ] Handle Map serialization/deserialization
- [ ] Clear completed exports older than 24h
- [ ] Handle storage quota errors

---

### Phase 4: Parallel Export Support

#### Task 4.1: Backend - Concurrent Job Limits
**File**: `src/backend/app/services/export_worker.py`

```python
# Global semaphore to limit concurrent exports
MAX_CONCURRENT_EXPORTS = 3  # Configurable
export_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXPORTS)

async def process_export_job(job_id: str):
    async with export_semaphore:
        # Existing processing logic
        ...
```

**Checklist**:
- [ ] Add semaphore for concurrent job limiting
- [ ] Make limit configurable via environment
- [ ] Add queue position to progress updates
- [ ] Handle job prioritization (optional)

---

#### Task 4.2: Backend - GPU Memory Management
**File**: `src/backend/app/ai_upscaler/model_manager.py`

```python
class GPUMemoryManager:
    """Manage GPU memory across concurrent exports."""

    def __init__(self, max_concurrent_gpu_jobs=2):
        self.semaphore = asyncio.Semaphore(max_concurrent_gpu_jobs)
        self.active_jobs = {}

    async def acquire(self, job_id: str, estimated_vram_mb: int):
        """Acquire GPU resources for a job."""
        await self.semaphore.acquire()
        self.active_jobs[job_id] = estimated_vram_mb

    def release(self, job_id: str):
        """Release GPU resources."""
        if job_id in self.active_jobs:
            del self.active_jobs[job_id]
            self.semaphore.release()
            torch.cuda.empty_cache()
```

**Checklist**:
- [ ] Create GPU memory manager
- [ ] Limit concurrent GPU jobs (default: 2)
- [ ] Track VRAM usage per job
- [ ] Clean up GPU memory between jobs
- [ ] Handle OOM errors gracefully

---

#### Task 4.3: Frontend - Multiple Export UI
**File**: `src/frontend/src/components/ExportButton.jsx`

```jsx
// Show warning if export already running for this project
const existingExport = getExportsByProject(projectId)
  .find(e => e.status === 'processing');

if (existingExport) {
  return (
    <div className="text-yellow-500">
      Export already in progress ({existingExport.progress}%)
    </div>
  );
}

// Show queue position if waiting
const queuePosition = getQueuePosition(exportId);
if (queuePosition > 0) {
  return (
    <div>Queued (position {queuePosition})</div>
  );
}
```

**Checklist**:
- [ ] Prevent duplicate exports for same project
- [ ] Show queue position when waiting
- [ ] Allow cancellation from any screen
- [ ] Show all active exports in header

---

### Phase 5: Testing and Monitoring

#### Task 5.1: Add Export Metrics
**File**: `src/backend/app/services/export_metrics.py` (NEW)

```python
class ExportMetrics:
    exports_started = Counter('exports_started_total', 'Total exports started')
    exports_completed = Counter('exports_completed_total', 'Total exports completed')
    exports_failed = Counter('exports_failed_total', 'Total exports failed')
    export_duration = Histogram('export_duration_seconds', 'Export duration')
    gpu_encoding_used = Counter('gpu_encoding_used_total', 'GPU encoding used')
```

**Checklist**:
- [ ] Add export start/complete/fail counters
- [ ] Add duration histogram
- [ ] Track encoder usage (GPU vs CPU)
- [ ] Add memory usage tracking
- [ ] Create health check endpoint

---

#### Task 5.2: Frontend Error Handling
**File**: `src/frontend/src/hooks/useExportManager.js`

```javascript
const handleExportError = (exportId, error) => {
  failExport(exportId, error);

  // Show error toast
  toast.error(`Export failed: ${error.message}`, {
    duration: 10000,
    action: {
      label: 'Retry',
      onClick: () => retryExport(exportId)
    }
  });

  // Log for debugging
  console.error('[ExportManager] Export failed:', exportId, error);
};
```

**Checklist**:
- [ ] Add error toast with retry option
- [ ] Add error logging
- [ ] Add retry mechanism
- [ ] Handle WebSocket reconnection errors
- [ ] Handle network offline scenarios

---

## File Reference Summary

### Frontend Files to Modify
| File | Changes |
|------|---------|
| `stores/exportStore.js` | Add activeExports Map, CRUD actions, persistence |
| `components/ExportButton.jsx` | Remove WebSocket, use global manager |
| `screens/ProjectsScreen.jsx` | Remove duplicate WebSocket, use global manager |
| `App.jsx` | Add GlobalExportIndicator, recovery logic |

### Frontend Files to Create
| File | Purpose |
|------|---------|
| `services/ExportWebSocketManager.js` | Singleton WebSocket manager |
| `hooks/useExportManager.js` | React hook for export lifecycle |
| `hooks/useExportRecovery.js` | Recovery on app startup |
| `components/GlobalExportIndicator.jsx` | Header indicator for running exports |

### Backend Files to Modify
| File | Changes |
|------|---------|
| `services/ffmpeg_service.py` | Add GPU encoder detection and usage |
| `ai_upscaler/video_encoder.py` | Update to use GPU encoding |
| `services/export_worker.py` | Add concurrency limits |
| `routers/exports.py` | Add active/recent exports endpoints |

### Backend Files to Create
| File | Purpose |
|------|---------|
| `config.py` | Encoding configuration |
| `services/gpu_memory_manager.py` | GPU memory management |
| `services/export_metrics.py` | Metrics and monitoring |

---

## Testing Checklist

### Scenario 1: Single Export with Navigation
- [ ] Start export on Project A
- [ ] Navigate to Projects list
- [ ] Verify progress still visible
- [ ] Navigate back to Project A
- [ ] Verify progress continues from where it was
- [ ] Wait for completion
- [ ] Verify toast appears
- [ ] Verify project marked as complete

### Scenario 2: Multiple Concurrent Exports
- [ ] Start export on Project A
- [ ] Start export on Project B
- [ ] Verify both progress bars update independently
- [ ] Verify GPU memory doesn't OOM
- [ ] Complete both exports
- [ ] Verify both toasts appear
- [ ] Verify both projects marked complete

### Scenario 3: Page Refresh During Export
- [ ] Start export
- [ ] Refresh page (F5)
- [ ] Verify export recovers
- [ ] Verify progress reconnects
- [ ] Complete export
- [ ] Verify completion works

### Scenario 4: Network Interruption
- [ ] Start export
- [ ] Disconnect network briefly
- [ ] Reconnect network
- [ ] Verify WebSocket reconnects
- [ ] Verify progress resumes
- [ ] Complete export

---

## Priority Order

1. **Phase 1** (Tasks 1.1-1.5) - Fix navigation issues - **HIGH**
2. ~~**Phase 2** (Tasks 2.1-2.4) - GPU encoding~~ - **COMPLETED**
3. **Phase 3** (Tasks 3.1-3.3) - Recovery/persistence - **MEDIUM**
4. **Phase 1.6** - Global indicator - **MEDIUM**
5. **Phase 4** (Tasks 4.1-4.3) - Parallel support - **MEDIUM**
6. **Phase 5** (Tasks 5.1-5.2) - Testing/monitoring - **LOW**

---

## Completed: Phase 2 - GPU Encoding (2024-01-16)

GPU-accelerated video encoding has been implemented across all export paths:

### Files Modified:
- `src/backend/app/services/ffmpeg_service.py` - Added GPU encoder detection and helper functions
- `src/backend/app/ai_upscaler/video_encoder.py` - Updated to use GPU encoding
- `src/backend/app/services/export_worker.py` - Updated overlay export encoding
- `src/backend/app/routers/annotate.py` - Updated annotate export encoding
- `src/backend/app/routers/export/overlay.py` - Updated overlay route encoding
- `src/backend/app/routers/export/before_after.py` - Updated before/after encoding

### New Functions in ffmpeg_service.py:
- `get_available_encoders()` - Detects available hardware encoders (cached)
- `get_best_encoder(prefer_quality)` - Returns best encoder with optimal settings
- `build_video_encoding_params(encoder, params)` - Builds FFmpeg command params
- `get_encoding_command_parts(prefer_quality)` - Convenience function for encoding params

### Encoder Priority:
1. NVIDIA NVENC (h264_nvenc) - Fastest
2. Intel QuickSync (h264_qsv) - Fast
3. AMD AMF (h264_amf) - Fast
4. CPU fallback (libx264) - Always available

### Expected Speedup:
- GPU encoding: 5-10x faster than CPU
- Frees CPU for UI responsiveness during exports

---

## Notes

- NVENC requires NVIDIA GPU with driver support
- Intel QuickSync requires Intel CPU with iGPU
- AMD AMF requires AMD GPU
- Fallback to CPU (libx264) always available
- GPU encoding is ~5-10x faster than CPU for H.264
- Max 2-3 concurrent GPU encodes recommended to avoid VRAM issues
