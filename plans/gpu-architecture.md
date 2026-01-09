# GPU Architecture Plan

## Overview

This document outlines the future architecture for GPU-accelerated processing in ReelBallers, supporting both WebGPU (client-side) and RunPod (cloud fallback).

## Current State

All GPU workloads currently run on the local backend server:
- `src/backend/app/` - Python FastAPI with PyTorch/ONNX for AI models
- Uses CUDA when available, falls back to CPU

## Target Architecture

### Frontend (WebGPU)
For users with WebGPU-capable browsers/hardware:

```
src/frontend/
├── src/
│   ├── gpu/
│   │   ├── webgpu-detector.ts    # Detect WebGPU capability
│   │   ├── shader-manager.ts     # Load and compile shaders
│   │   ├── upscaler.ts           # WebGPU super-resolution
│   │   └── tracker.ts            # WebGPU player detection
│   └── workers/
│       └── gpu-worker.ts         # Off-main-thread processing
```

### Backend Split
Separate API logic from GPU processing:

```
src/backend/
├── api/                          # FastAPI REST/WebSocket
│   ├── main.py
│   ├── routes/
│   │   ├── projects.py
│   │   ├── export.py
│   │   └── tracking.py
│   └── services/
│       └── job_manager.py        # Queue GPU jobs
│
├── gpu/                          # GPU processing module
│   ├── __init__.py
│   ├── base.py                   # Abstract GPU processor
│   ├── local.py                  # Local CUDA/CPU
│   ├── runpod.py                 # RunPod client
│   └── models/
│       ├── upscaler.py
│       └── tracker.py
│
└── shared/                       # Shared utilities
    ├── config.py
    └── types.py
```

### RunPod Integration
Cloud GPU fallback for users without WebGPU:

```
deploy/
├── cloudflare/                   # Main app (existing)
└── runpod/
    ├── handler.py                # RunPod serverless handler
    ├── requirements.txt
    └── Dockerfile
```

## Processing Flow

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND                               │
│                                                               │
│  ┌─────────────┐    ┌─────────────────────────────────────┐  │
│  │   WebGPU    │    │         GPU Worker (Web)            │  │
│  │  Available? │───►│  - Real-time preview upscaling      │  │
│  └─────────────┘    │  - Lightweight tracking inference   │  │
│        │ No         └─────────────────────────────────────┘  │
│        ▼                                                      │
│  ┌─────────────┐                                             │
│  │  Fallback   │                                             │
│  │  to Cloud   │                                             │
│  └─────────────┘                                             │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│                        BACKEND API                            │
│                                                               │
│  ┌─────────────┐    ┌─────────────────────────────────────┐  │
│  │  Job Queue  │───►│         GPU Router                  │  │
│  └─────────────┘    │                                     │  │
│                     │  ┌───────────┐    ┌──────────────┐  │  │
│                     │  │  Local    │    │   RunPod     │  │  │
│                     │  │  CUDA     │    │  Serverless  │  │  │
│                     │  └───────────┘    └──────────────┘  │  │
│                     └─────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## WebGPU Capability Detection

```typescript
async function detectGPUCapability(): Promise<GPUCapability> {
  // Check WebGPU support
  if (!navigator.gpu) {
    return { type: 'none', fallback: 'runpod' };
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { type: 'none', fallback: 'runpod' };
  }

  const info = await adapter.requestAdapterInfo();
  const limits = adapter.limits;

  // Check if GPU is powerful enough for our workloads
  const isHighEnd = limits.maxBufferSize >= 1024 * 1024 * 256; // 256MB

  return {
    type: isHighEnd ? 'webgpu-full' : 'webgpu-limited',
    vendor: info.vendor,
    fallback: isHighEnd ? null : 'runpod-heavy'
  };
}
```

## RunPod Serverless Handler

```python
# deploy/runpod/handler.py
import runpod

def handler(event):
    """
    RunPod serverless handler for GPU workloads.

    Input:
      - task: 'upscale' | 'track' | 'export'
      - input_url: S3/R2 URL to input file
      - params: Task-specific parameters

    Output:
      - output_url: S3/R2 URL to result
      - metadata: Processing stats
    """
    task = event['input']['task']

    if task == 'upscale':
        return upscale_handler(event)
    elif task == 'track':
        return track_handler(event)
    elif task == 'export':
        return export_handler(event)

    return {'error': f'Unknown task: {task}'}

runpod.serverless.start({'handler': handler})
```

## Migration Path

### Phase 1: Backend Split (Low Risk)
1. Refactor `src/backend/app/` into `api/` and `gpu/` modules
2. Keep all functionality identical, just better organized
3. Add abstract GPU processor interface

### Phase 2: RunPod Integration (Medium Risk)
1. Create RunPod serverless endpoint
2. Add RunPod client to backend
3. Implement job routing (local vs cloud)
4. Add R2 storage for file transfers

### Phase 3: WebGPU (Higher Risk)
1. Research ONNX.js / Transformers.js for model inference
2. Implement WebGPU upscaler for preview (lower quality, faster)
3. Keep full-quality processing on backend/RunPod
4. Add capability detection and graceful fallback

## Key Decisions

1. **Preview vs Export Quality**
   - WebGPU: Fast preview (2x upscale, simpler models)
   - RunPod/Local: Full quality export (4x upscale, best models)

2. **Model Format**
   - WebGPU: ONNX models via onnxruntime-web
   - RunPod: PyTorch models (same as current)

3. **File Transfer**
   - Use Cloudflare R2 as intermediary storage
   - Presigned URLs for secure uploads/downloads

4. **Cost Management**
   - WebGPU: Free (client hardware)
   - RunPod: Pay per second, ~$0.00025/sec for A40
   - Strategy: Use WebGPU when possible, RunPod for heavy lifts

## Folder Structure (Tomorrow)

```
video-editor/
├── src/
│   ├── frontend/           # React app (unchanged)
│   │   └── src/
│   │       └── gpu/        # NEW: WebGPU modules
│   │
│   ├── backend/
│   │   ├── api/            # NEW: FastAPI routes/services
│   │   ├── gpu/            # NEW: GPU processing abstraction
│   │   └── shared/         # NEW: Shared code
│   │
│   └── landing/            # Landing page (separate deploy)
│
├── deploy/
│   ├── cloudflare/         # Main app deployment
│   └── runpod/             # NEW: Serverless GPU functions
│
└── plans/
    ├── tasks.md
    └── gpu-architecture.md # This file
```
