# WebGPU Local Processing - Hybrid Modal Fallback

## Overview

Implement client-side GPU processing using WebGPU/WebGL for capable machines, with automatic fallback to Modal cloud processing when local hardware is insufficient. This reduces Modal costs while maintaining universal compatibility.

**Priority**: Future optimization (after Modal migration complete)
**Complexity**: High (new frontend architecture, capability detection, multiple code paths)

---

## Processing Strategy Matrix

| Task | WebGPU Candidate | Fallback | Notes |
|------|------------------|----------|-------|
| **Overlay Effects** | Yes | Modal | Simple per-pixel shaders, WebGL fallback available |
| **YOLO Detection** | Yes (Tier 1-2 machines) | Modal | ONNX.js with WebGPU backend |
| **Real-ESRGAN Upscaling** | **No - Always Modal** | N/A | Too memory intensive (~4GB VRAM needed) |
| **Clip Extraction** | No | FFmpeg on server | Codec operations, not GPU-bound |
| **Video Concatenation** | No | FFmpeg on server | Codec operations, not GPU-bound |

---

## Machine Capability Tiers

### Tier 1: Full Local Processing
- **Hardware**: Gaming PCs, M1/M2/M3 Macs, RTX 3060+
- **VRAM**: 6GB+ dedicated or 8GB+ unified
- **WebGPU**: Full support
- **Capabilities**: Overlay + YOLO locally
- **~15% of users**

### Tier 2: Partial Local Processing
- **Hardware**: Modern laptops, Intel Iris Xe, AMD Radeon integrated
- **VRAM**: 2-4GB shared
- **WebGPU**: Supported but limited
- **Capabilities**: Overlay locally, YOLO on Modal
- **~40% of users**

### Tier 3: Modal Only
- **Hardware**: Older machines, Chromebooks, low-end devices
- **VRAM**: <2GB or no WebGPU
- **Capabilities**: All processing on Modal
- **~45% of users**

---

## Implementation Plan

### Phase 1: Capability Detection Service

**File**: `src/frontend/src/services/gpuCapabilities.js`

