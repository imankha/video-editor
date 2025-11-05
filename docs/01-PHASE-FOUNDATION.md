# Phase 1: Foundation

**Core Concept**: Basic video playback with solid architecture  
**Risk Level**: LOW - Uses standard HTML5 video APIs  
**Dependencies**: None

---

## Objective

Build a minimal but robust video player that establishes core architectural patterns. This phase focuses on reliability and code quality that later phases will build upon.

---

## Features

### Video Loading
- Drag and drop video file onto application
- Click to browse file system
- Support formats: MP4, MOV, WebM
- File validation and error messaging
- Display video metadata (duration, resolution, framerate)

### Video Player
- HTML5 video element
- Play/pause toggle
- Current time display (HH:MM:SS.mmm format)
- Total duration display
- Video container maintains aspect ratio
- Black background for letterboxing

### Timeline Scrubber
- Horizontal timeline bar
- Click to jump to position
- Drag playhead to scrub
- Shows current position vs total duration
- Frame-accurate seeking (seek to exact frame boundaries)
- Hover preview (shows time on hover)

### Playback Controls
- Play/pause button
- Current time / Duration display
- Frame step forward/backward (←/→ arrows)
- Jump to start/end
- Volume control (optional, can use browser controls)

---

## User Interface

```
┌─────────────────────────────────────────────────────────┐
│  Video Editor                            [File Menu]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                                                         │
│                    Video Display                        │
│                   (16:9 container)                      │
│                                                         │
│                 [Drop video file here]                  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ────────────────────█──────────────────────          │
│   0:00                ↑                     5:00        │
│                    Playhead                             │
│                                                         │
│   [▶] [⏮] [⏭]    00:02:30 / 00:05:00                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Technical Architecture

### Component Structure

```
src/
├── App.jsx                 # Root component
├── components/
│   ├── VideoPlayer.jsx     # Video element + controls
│   ├── Timeline.jsx        # Timeline with playhead
│   ├── FileDropZone.jsx    # Drag-drop handler
│   └── Controls.jsx        # Playback controls
├── hooks/
│   ├── useVideo.js         # Video state management
│   └── useTimeline.js      # Timeline interaction
├── utils/
│   ├── timeFormat.js       # Time formatting utilities
│   ├── videoUtils.js       # Video metadata extraction
│   └── fileValidation.js   # File type checking
└── styles/
    └── app.css             # Application styles
```

### State Management

```javascript
// Core application state
const AppState = {
  // Video file
  video: {
    file: File | null,
    url: string | null,
    loaded: boolean,
    metadata: {
      duration: number,      // Total duration in seconds
      width: number,
      height: number,
      framerate: number,
      format: string
    }
  },
  
  // Playback state
  playback: {
    playing: boolean,
    currentTime: number,     // Current position in seconds
    seeking: boolean,        // Currently seeking/scrubbing
    volume: number,          // 0-1
    playbackRate: number     // Always 1.0 for Phase 1
  },
  
  // UI state
  ui: {
    timelineWidth: number,   // Timeline width in pixels
    dragging: boolean,       // Currently dragging playhead
    hoverTime: number | null // Time at mouse hover position
  }
}
```

### Core Algorithms

#### Frame-Accurate Seeking
```javascript
/**
 * Seek to exact frame boundary
 * @param targetTime - Desired time in seconds
 * @param framerate - Video framerate (fps)
 * @returns Exact frame time
 */
function seekToFrame(targetTime, framerate) {
  const frameDuration = 1 / framerate;
  const frameNumber = Math.round(targetTime / frameDuration);
  return frameNumber * frameDuration;
}
```

#### Time to Pixel Conversion
```javascript
/**
 * Convert timeline time to pixel position
 * @param time - Time in seconds
 * @param duration - Total video duration
 * @param timelineWidth - Timeline width in pixels
 */
function timeToPixel(time, duration, timelineWidth) {
  return (time / duration) * timelineWidth;
}

/**
 * Convert pixel position to timeline time
 */
function pixelToTime(pixel, duration, timelineWidth) {
  const time = (pixel / timelineWidth) * duration;
  return Math.max(0, Math.min(duration, time));
}
```

#### Time Formatting
```javascript
/**
 * Format seconds to HH:MM:SS.mmm
 * @param seconds - Time in seconds
 * @returns Formatted string
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');
  
  return `${hh}:${mm}:${ss}.${mmm}`;
}
```

---

## Data Models

### VideoFile
```typescript
interface VideoFile {
  file: File;
  url: string;              // Blob URL for video element
  metadata: VideoMetadata;
}

interface VideoMetadata {
  duration: number;         // Total duration in seconds
  width: number;            // Video width in pixels
  height: number;           // Video height in pixels
  framerate: number;        // Frames per second
  format: string;           // File format (mp4, mov, webm)
  aspectRatio: number;      // width/height
}
```

### PlaybackState
```typescript
interface PlaybackState {
  playing: boolean;
  currentTime: number;
  seeking: boolean;
  volume: number;
  playbackRate: number;
}
```

---

## API Contracts

### Video Loading
```javascript
/**
 * Load video file and extract metadata
 * @param file - Video file from drag-drop or file input
 * @returns Promise resolving to VideoFile object
 * @throws Error if file is invalid or unsupported
 */
async function loadVideo(file: File): Promise<VideoFile>
```

### Playback Control
```javascript
/**
 * Play video from current position
 */
function play(): void

/**
 * Pause video playback
 */
function pause(): void

/**
 * Seek to specific time
 * @param time - Target time in seconds
 * @param frameAccurate - Snap to nearest frame boundary
 */
function seek(time: number, frameAccurate: boolean = true): void

/**
 * Step forward one frame
 */
function stepForward(): void

