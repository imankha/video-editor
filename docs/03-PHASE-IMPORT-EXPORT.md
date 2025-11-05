# Phase 3: Import/Export

**Core Concept**: Complete file I/O system with crop rendering  
**Risk Level**: MEDIUM - FFmpeg integration complexity  
**Dependencies**: Phase 1 (Foundation), Phase 2 (Crop Keyframes)  
**MVP Status**: ESSENTIAL

---

## Objective

Implement robust import and export functionality. This phase validates the entire system: users can import videos, apply crop effects, and export the final rendered video with crops applied.

**Why Front-loaded After Crop**: Export is essential for MVP and validates that the crop system actually works end-to-end.

---

## Features

### Enhanced Import
- Drag & drop multiple video files
- File browser with multi-select
- Format support: MP4, MOV, WebM, AVI
- Metadata extraction and display
- Thumbnail generation
- Error handling with specific messages
- File validation before loading

### Export System
- Export dialog with comprehensive settings
- Format selection (MP4, WebM, MOV)
- Quality presets (Fast, Balanced, High Quality, Custom)
- Resolution options (Original, 1080p, 720p, 480p)
- Framerate options (Original, 30fps, 60fps)
- Codec selection (H.264, H.265, VP9)
- Audio settings (codec, bitrate, sample rate)
- Hardware acceleration toggle
- Estimated file size and time

### Export Process
- Background processing (non-blocking UI)
- Real-time progress tracking
- Frame-by-frame crop rendering
- Cancel export mid-process
- Pause/resume capability
- Export queue (multiple jobs)
- Completion notification

### Export Preview
- Quick preview before export
- Scrub through final output
- Verify crop effects
- Check for issues

---

## User Interface

### Export Dialog

```
┌─ Export Video ──────────────────────────────────────┐
│                                                      │
│  File Settings                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ Filename: edited_video_[date]                  │ │
│  │ Location: ~/Videos/                    [Browse] │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Format & Quality                                   │
│  ┌────────────────────────────────────────────────┐ │
│  │ Format:     [MP4 (H.264)            ▼]         │ │
│  │                                                 │ │
│  │ Preset:                                        │ │
│  │   ○ Fast Export (Lower quality, ~2x speed)    │ │
│  │   ● Balanced (Recommended, ~1x speed)         │ │
│  │   ○ High Quality (Best quality, ~0.5x speed)  │ │
│  │   ○ Custom                                    │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Video Settings                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ Resolution: [1920x1080 (Original)    ▼]       │ │
│  │ Frame Rate: [30 fps (Original)       ▼]       │ │
│  │ Codec:      [H.264                   ▼]       │ │
│  │ Bitrate:    [8000] kbps                       │ │
│  │                                                 │ │
│  │ □ Apply crop effects                          │ │
│  │ □ Hardware acceleration (Recommended)         │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Audio Settings                                     │
│  ┌────────────────────────────────────────────────┐ │
│  │ Codec:      [AAC                     ▼]       │ │
│  │ Bitrate:    [192] kbps                        │ │
│  │ Sample Rate:[48000 Hz                ▼]       │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Estimate                                           │
│  ┌────────────────────────────────────────────────┐ │
│  │ File Size: ~450 MB                             │ │
│  │ Export Time: ~2 minutes (estimated)            │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  [Preview] [Cancel]               [Start Export]    │
└──────────────────────────────────────────────────────┘
```

### Export Progress