```javascript
/**
 * GPU Capability Detection Service
 *
 * Detects local machine capabilities and determines optimal
 * processing strategy for each task type.
 */

// Capability levels
export const ProcessingTier = {
  FULL_LOCAL: 'full_local',      // Tier 1: All local
  PARTIAL_LOCAL: 'partial_local', // Tier 2: Overlay local, YOLO Modal
  MODAL_ONLY: 'modal_only',       // Tier 3: Everything Modal
};

// Task-specific capability flags
export const TaskCapability = {
  OVERLAY: 'overlay',
  YOLO_DETECTION: 'yolo_detection',
  // Real-ESRGAN always Modal - not included
};

class GPUCapabilityService {
  constructor() {
    this.capabilities = null;
    this.tier = null;
    this.initialized = false;
  }

  /**
   * Initialize capability detection (call once on app load)
   */
  async initialize() {
    if (this.initialized) return this.capabilities;

    this.capabilities = {
      webgpu: false,
      webgl2: false,
      estimatedVRAM: 0,
      gpuRenderer: 'unknown',
      supportsOverlay: false,
      supportsYOLO: false,
    };

    // Detect WebGPU
    if ('gpu' in navigator) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.capabilities.webgpu = true;

          // Estimate VRAM from adapter limits
          const limits = adapter.limits;
          // maxBufferSize gives us a rough VRAM estimate
          this.capabilities.estimatedVRAM =
            Math.round(limits.maxBufferSize / (1024 * 1024 * 1024) * 10) / 10;

          // Get GPU info
          const info = await adapter.requestAdapterInfo();
          this.capabilities.gpuRenderer = info.description || info.device || 'WebGPU Device';
        }
      } catch (e) {
        console.warn('WebGPU detection failed:', e);
      }
    }

    // Detect WebGL 2 (fallback for overlays)
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      this.capabilities.webgl2 = true;

      // Get GPU info from WebGL if not from WebGPU
      if (this.capabilities.gpuRenderer === 'unknown') {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          this.capabilities.gpuRenderer =
            gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    }

    // Determine task capabilities
    this._determineCapabilities();

    // Determine overall tier
    this._determineTier();

    this.initialized = true;

    console.log('[GPU] Capabilities detected:', this.capabilities);
    console.log('[GPU] Processing tier:', this.tier);

    return this.capabilities;
  }

  _determineCapabilities() {
    // Overlay: WebGPU preferred, WebGL2 fallback acceptable
    this.capabilities.supportsOverlay =
      this.capabilities.webgpu || this.capabilities.webgl2;

    // YOLO: Needs WebGPU with decent VRAM (2GB+)
    this.capabilities.supportsYOLO =
      this.capabilities.webgpu && this.capabilities.estimatedVRAM >= 2;

    // Check for known problematic GPUs
    const renderer = this.capabilities.gpuRenderer.toLowerCase();

    // Intel HD 4000 and older - disable YOLO
    if (renderer.includes('intel') && renderer.includes('hd')) {
      const match = renderer.match(/hd\s*(\d+)/);
      if (match && parseInt(match[1]) < 5000) {
        this.capabilities.supportsYOLO = false;
      }
    }

    // Mobile GPUs - be conservative with YOLO
    if (renderer.includes('mali') || renderer.includes('adreno')) {
      this.capabilities.supportsYOLO = false;
    }
  }

  _determineTier() {
    if (this.capabilities.supportsOverlay && this.capabilities.supportsYOLO) {
      this.tier = ProcessingTier.FULL_LOCAL;
    } else if (this.capabilities.supportsOverlay) {
      this.tier = ProcessingTier.PARTIAL_LOCAL;
    } else {
      this.tier = ProcessingTier.MODAL_ONLY;
    }
  }

  /**
   * Get recommended processing location for a task
   */
  getProcessingLocation(task) {
    if (!this.initialized) {
      console.warn('[GPU] Not initialized, defaulting to Modal');
      return 'modal';
    }

    switch (task) {
      case TaskCapability.OVERLAY:
        return this.capabilities.supportsOverlay ? 'local' : 'modal';

      case TaskCapability.YOLO_DETECTION:
        return this.capabilities.supportsYOLO ? 'local' : 'modal';

      default:
        return 'modal';
    }
  }

  /**
   * Get full capability report for debugging/analytics
   */
  getReport() {
    return {
      ...this.capabilities,
      tier: this.tier,
      recommendations: {
        overlay: this.getProcessingLocation(TaskCapability.OVERLAY),
        yolo: this.getProcessingLocation(TaskCapability.YOLO_DETECTION),
        realesrgan: 'modal', // Always Modal
      }
    };
  }
}

// Singleton instance
export const gpuCapabilities = new GPUCapabilityService();

// Initialize on import (non-blocking)
gpuCapabilities.initialize().catch(console.error);
```

### Phase 2: WebGPU Overlay Renderer

**File**: `src/frontend/src/services/webgpu/overlayRenderer.js`