/**
 * Step backward one frame
 */
function stepBackward(): void
```

### Timeline Interaction
```javascript
/**
 * Handle timeline click/drag
 * @param pixelX - X coordinate relative to timeline
 * @returns Target time
 */
function handleTimelineClick(pixelX: number): number

/**
 * Start timeline drag
 */
function startTimelineDrag(): void

/**
 * Update during timeline drag
 * @param pixelX - Current X coordinate
 */
function updateTimelineDrag(pixelX: number): void

/**
 * End timeline drag
 */
function endTimelineDrag(): void
```

---

## Implementation Requirements

### File Handling
- Accept files via drag-drop and file input
- Validate file type: .mp4, .mov, .webm
- Maximum file size: 4GB
- Extract metadata using video element's metadata event
- Create revokable blob URL for video source
- Display clear error messages for invalid files

### Video Element Setup
```javascript
<video
  ref={videoRef}
  src={videoUrl}
  onLoadedMetadata={handleMetadataLoaded}
  onTimeUpdate={handleTimeUpdate}
  onPlay={handlePlay}
  onPause={handlePause}
  onSeeking={handleSeeking}
  onSeeked={handleSeeked}
  preload="metadata"
/>
```

### Timeline Rendering
- Use canvas for timeline rendering (performance)
- Or use styled div with absolute positioned playhead
- Update playhead position at 30fps during playback
- Smooth scrubbing during drag (no lag)
- Hover shows time tooltip

### Frame-Accurate Seeking
- Calculate frame boundaries based on framerate
- Round seek time to nearest frame
- Use `video.currentTime = exactFrameTime`
- Verify frame accuracy with frame counter

---

## Error Handling

### File Errors
```javascript
class VideoLoadError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Error codes:
// UNSUPPORTED_FORMAT: File format not supported
// FILE_TOO_LARGE: File exceeds size limit
// CORRUPT_FILE: File cannot be decoded
// LOAD_TIMEOUT: Loading took too long
```

### Display error messages:
- "This file format is not supported. Please use MP4, MOV, or WebM."
- "File is too large. Maximum size is 4GB."
- "Unable to load video. File may be corrupt."
- "Loading timed out. Please try again."

---

## Testing Requirements

### Functional Tests
- [ ] Load MP4 file via drag-drop
- [ ] Load MOV file via file browser
- [ ] Reject unsupported file formats (.avi, .mkv)
- [ ] Reject files over 4GB
- [ ] Extract correct metadata (duration, dimensions)
- [ ] Play/pause toggles correctly
- [ ] Playhead moves during playback
- [ ] Timeline click jumps to position
- [ ] Timeline drag scrubs video
- [ ] Frame step forward works
- [ ] Frame step backward works
- [ ] Seeking is frame-accurate
- [ ] Time displays update correctly

### Performance Tests
- [ ] Load 100MB video in < 2 seconds
- [ ] Playback maintains 30fps
- [ ] Scrubbing is smooth (no lag)
- [ ] Timeline updates at 30fps during playback
- [ ] Memory usage stays reasonable (< 500MB)

### Edge Cases
- [ ] Load 1-second video
- [ ] Load 2-hour video
- [ ] Scrub rapidly back and forth
- [ ] Seek near start (0.0s)
- [ ] Seek near end (duration - 0.1s)
- [ ] Play/pause repeatedly
- [ ] Load multiple videos in sequence

---

## Acceptance Criteria

### Must Have
✅ User can load video by dropping file  
✅ User can load video by browsing files  
✅ Video plays smoothly with no stuttering  
✅ Timeline scrubber responds instantly  
✅ Seeking is accurate to the frame  
✅ Time displays are formatted correctly  
✅ All controls work as expected  

### Should Have
✅ Loading shows progress indicator  
✅ Hover on timeline shows time tooltip  
✅ Error messages are clear and helpful  
✅ Video maintains aspect ratio  

### Nice to Have
- Frame counter display (shows current frame number)
- Thumbnail preview on timeline hover
- Remember last video loaded

---

## Development Guidelines for AI

### Code Organization
- Use React functional components with hooks
- Keep components small and focused (< 200 lines)
- Separate business logic into custom hooks
- Use TypeScript for type safety (or JSDoc if JavaScript)
- Extract utilities into pure functions

### State Management
- Use React useState for local component state
- Use useContext for sharing video state across components
- Avoid unnecessary re-renders (use useMemo, useCallback)
- Keep state updates atomic

### Performance
- Debounce timeline updates during scrubbing
- Use requestAnimationFrame for playhead animation
- Lazy load video (don't load until file selected)
- Clean up blob URLs when component unmounts

### Code Style
- Use clear, descriptive variable names
- Comment complex calculations
- Include JSDoc for all functions
- Follow consistent formatting (Prettier)

### Testing Approach
- Write tests for utility functions
- Test state updates with React Testing Library
- Mock video element for unit tests
- Use Playwright for E2E tests

---

## Phase Completion Checklist

- [ ] All components implemented
- [ ] All tests passing
- [ ] No console errors or warnings
- [ ] Performance targets met
- [ ] Code reviewed and refactored
- [ ] Documentation complete
- [ ] Ready for Phase 2 (Crop Keyframes)

---

## Next Phase Preview

Phase 2 will add:
- Crop overlay on video display
- Keyframe creation on timeline
- Crop keyframe track
- Interpolation between crop positions
- This is the HIGH RISK phase - the foundation must be solid

---

## Notes for Claude Code

When implementing this phase:
1. Start with basic video loading and display
2. Add playback controls
3. Implement timeline scrubber
4. Add frame-accurate seeking last
5. Test thoroughly before moving to Phase 2
6. Ensure video element events work correctly
7. Verify blob URL cleanup to prevent memory leaks