```
┌─ Exporting Video ────────────────────────────────────┐
│                                                       │
│  edited_video_20251029.mp4                           │
│                                                       │
│  Stage: Encoding video with crop effects            │
│                                                       │
│  ████████████████████████░░░░░░░░░  68%             │
│                                                       │
│  Frame: 2040 / 3000                                  │
│  Time Elapsed: 00:01:23                              │
│  Time Remaining: ~00:00:40                           │
│  Speed: 0.95x realtime                               │
│                                                       │
│  Current FPS: 28.5                                   │
│  Average FPS: 24.2                                   │
│                                                       │
│  [Pause]  [Cancel]                                   │
└───────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Component Structure

```
src/
├── components/
│   ├── ImportDialog.jsx         # NEW: Enhanced file import
│   ├── ExportDialog.jsx         # NEW: Export settings
│   ├── ExportProgress.jsx       # NEW: Progress tracking
│   ├── ExportPreview.jsx        # NEW: Preview before export
│   └── FileMetadata.jsx         # NEW: Display file info
├── services/
│   ├── ffmpegService.js         # NEW: FFmpeg integration
│   ├── exportService.js         # NEW: Export orchestration
│   ├── cropRenderer.js          # NEW: Apply crops during export
│   └── videoEncoder.js          # NEW: Video encoding
├── workers/
│   └── exportWorker.js          # NEW: Background export processing
├── utils/
│   ├── fileValidation.js        # Enhanced from Phase 1
│   ├── metadataExtractor.js     # NEW: Video metadata
│   └── estimateExport.js        # NEW: Size/time estimation
└── types/
    └── export.ts                # NEW: Export type definitions
```

### Export State Management

```javascript
const ExportState = {
  // Export configuration
  exportConfig: {
    filename: string,
    outputPath: string,
    format: 'mp4' | 'webm' | 'mov',
    preset: 'fast' | 'balanced' | 'high' | 'custom',
    
    // Video settings
    video: {
      resolution: {width: number, height: number} | 'original',
      framerate: number | 'original',
      codec: 'h264' | 'h265' | 'vp9',
      bitrate: number,  // in kbps
      applyCrop: boolean,
      hardwareAccel: boolean
    },
    
    // Audio settings
    audio: {
      codec: 'aac' | 'opus' | 'mp3',
      bitrate: number,
      sampleRate: number
    }
  },
  
  // Export progress
  exportProgress: {
    active: boolean,
    paused: boolean,
    stage: 'preparing' | 'encoding' | 'finalizing' | 'complete' | 'error',
    
    progress: {
      current: number,      // Current frame
      total: number,        // Total frames
      percentage: number,   // 0-100
      fps: number,          // Current encoding FPS
      averageFps: number,   // Average FPS
      timeElapsed: number,  // Seconds elapsed
      timeRemaining: number // Estimated seconds remaining
    },
    
    result: {
      success: boolean,
      outputFile: string | null,
      fileSize: number | null,
      error: string | null
    }
  },
  
  // Export queue
  exportQueue: {
    jobs: ExportJob[],
    currentJob: string | null
  }
}
```

---

## Data Models

### ExportConfig
```typescript
interface ExportConfig {
  filename: string;
  outputPath: string;
  format: 'mp4' | 'webm' | 'mov';
  preset: 'fast' | 'balanced' | 'high' | 'custom';
  
  video: {
    resolution: {width: number, height: number} | 'original';
    framerate: number | 'original';
    codec: 'h264' | 'h265' | 'vp9';
    bitrate: number;
    applyCrop: boolean;
    hardwareAccel: boolean;
  };
  
  audio: {
    codec: 'aac' | 'opus' | 'mp3';
    bitrate: number;
    sampleRate: number;
  };
}
```

### ExportJob
```typescript
interface ExportJob {
  id: string;
  config: ExportConfig;
  videoFile: File;
  cropKeyframes: Keyframe[];
  status: 'queued' | 'processing' | 'complete' | 'failed';
  progress: ExportProgress;
  createdAt: Date;
  completedAt: Date | null;
}
```

### VideoMetadata
```typescript
interface VideoMetadata {
  filename: string;
  size: number;              // Bytes
  duration: number;          // Seconds
  width: number;
  height: number;
  framerate: number;
  aspectRatio: number;
  format: string;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  hasAudio: boolean;
}
```

---

## Core Algorithms

### 1. Export Processing Pipeline

```javascript
/**
 * Main export pipeline
 * @param videoFile - Source video file
 * @param cropKeyframes - Array of crop keyframes
 * @param config - Export configuration
 */