```javascript
/**
 * WebGPU-based overlay renderer for highlight effects
 *
 * Renders the same effects as Modal's render_overlay but on local GPU.
 * Falls back to WebGL2 if WebGPU unavailable.
 */

import { gpuCapabilities } from '../gpuCapabilities';

class OverlayRenderer {
  constructor() {
    this.device = null;
    this.pipeline = null;
    this.initialized = false;
    this.backend = null; // 'webgpu' | 'webgl2'
  }

  async initialize() {
    if (this.initialized) return true;

    // Try WebGPU first
    if (gpuCapabilities.capabilities?.webgpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter.requestDevice();
        this.backend = 'webgpu';
        await this._createWebGPUPipeline();
        this.initialized = true;
        console.log('[OverlayRenderer] Initialized with WebGPU');
        return true;
      } catch (e) {
        console.warn('[OverlayRenderer] WebGPU init failed:', e);
      }
    }

    // Fall back to WebGL2
    if (gpuCapabilities.capabilities?.webgl2) {
      try {
        this.backend = 'webgl2';
        await this._createWebGLContext();
        this.initialized = true;
        console.log('[OverlayRenderer] Initialized with WebGL2');
        return true;
      } catch (e) {
        console.warn('[OverlayRenderer] WebGL2 init failed:', e);
      }
    }

    return false;
  }

  async _createWebGPUPipeline() {
    // WGSL shader for highlight overlay effect
    const shaderCode = `
      struct Uniforms {
        highlightCenter: vec2<f32>,
        highlightRadii: vec2<f32>,
        opacity: f32,
        effectType: u32, // 0: original, 1: dark_overlay, 2: brightness_boost
      }

      @group(0) @binding(0) var inputTexture: texture_2d<f32>;
      @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
      @group(0) @binding(2) var<uniform> uniforms: Uniforms;

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let dims = textureDimensions(inputTexture);
        if (id.x >= dims.x || id.y >= dims.y) {
          return;
        }

        let uv = vec2<f32>(f32(id.x) / f32(dims.x), f32(id.y) / f32(dims.y));
        var color = textureLoad(inputTexture, vec2<i32>(id.xy), 0);

        // Calculate ellipse distance
        let normalizedPos = (uv - uniforms.highlightCenter) / uniforms.highlightRadii;
        let dist = length(normalizedPos);

        // Inside highlight: keep original
        // Outside highlight: apply effect
        if (dist > 1.0) {
          let factor = smoothstep(1.0, 1.5, dist) * uniforms.opacity;

          if (uniforms.effectType == 1u) {
            // Dark overlay
            color = vec4<f32>(color.rgb * (1.0 - factor * 0.7), color.a);
          } else if (uniforms.effectType == 2u) {
            // Brightness boost (highlight inside instead)
            // Invert logic for this effect
          }
        }

        textureStore(outputTexture, vec2<i32>(id.xy), color);
      }
    `;

    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.pipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
  }

  async _createWebGLContext() {
    // WebGL2 fallback implementation
    // Uses fragment shaders for similar effect
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl2');

    // Create shader program for overlay effect
    // ... WebGL2 shader implementation
  }

  /**
   * Process a video frame with highlight overlay
   *
   * @param {ImageBitmap|HTMLVideoElement} source - Source frame
   * @param {Object} highlight - {centerX, centerY, radiusX, radiusY, opacity}
   * @param {string} effectType - 'original' | 'dark_overlay' | 'brightness_boost'
   * @returns {ImageBitmap} Processed frame
   */
  async processFrame(source, highlight, effectType) {
    if (!this.initialized) {
      throw new Error('OverlayRenderer not initialized');
    }

    if (this.backend === 'webgpu') {
      return this._processFrameWebGPU(source, highlight, effectType);
    } else {
      return this._processFrameWebGL(source, highlight, effectType);
    }
  }

  async _processFrameWebGPU(source, highlight, effectType) {
    // Implementation using WebGPU compute shader
    // ...
  }

  async _processFrameWebGL(source, highlight, effectType) {
    // Implementation using WebGL2 fragment shader
    // ...
  }

  /**
   * Process entire video with overlays
   * Reports progress via callback
   */
  async processVideo(videoUrl, highlights, effectType, onProgress) {
    // 1. Load video into memory
    // 2. Process frame by frame using canvas + GPU
    // 3. Encode output using MediaRecorder or ffmpeg.wasm
    // 4. Return blob URL
  }
}

export const overlayRenderer = new OverlayRenderer();
```

### Phase 3: Browser YOLO Detection

**File**: `src/frontend/src/services/webgpu/yoloDetector.js`