async function exportVideo(videoFile, cropKeyframes, config) {
  // Stage 1: Prepare
  updateProgress('preparing', 0);
  
  // Create temporary working directory
  const workDir = await createTempDir();
  
  // Extract frames if crop needs to be applied
  let frames = [];
  if (config.video.applyCrop && cropKeyframes.length > 0) {
    frames = await extractFrames(videoFile, workDir);
    updateProgress('preparing', 50);
  }
  
  // Stage 2: Apply crop to frames
  if (config.video.applyCrop && frames.length > 0) {
    updateProgress('encoding', 0);
    
    const croppedFrames = await Promise.all(
      frames.map(async (frame, index) => {
        const time = index / config.video.framerate;
        const crop = getCropAtTime(cropKeyframes, time);
        
        if (crop) {
          return await applyCropToFrame(frame, crop);
        }
        return frame;
      })
    );
    
    // Update progress as frames are processed
    for (let i = 0; i < frames.length; i++) {
      const percentage = (i / frames.length) * 80; // 0-80%
      updateProgress('encoding', percentage);
    }
  }
  
  // Stage 3: Encode final video
  updateProgress('encoding', 80);
  
  const outputFile = await encodeVideo({
    frames: croppedFrames.length > 0 ? croppedFrames : null,
    sourceVideo: croppedFrames.length === 0 ? videoFile : null,
    config: config,
    onProgress: (percentage) => {
      // Scale to 80-100% range
      updateProgress('encoding', 80 + percentage * 0.2);
    }
  });
  
  // Stage 4: Finalize
  updateProgress('finalizing', 95);
  
  // Clean up temporary files
  await cleanupTempDir(workDir);
  
  updateProgress('complete', 100);
  
  return {
    success: true,
    outputFile: outputFile,
    fileSize: await getFileSize(outputFile)
  };
}
```

### 2. Frame-by-Frame Crop Application

```javascript
/**
 * Apply crop to a single frame
 * @param frame - Image data
 * @param crop - Crop rectangle
 * @returns Cropped frame
 */
async function applyCropToFrame(frame, crop) {
  // Create canvas for crop operation
  const canvas = createCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d');
  
  // Draw cropped region
  ctx.drawImage(
    frame,
    crop.x,         // Source X
    crop.y,         // Source Y
    crop.width,     // Source width
    crop.height,    // Source height
    0,              // Dest X
    0,              // Dest Y
    crop.width,     // Dest width
    crop.height     // Dest height
  );
  
  return canvas;
}
```

### 3. FFmpeg Integration

```javascript
/**
 * Encode video using FFmpeg
 * @param options - Encoding options
 */
async function encodeWithFFmpeg(options) {
  const {
    inputPath,
    outputPath,
    format,
    videoCodec,
    videoBitrate,
    audioCodec,
    audioBitrate,
    resolution,
    framerate,
    hardwareAccel,
    onProgress
  } = options;
  
  // Build FFmpeg command
  let command = [
    '-i', inputPath,
  ];
  
  // Hardware acceleration
  if (hardwareAccel) {
    command.push('-hwaccel', 'auto');
  }
  
  // Video settings
  command.push(
    '-c:v', videoCodec,
    '-b:v', `${videoBitrate}k`
  );
  
  if (resolution !== 'original') {
    command.push('-s', `${resolution.width}x${resolution.height}`);
  }
  
  if (framerate !== 'original') {
    command.push('-r', framerate);
  }
  
  // Audio settings
  command.push(
    '-c:a', audioCodec,
    '-b:a', `${audioBitrate}k`
  );
  
  // Output
  command.push('-y', outputPath);
  
  // Execute FFmpeg
  return await runFFmpeg(command, onProgress);
}
```

### 4. Export Estimation

```javascript
/**
 * Estimate export file size and time
 * @param metadata - Video metadata
 * @param config - Export configuration
 */
function estimateExport(metadata, config) {
  // Estimate file size (rough calculation)
  const videoBitrate = config.video.bitrate * 1000; // Convert to bps
  const audioBitrate = config.audio.bitrate * 1000;
  const totalBitrate = videoBitrate + audioBitrate;
  
  const estimatedSize = (totalBitrate * metadata.duration) / 8; // Bytes
  
  // Estimate encoding time
  // Baseline: 1x realtime for balanced preset
  let speedMultiplier = 1.0;
  
  switch(config.preset) {
    case 'fast':
      speedMultiplier = 2.0;  // 2x faster
      break;
    case 'balanced':
      speedMultiplier = 1.0;
      break;
    case 'high':
      speedMultiplier = 0.5;  // 2x slower
      break;
  }
  
  // Crop processing adds overhead
  if (config.video.applyCrop) {
    speedMultiplier *= 0.7;  // 30% slower
  }
  
  // Hardware accel speeds up
  if (config.video.hardwareAccel) {
    speedMultiplier *= 1.5;  // 50% faster
  }
  
  const estimatedTime = metadata.duration / speedMultiplier;
  
  return {
    fileSize: Math.round(estimatedSize),
    timeSeconds: Math.round(estimatedTime),
    speedMultiplier: speedMultiplier
  };
}
```

---

## API Contracts

### Import Operations
```typescript
/**
 * Import video file
 */
async function importVideo(file: File): Promise<VideoFile>

/**
 * Import multiple videos
 */
async function importVideos(files: File[]): Promise<VideoFile[]>

/**
 * Extract video metadata
 */
async function extractMetadata(file: File): Promise<VideoMetadata>

/**
 * Generate video thumbnail
 */
async function generateThumbnail(
  file: File, 
  timeSeconds: number
): Promise<Blob>
```

### Export Operations
```typescript
/**
 * Start export with configuration
 */
async function startExport(config: ExportConfig): Promise<ExportJob>

/**
 * Pause active export
 */
function pauseExport(jobId: string): void

/**
 * Resume paused export
 */
function resumeExport(jobId: string): void

/**
 * Cancel export
 */
function cancelExport(jobId: string): void

/**
 * Get export progress
 */
function getExportProgress(jobId: string): ExportProgress

/**
 * Add job to export queue
 */
function queueExport(config: ExportConfig): string

/**
 * Estimate export metrics
 */
function estimateExport(
  metadata: VideoMetadata, 
  config: ExportConfig
): ExportEstimate
```

---

## Implementation Requirements

### FFmpeg Setup
- Use FFmpeg.wasm for in-browser encoding
- Or use electron with native FFmpeg
- Configure FFmpeg paths and options
- Handle FFmpeg errors gracefully
- Stream output for progress tracking

### Crop Rendering
- Extract video frames to temporary directory
- Apply crop to each frame using Canvas API
- Scale crop coordinates to output resolution
- Preserve frame timing and order
- Handle frame extraction errors

### Background Processing
- Use Web Workers for export processing
- Don't block main UI thread
- Allow UI interaction during export
- Update progress at reasonable intervals (every 100ms)
- Handle worker errors and cleanup

### File Management
- Create temporary directories for processing
- Clean up temporary files after export
- Handle disk space errors
- Validate output file before completion
- Support resume after interruption

### Progress Tracking
- Calculate accurate frame count
- Update progress smoothly (not too frequent)
- Estimate time remaining based on current speed
- Track FPS (frames per second encoding rate)
- Show detailed stage information

---

## Testing Requirements

### Import Tests
- [ ] Import MP4 file
- [ ] Import MOV file
- [ ] Import WebM file
- [ ] Import multiple files simultaneously
- [ ] Reject unsupported formats
- [ ] Extract metadata correctly
- [ ] Generate thumbnails
- [ ] Handle corrupt files
- [ ] Handle very large files (>4GB)

### Export Tests
- [ ] Export without crop (simple re-encode)
- [ ] Export with static crop
- [ ] Export with animated crop (2+ keyframes)
- [ ] Export with different formats (MP4, WebM)
- [ ] Export with different presets
- [ ] Export with custom settings
- [ ] Hardware acceleration works
- [ ] Progress tracking is accurate
- [ ] Cancel export mid-process
- [ ] Pause and resume export
- [ ] Multiple exports in queue

### Integration Tests
- [ ] Full workflow: import → crop → export
- [ ] Export matches preview exactly
- [ ] Crop effects render correctly
- [ ] Audio is preserved
- [ ] Frame timing is accurate
- [ ] No dropped frames
- [ ] Output file is playable
- [ ] Output file size matches estimate (±20%)

### Performance Tests
- [ ] Export 1-minute video in < 2 minutes
- [ ] Export 10-minute video without crashing
- [ ] Handle 4K video export
- [ ] Memory usage stays reasonable (< 2GB)
- [ ] CPU usage is efficient
- [ ] Hardware accel provides speedup

---

## Acceptance Criteria

### Must Have
✅ User can import video files  
✅ User can export video with crops applied  
✅ Export progress shows accurately  
✅ Output video matches preview  
✅ Multiple formats supported  
✅ Hardware acceleration works  
✅ Can cancel export  

### Should Have
✅ Estimate file size and time  
✅ Quality presets work  
✅ Custom settings available  
✅ Export queue functional  
✅ Pause/resume works  

### Nice to Have
- Export preview before starting
- Batch export multiple videos
- Export profiles (save presets)
- Export history

---

## Development Guidelines for AI

### Implementation Order
1. Set up FFmpeg integration
2. Implement basic export (no crop)
3. Add crop rendering to export
4. Implement progress tracking
5. Add export dialog UI
6. Add export configuration
7. Implement pause/resume
8. Add export queue
9. Test end-to-end
10. Optimize performance

### Critical Code Sections

**FFmpeg Worker**:
```javascript
// exportWorker.js
import { createFFmpeg } from '@ffmpeg/ffmpeg';