```javascript
/**
 * Browser-based YOLO detection using ONNX Runtime Web
 *
 * Uses WebGPU for inference when available, falls back to WASM.
 */

import * as ort from 'onnxruntime-web';
import { gpuCapabilities } from '../gpuCapabilities';

class YOLODetector {
  constructor() {
    this.session = null;
    this.initialized = false;
    this.modelUrl = '/models/yolov8n.onnx'; // Nano model for browser
  }

  async initialize() {
    if (this.initialized) return true;

    // Configure ONNX Runtime
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

    // Use WebGPU if available, otherwise WASM
    const executionProviders = [];
    if (gpuCapabilities.capabilities?.webgpu) {
      executionProviders.push('webgpu');
    }
    executionProviders.push('wasm'); // Fallback

    try {
      // Check if model exists, download if needed
      const modelExists = await this._checkModelExists();
      if (!modelExists) {
        console.log('[YOLO] Downloading model...');
        await this._downloadModel();
      }

      this.session = await ort.InferenceSession.create(
        this.modelUrl,
        { executionProviders }
      );

      this.initialized = true;
      console.log('[YOLO] Initialized with providers:', executionProviders);
      return true;
    } catch (e) {
      console.error('[YOLO] Initialization failed:', e);
      return false;
    }
  }

  async _checkModelExists() {
    try {
      const response = await fetch(this.modelUrl, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async _downloadModel() {
    // Download from CDN or backend
    const response = await fetch('/api/models/yolov8n');
    const blob = await response.blob();
    // Cache in IndexedDB for future use
    // ...
  }

  /**
   * Detect players in a video frame
   *
   * @param {ImageBitmap|HTMLCanvasElement} frame - Input frame
   * @param {number} confidenceThreshold - Min confidence (0-1)
   * @returns {Array<Detection>} Array of detections
   */
  async detect(frame, confidenceThreshold = 0.5) {
    if (!this.initialized) {
      throw new Error('YOLO not initialized');
    }

    // Preprocess: resize to 640x640, normalize
    const tensor = await this._preprocess(frame);

    // Run inference
    const outputs = await this.session.run({ images: tensor });

    // Postprocess: NMS, filter by confidence
    const detections = this._postprocess(
      outputs.output0.data,
      frame.width,
      frame.height,
      confidenceThreshold
    );

    return detections;
  }

  async _preprocess(frame) {
    // Resize to 640x640
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(frame, 0, 0, 640, 640);

    // Get pixel data and normalize
    const imageData = ctx.getImageData(0, 0, 640, 640);
    const { data } = imageData;

    // Convert to float32 tensor [1, 3, 640, 640]
    const float32Data = new Float32Array(1 * 3 * 640 * 640);
    for (let i = 0; i < 640 * 640; i++) {
      float32Data[i] = data[i * 4] / 255.0;                    // R
      float32Data[i + 640 * 640] = data[i * 4 + 1] / 255.0;    // G
      float32Data[i + 2 * 640 * 640] = data[i * 4 + 2] / 255.0; // B
    }

    return new ort.Tensor('float32', float32Data, [1, 3, 640, 640]);
  }

  _postprocess(output, originalWidth, originalHeight, threshold) {
    // YOLOv8 output processing
    // Apply NMS, filter by confidence, scale to original dimensions
    const detections = [];

    // ... NMS and filtering logic

    return detections.filter(d => d.confidence >= threshold);
  }
}

export const yoloDetector = new YOLODetector();
```

### Phase 4: Processing Strategy Hook

**File**: `src/frontend/src/hooks/useProcessingStrategy.js`