const ffmpeg = createFFmpeg({
  log: true,
  progress: ({ ratio }) => {
    self.postMessage({
      type: 'progress',
      progress: ratio * 100
    });
  }
});

self.onmessage = async (e) => {
  const { type, data } = e.data;
  
  if (type === 'export') {
    try {
      await ffmpeg.load();
      
      // Write input file
      ffmpeg.FS('writeFile', 'input.mp4', data.inputFile);
      
      // Run FFmpeg command
      await ffmpeg.run(...data.command);
      
      // Read output file
      const outputData = ffmpeg.FS('readFile', 'output.mp4');
      
      self.postMessage({
        type: 'complete',
        data: outputData
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: error.message
      });
    }
  }
};
```

**Crop Application**:
```javascript
async function exportWithCrop(videoFile, keyframes, config) {
  const video = document.createElement('video');
  video.src = URL.createObjectURL(videoFile);
  
  await video.load();
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const frames = [];
  const frameDuration = 1 / config.video.framerate;
  
  for (let time = 0; time < video.duration; time += frameDuration) {
    // Seek to frame
    video.currentTime = time;
    await new Promise(resolve => video.onseeked = resolve);
    
    // Get crop for this time
    const crop = getCropAtTime(keyframes, time, 'ease');
    
    // Set canvas size to crop dimensions
    canvas.width = crop.width;
    canvas.height = crop.height;
    
    // Draw cropped frame
    ctx.drawImage(
      video,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, crop.width, crop.height
    );
    
    // Convert to image
    const frameBlob = await new Promise(resolve => 
      canvas.toBlob(resolve, 'image/png')
    );
    
    frames.push(frameBlob);
  }
  
  return frames;
}
```

### Performance Optimization
- Use hardware acceleration when available
- Process frames in batches
- Stream data instead of loading all in memory
- Use efficient image formats (PNG for lossless)
- Parallelize crop application (use multiple workers)
- Cache intermediate results

---

## Phase Completion Checklist

- [ ] FFmpeg integration working
- [ ] Can export without crop
- [ ] Can export with crop
- [ ] Progress tracking accurate
- [ ] Multiple formats supported
- [ ] Export dialog functional
- [ ] All tests passing
- [ ] Performance acceptable
- [ ] Ready for Phase 4 (Speed Controls)

---

## Next Phase Preview

Phase 4 will add:
- Speed control regions
- Variable playback speed
- Speed effects in export

---

## Notes for Claude Code

Critical considerations:
1. FFmpeg.wasm has size limitations (~2GB)
2. Frame extraction can be memory intensive
3. Crop application must be pixel-perfect
4. Progress tracking needs careful calibration
5. Error handling is critical (disk space, memory, codec errors)
6. Clean up temporary files religiously
7. Test on different video formats extensively
8. Hardware acceleration compatibility varies by system