```javascript
/**
 * React hook for determining and using appropriate processing strategy
 */

import { useState, useEffect, useCallback } from 'react';
import { gpuCapabilities, TaskCapability } from '../services/gpuCapabilities';
import { overlayRenderer } from '../services/webgpu/overlayRenderer';
import { yoloDetector } from '../services/webgpu/yoloDetector';

export function useProcessingStrategy() {
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      await gpuCapabilities.initialize();
      setCapabilities(gpuCapabilities.getReport());
      setLoading(false);
    }
    init();
  }, []);

  /**
   * Process overlay - uses local GPU if capable, else Modal
   */
  const processOverlay = useCallback(async (
    projectId,
    videoUrl,
    highlights,
    effectType,
    onProgress
  ) => {
    const location = gpuCapabilities.getProcessingLocation(TaskCapability.OVERLAY);

    if (location === 'local') {
      try {
        await overlayRenderer.initialize();
        const result = await overlayRenderer.processVideo(
          videoUrl,
          highlights,
          effectType,
          onProgress
        );
        return { success: true, local: true, result };
      } catch (e) {
        console.warn('[Strategy] Local overlay failed, falling back to Modal:', e);
        // Fall through to Modal
      }
    }

    // Use Modal
    const response = await fetch('/api/export/render-overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, effect_type: effectType }),
    });

    return { success: response.ok, local: false, result: await response.json() };
  }, []);

  /**
   * Detect players - uses local GPU if capable, else Modal
   */
  const detectPlayers = useCallback(async (projectId, frameNumber, threshold) => {
    const location = gpuCapabilities.getProcessingLocation(TaskCapability.YOLO_DETECTION);

    if (location === 'local') {
      try {
        await yoloDetector.initialize();

        // Get frame from video
        const frame = await extractFrame(projectId, frameNumber);
        const detections = await yoloDetector.detect(frame, threshold);

        return { success: true, local: true, detections };
      } catch (e) {
        console.warn('[Strategy] Local YOLO failed, falling back to Modal:', e);
        // Fall through to Modal
      }
    }

    // Use Modal
    const response = await fetch('/api/detect/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        frame_number: frameNumber,
        confidence_threshold: threshold,
      }),
    });

    const data = await response.json();
    return { success: response.ok, local: false, detections: data.detections };
  }, []);

  return {
    capabilities,
    loading,
    processOverlay,
    detectPlayers,
    // Real-ESRGAN always uses Modal - no local option
  };
}
```

### Phase 5: Update Existing Components

Modify overlay export to use the new strategy:

```javascript
// In OverlayMode.jsx or similar

import { useProcessingStrategy } from '../hooks/useProcessingStrategy';

function OverlayExport({ projectId, highlights, effectType }) {
  const { processOverlay, capabilities } = useProcessingStrategy();
  const [processing, setProcessing] = useState(false);

  const handleExport = async () => {
    setProcessing(true);

    const result = await processOverlay(
      projectId,
      workingVideoUrl,
      highlights,
      effectType,
      (progress) => setExportProgress(progress)
    );

    if (result.success) {
      if (result.local) {
        console.log('Processed locally - saved Modal costs!');
      }
      // Handle success
    }

    setProcessing(false);
  };

  return (
    <div>
      {capabilities && (
        <div className="text-xs text-gray-500">
          Processing: {capabilities.recommendations.overlay === 'local'
            ? 'Local GPU'
            : 'Cloud GPU'}
        </div>
      )}
      <button onClick={handleExport} disabled={processing}>
        Export
      </button>
    </div>
  );
}
```

---

## Video Encoding Challenge

Browser-based video processing has a significant challenge: **video encoding**.

### Options:

1. **MediaRecorder API**
   - Pros: Native, no dependencies
   - Cons: Limited codec support, variable quality

2. **ffmpeg.wasm**
   - Pros: Full FFmpeg capabilities
   - Cons: Large download (~25MB), slower than native

3. **WebCodecs API** (Emerging)
   - Pros: Hardware-accelerated encoding
   - Cons: Limited browser support (Chrome only)

### Recommendation:

For overlay processing, use **hybrid approach**:
1. Process frames locally with WebGPU
2. Send processed frames to backend for FFmpeg encoding
3. Or use WebCodecs where available

```javascript
// Hybrid encoding approach
async function encodeVideoHybrid(frames, fps) {
  // Try WebCodecs first (Chrome 94+)
  if ('VideoEncoder' in window) {
    return encodeWithWebCodecs(frames, fps);
  }

  // Fall back to sending frames to server
  return encodeOnServer(frames, fps);
}
```

---

## Analytics & Monitoring

Track processing location for cost analysis:

```javascript
// Log processing decisions
function logProcessingEvent(task, location, duration, success) {
  fetch('/api/analytics/processing', {
    method: 'POST',
    body: JSON.stringify({
      task,              // 'overlay' | 'yolo'
      location,          // 'local' | 'modal'
      duration_ms: duration,
      success,
      gpu_info: gpuCapabilities.capabilities?.gpuRenderer,
      tier: gpuCapabilities.tier,
    }),
  });
}
```

Backend aggregation for cost savings calculation:

```sql
-- Example query for cost analysis
SELECT
  DATE(created_at) as date,
  task,
  SUM(CASE WHEN location = 'local' THEN 1 ELSE 0 END) as local_count,
  SUM(CASE WHEN location = 'modal' THEN 1 ELSE 0 END) as modal_count,
  SUM(CASE WHEN location = 'local' THEN duration_ms ELSE 0 END) as local_ms,
  SUM(CASE WHEN location = 'modal' THEN duration_ms ELSE 0 END) as modal_ms
FROM processing_events
GROUP BY DATE(created_at), task;
```

---

## Testing Considerations

### Unit Tests
- Capability detection across different GPU scenarios
- Shader correctness (compare output to Modal)
- YOLO accuracy vs server-side

### Browser Testing
- Chrome (WebGPU + WebGL2)
- Firefox (WebGL2 only, WebGPU behind flag)
- Safari (WebGPU in Safari 17+)
- Mobile browsers (limited support)

### Performance Benchmarks
- Frame processing time: local vs Modal
- Memory usage during processing
- Battery impact on laptops

### Fallback Testing
- Verify Modal fallback works when local fails
- Test graceful degradation path
- Simulate GPU memory exhaustion

---

## Files to Create/Modify

| File | Type | Description |
|------|------|-------------|
| `services/gpuCapabilities.js` | New | Capability detection singleton |
| `services/webgpu/overlayRenderer.js` | New | WebGPU overlay processor |
| `services/webgpu/yoloDetector.js` | New | ONNX.js YOLO wrapper |
| `hooks/useProcessingStrategy.js` | New | React hook for strategy selection |
| `components/OverlayExport.jsx` | Modify | Use processing strategy |
| `components/PlayerDetection.jsx` | Modify | Use processing strategy |
| `public/models/yolov8n.onnx` | New | YOLOv8 nano model (~6MB) |

---

## Estimated Effort

| Phase | Effort | Notes |
|-------|--------|-------|
| Capability Detection | 4-6 hours | Relatively straightforward |
| WebGPU Overlay Renderer | 8-12 hours | Shader development, testing |
| WebGL2 Fallback | 4-6 hours | Simpler shaders |
| YOLO Browser Integration | 6-8 hours | ONNX.js integration |
| Strategy Hook & Integration | 4-6 hours | React integration |
| Testing & Debugging | 8-12 hours | Cross-browser, edge cases |
| **Total** | **34-50 hours** | |

---

## Dependencies

```json
{
  "dependencies": {
    "onnxruntime-web": "^1.17.0"
  }
}
```

Model files:
- `yolov8n.onnx` (~6MB) - Nano model for browser
- Hosted on CDN or bundled with app

---

## Rollback Plan

WebGPU processing is additive - Modal path always exists as fallback:

1. If capability detection fails → use Modal
2. If local processing fails → use Modal
3. If results differ significantly → use Modal
4. Feature flag to disable entirely if needed

```javascript
// Feature flag
const ENABLE_LOCAL_GPU = process.env.REACT_APP_ENABLE_LOCAL_GPU === 'true';

if (!ENABLE_LOCAL_GPU) {
  // Force Modal for all tasks
  gpuCapabilities.tier = ProcessingTier.MODAL_ONLY;
}
```

---

## Cost Savings Estimate

Assuming:
- 15% Tier 1 users (full local)
- 40% Tier 2 users (overlay local)
- 45% Tier 3 users (all Modal)

**Overlay processing:**
- Current: 100% Modal
- After: 55% local, 45% Modal
- **Savings: ~55% on overlay Modal costs**

**YOLO detection:**
- Current: 100% Modal
- After: 15% local, 85% Modal
- **Savings: ~15% on detection Modal costs**

**Real-ESRGAN:**
- No change (always Modal)

---

## Notes

1. **Progressive Enhancement**: Start with Tier 1 support only, expand to Tier 2 after validation

2. **Model Caching**: Cache YOLO model in IndexedDB to avoid repeated downloads

3. **User Opt-out**: Consider letting users prefer Modal if local processing causes issues

4. **Mobile Strategy**: Disable local processing on mobile (battery concerns, limited VRAM)

5. **Future**: WebCodecs API will make browser video encoding much more viable
