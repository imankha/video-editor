# Video Editor - Implementation Plan

**Project**: Browser-based Video Editor with Animated Crop & Speed Controls
**Development Approach**: Risk-first, AI-assisted with Claude Code
**Status**: Planning Phase
**Date**: November 5, 2025

---

## Executive Summary

This implementation plan outlines the development of a sophisticated browser-based video editor featuring:

- **Animated Crop Keyframing**: Novel feature allowing different crop sizes/positions at different frames with smooth interpolation
- **Variable Speed Controls**: Region-based playback speed adjustment (0.1x to 10x)
- **Professional Timeline Editing**: Multi-clip support with trim, split, and arrange capabilities
- **FFmpeg Export Pipeline**: Full video rendering with all effects applied

### Strategic Approach

The project uses a **risk-first development strategy**, tackling the most complex and novel features (crop keyframes) first to validate technical feasibility early. This is followed by MVP-essential features (import/export) before moving to deployment phases.

### Development Phases

**Feature Development (Phases 1-5)**:
1. Foundation - Basic video playback & architecture
2. Crop Keyframes - Animated crop system (HIGHEST RISK)
3. Import/Export - File I/O and rendering (MVP ESSENTIAL)
4. Speed Controls - Variable playback speed
5. Timeline Editing - Professional editing features

**Deployment (Phases 6-8)**:
6. Build Pipeline - Automated builds & CI/CD
7. Environment Setup - Multi-environment configuration
8. Cross-Platform - Browser & device testing

---

## Project Analysis

### Strengths of the Specification

1. **Exceptionally Detailed**: Each phase includes exact data models, algorithms, API contracts, and UI mockups
2. **AI-Optimized**: Clear technical requirements minimize ambiguity for AI-assisted development
3. **Risk Management**: Front-loading complex features validates feasibility early
4. **Incremental Validation**: Each phase produces working, testable software
5. **Complete Technical Stack**: All dependencies and tools clearly specified

### Key Technical Challenges

| Challenge | Risk Level | Mitigation Strategy |
|-----------|-----------|---------------------|
| Crop keyframe interpolation between different aspect ratios | HIGH | Build in Phase 2, extensive testing with edge cases |
| FFmpeg.wasm memory limits (~2GB) | MEDIUM | Use efficient frame processing, consider electron fallback |
| Real-time crop preview at 60fps | MEDIUM | Optimize with Canvas API, use requestAnimationFrame |
| Speed region time calculations | MEDIUM | Thorough testing of bidirectional time conversion |
| Multi-clip export coordination | LOW | Build on proven Phase 3 export foundation |

### Architecture Highlights

**Frontend Framework**: React 18+ with functional components and hooks
**Video Processing**: HTML5 Video API + Canvas API + FFmpeg.wasm
**State Management**: React Context + custom hooks
**Build Tool**: Vite
**Language**: JavaScript/TypeScript

---

## Phase-by-Phase Implementation Strategy

## Phase 1: Foundation (Estimated: 2-3 days)

### Objectives
- Establish solid architectural patterns
- Implement reliable video playback
- Build frame-accurate timeline scrubber
- Create core state management structure

### Implementation Priorities
1. **Day 1**: Project setup + video loading
   - Initialize Vite + React project
   - Set up basic component structure
   - Implement file drag-drop and loading
   - Create video player component with HTML5 video element
   - Extract and display video metadata

2. **Day 2**: Playback controls + timeline
   - Implement play/pause functionality
   - Build timeline scrubber with click/drag
   - Add frame-accurate seeking algorithm
   - Create time formatting utilities
   - Build playback control buttons

3. **Day 3**: Polish + testing
   - Add hover preview on timeline
   - Implement error handling for file loading
   - Test with various video formats (MP4, MOV, WebM)
   - Performance testing (smooth 30fps timeline updates)
   - Code review and refactoring

### Success Criteria
- ✅ Load video via drag-drop
- ✅ Play/pause works smoothly
- ✅ Timeline scrubbing is frame-accurate
- ✅ Time displays formatted correctly (HH:MM:SS.mmm)
- ✅ No memory leaks (blob URLs cleaned up)

### Key Deliverables
- Working video player application
- Core state management architecture
- Reusable time conversion utilities
- Foundation for all future phases

---

## Phase 2: Crop Keyframes (Estimated: 5-7 days)

### Objectives
- Implement the highest-risk feature first
- Build animated crop system with keyframe interpolation
- Create intuitive crop overlay with 8 resize handles
- Validate technical feasibility of core value proposition

### Implementation Priorities

**Days 1-2: Crop Overlay Foundation**
- Create CropOverlay component (SVG-based)
- Implement static crop rectangle
- Add 8 resize handles (corners + midpoints)
- Build handle drag logic for one handle
- Extend to all 8 handles
- Add aspect ratio lock functionality

**Days 3-4: Keyframe System**
- Design keyframe data structure
- Create CropTrack component on timeline
- Implement keyframe creation at playhead
- Build keyframe selection/deletion
- Add keyframe dragging to change time
- Create keyframe list in properties panel

**Days 5-6: Interpolation Engine**
- Implement linear interpolation (lerp) algorithm
- Add easing functions (ease-in-out, bezier)
- Build getCropAtTime() interpolation function
- Connect interpolation to playback loop
- Test smooth transitions between different aspect ratios
- Optimize for 60fps updates

**Day 7: Properties Panel + Testing**
- Build numeric inputs for crop dimensions
- Add preset aspect ratios (16:9, 9:16, 1:1, 4:3)
- Create 9-point position grid
- Add interpolation type selector
- Comprehensive testing with edge cases
- Performance optimization

### Critical Algorithms

```javascript
// Keyframe Interpolation (from docs)
function getCropAtTime(keyframes, time, interpolationType) {
  // Find surrounding keyframes
  const before = findKeyframeBefore(keyframes, time);
  const after = findKeyframeAfter(keyframes, time);

  // Calculate progress (0 to 1)
  const progress = (time - before.time) / (after.time - before.time);

  // Apply easing
  const easedProgress = applyEasing(progress, interpolationType);

  // Interpolate all crop properties
  return {
    x: lerp(before.crop.x, after.crop.x, easedProgress),
    y: lerp(before.crop.y, after.crop.y, easedProgress),
    width: lerp(before.crop.width, after.crop.width, easedProgress),
    height: lerp(before.crop.height, after.crop.height, easedProgress)
  };
}
```

### Testing Focus
- Different aspect ratio transitions (16:9 → 9:16 → 1:1)
- Keyframes at video start/end
- Very small crops (50x50px minimum)
- 10+ keyframes performance
- Handle dragging responsiveness

### Success Criteria
- ✅ Create keyframes by clicking timeline
- ✅ Resize crop with all 8 handles smoothly
- ✅ Different crop sizes at different frames interpolate correctly
- ✅ Real-time preview maintains 60fps
- ✅ Aspect ratio lock works correctly
- ✅ Preset positions and ratios function properly

---

## Phase 3: Import/Export (Estimated: 4-6 days)

### Objectives
- Build complete file I/O system
- Integrate FFmpeg for video encoding
- Apply crop effects during export
- Validate entire system end-to-end

### Implementation Priorities

**Days 1-2: FFmpeg Integration**
- Set up FFmpeg.wasm in project
- Create ffmpegService.js
- Test basic video re-encoding (no effects)
- Implement progress tracking
- Build export worker for background processing
- Test with various codecs (H.264, VP9)

**Days 3-4: Crop Rendering Pipeline**
- Implement frame extraction from video
- Create applyCropToFrame() function using Canvas
- Build frame-by-frame crop application loop
- Test interpolation accuracy during export
- Optimize memory usage (process in batches)
- Verify crop coordinates match preview exactly

**Days 5-6: Export UI + Features**
- Build ExportDialog component
- Add format selection (MP4, WebM, MOV)
- Implement quality presets (Fast, Balanced, High)
- Create ExportProgress component with real-time updates
- Add pause/resume/cancel functionality
- Build export queue system
- Add file size/time estimation
- Comprehensive export testing

### Critical Implementation

```javascript
// Crop Application During Export (from docs)
async function exportWithCrop(videoFile, keyframes, config) {
  const frames = [];
  const frameDuration = 1 / config.video.framerate;

  for (let time = 0; time < video.duration; time += frameDuration) {
    // Seek to exact frame
    video.currentTime = time;
    await video.onseeked;

    // Get interpolated crop for this time
    const crop = getCropAtTime(keyframes, time, 'ease');

    // Apply crop using Canvas
    canvas.width = crop.width;
    canvas.height = crop.height;
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height,
                  0, 0, crop.width, crop.height);

    // Convert to frame
    frames.push(await canvas.toBlob());
  }

  return frames;
}
```

### Testing Focus
- Export with no crop (baseline)
- Export with static crop
- Export with 3+ keyframes (animated crop)
- Multiple formats (MP4, WebM)
- Large files (10+ minute videos)
- Cancel mid-export
- Output file playability

### Success Criteria
- ✅ Export produces valid video files
- ✅ Crop effects render pixel-perfect
- ✅ Progress tracking is accurate (±5%)
- ✅ Can cancel/pause/resume exports
- ✅ Hardware acceleration provides speedup
- ✅ File size estimates within ±20%

---

## Phase 4: Speed Controls (Estimated: 3-5 days)

### Objectives
- Add variable playback speed system
- Implement speed regions on timeline
- Build bidirectional time conversion
- Integrate speed effects with export

### Implementation Priorities

**Days 1-2: Speed Region System**
- Create SpeedTrack component
- Implement SpeedRegion rendering
- Build region creation tool
- Add region resize handles
- Implement overlap prevention
- Create speed properties panel

**Days 3-4: Time Conversion & Playback**
- Implement realTimeToPlaybackTime() algorithm
- Build playbackTimeToRealTime() inverse function
- Modify video playback to use video.playbackRate
- Update time displays (real + playback time)
- Test with multiple overlapping regions
- Optimize conversion performance

**Day 5: Export Integration + Testing**
- Integrate speed effects into export pipeline
- Implement frame duplication for slow-mo
- Add frame skipping for fast-forward
- Test speed + crop combination
- Audio pitch preservation (optional)
- Performance testing

### Critical Algorithm

```javascript
// Real Time to Playback Time Conversion (from docs)
function realTimeToPlaybackTime(realTime, regions) {
  let playbackTime = 0;
  let currentTime = 0;

  for (const region of sortedRegions) {
    // Time before region at 1x speed
    if (currentTime < region.startTime) {
      playbackTime += Math.min(realTime, region.startTime) - currentTime;
      currentTime = region.startTime;
    }

    // Time within region at region.speed
    if (realTime >= region.startTime && realTime <= region.endTime) {
      playbackTime += (realTime - region.startTime) * region.speed;
      return playbackTime;
    }

    // Full region duration
    if (realTime > region.endTime) {
      playbackTime += (region.endTime - region.startTime) * region.speed;
      currentTime = region.endTime;
    }
  }

  return playbackTime;
}
```

### Success Criteria
- ✅ Create speed regions easily
- ✅ Playback respects speed changes
- ✅ No region overlaps (auto-snap)
- ✅ Time conversions are accurate
- ✅ Export includes speed effects correctly

---

## Phase 5: Timeline Editing (Estimated: 4-5 days)

### Objectives
- Add professional editing capabilities
- Implement trim functionality
- Build scissors tool for splitting clips
- Support multiple clips on timeline

### Implementation Priorities

**Days 1-2: Multi-Clip Foundation**
- Refactor state for multiple clips
- Create VideoClip component
- Implement clip selection
- Build clip movement with snapping
- Add clip deletion
- Test with 5+ clips

**Days 3-4: Trim & Split**
- Create TrimHandle component
- Implement trim start/end logic
- Build scissors tool
- Implement clip splitting algorithm
- Preserve crop/speed data during split
- Test split with effects

**Day 5: Timeline Controls + Polish**
- Add zoom in/out functionality
- Implement snap-to-grid
- Build fit-all-clips view
- Add grid rendering
- Final integration testing
- Performance optimization

### Critical Algorithm

```javascript
// Clip Splitting (from docs)
function splitClip(clip, splitTime) {
  const sourceTime = clip.trimStart + splitTime;

  const clip1 = {
    ...clip,
    id: generateUniqueId(),
    trimEnd: sourceTime,
    cropKeyframes: clip.cropKeyframes.filter(kf => kf.time < splitTime),
    speedRegions: clip.speedRegions
      .filter(sr => sr.startTime < splitTime)
      .map(sr => ({...sr, endTime: Math.min(sr.endTime, splitTime)}))
  };

  const clip2 = {
    ...clip,
    id: generateUniqueId(),
    startTime: clip.startTime + splitTime,
    trimStart: sourceTime,
    cropKeyframes: clip.cropKeyframes
      .filter(kf => kf.time >= splitTime)
      .map(kf => ({...kf, time: kf.time - splitTime})),
    speedRegions: clip.speedRegions
      .filter(sr => sr.endTime > splitTime)
      .map(sr => ({
        ...sr,
        startTime: Math.max(0, sr.startTime - splitTime),
        endTime: sr.endTime - splitTime
      }))
  };

  return [clip1, clip2];
}
```

### Success Criteria
- ✅ Trim clips with handles
- ✅ Split clips preserving all effects
- ✅ Move and arrange multiple clips
- ✅ Timeline zoom works smoothly
- ✅ Multi-clip export functions correctly

---

## Phase 6-8: Deployment (Estimated: 3-4 days total)

### Phase 6: Build Pipeline (1-2 days)
- Configure Vite for production builds
- Set up minification and optimization
- Implement source maps
- Create build scripts
- Set up basic CI/CD (GitHub Actions)
- Test production bundle

### Phase 7: Environment Setup (1 day)
- Configure development environment
- Set up staging environment
- Create production environment
- Environment-specific configuration
- Deployment scripts

### Phase 8: Cross-Platform (1 day)
- Test on Chrome, Firefox, Safari, Edge
- Mobile device testing
- Performance profiling on different hardware
- Document browser compatibility
- Accessibility testing

---

## Technology Stack & Setup

### Core Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@ffmpeg/ffmpeg": "^0.12.0",
    "@ffmpeg/util": "^0.12.0",
    "uuid": "^9.0.0",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "@types/react": "^18.2.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "playwright": "^1.40.0"
  }
}
```

### Project Structure

```
video-editor/
├── src/
│   ├── components/          # React components
│   │   ├── VideoPlayer.jsx
│   │   ├── Timeline.jsx
│   │   ├── CropOverlay.jsx
│   │   ├── SpeedTrack.jsx
│   │   └── ...
│   ├── hooks/               # Custom React hooks
│   │   ├── useVideo.js
│   │   ├── useCrop.js
│   │   ├── useSpeed.js
│   │   └── ...
│   ├── services/            # Business logic
│   │   ├── ffmpegService.js
│   │   ├── exportService.js
│   │   └── ...
│   ├── utils/               # Pure utility functions
│   │   ├── timeFormat.js
│   │   ├── interpolation.js
│   │   └── ...
│   ├── workers/             # Web Workers
│   │   └── exportWorker.js
│   ├── types/               # TypeScript types
│   │   └── index.ts
│   ├── styles/              # CSS files
│   │   └── app.css
│   ├── App.jsx              # Root component
│   └── main.jsx             # Entry point
├── public/                  # Static assets
├── docs/                    # Project documentation
├── tests/                   # Test files
├── package.json
├── vite.config.js
└── README.md
```

---

## Risk Analysis & Mitigation

### High-Risk Areas

#### 1. Crop Keyframe Interpolation (Phase 2)
**Risk**: Complex math, different aspect ratios, performance
**Mitigation**:
- Build comprehensive test suite for interpolation edge cases
- Test with extreme aspect ratio transitions (16:9 → 9:16)
- Profile and optimize for 60fps updates
- Consider fallback to simpler interpolation if performance issues arise

#### 2. FFmpeg.wasm Memory Limits (Phase 3)
**Risk**: 2GB limit may cause crashes with large videos
**Mitigation**:
- Process frames in smaller batches
- Implement memory monitoring
- Consider Electron + native FFmpeg fallback for large files
- Provide clear error messages for file size limits

#### 3. Real-time Crop Preview Performance (Phase 2)
**Risk**: May not achieve 60fps with complex crops
**Mitigation**:
- Use Canvas API optimizations (hardware acceleration)
- Debounce updates during handle dragging
- Use requestAnimationFrame for smooth rendering
- Profile with Chrome DevTools and optimize hot paths

### Medium-Risk Areas

#### Speed Region Time Calculations (Phase 4)
**Risk**: Bidirectional time conversion bugs
**Mitigation**:
- Extensive unit testing of conversion functions
- Test with multiple overlapping regions
- Verify inverse operations (real→playback→real)

#### Browser Compatibility (Phase 8)
**Risk**: Features may not work on all browsers
**Mitigation**:
- Focus on Chromium-based browsers initially
- Use feature detection for Web APIs
- Document browser requirements clearly

---

## Timeline & Milestones

### Development Timeline (Feature Phases)

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: Foundation | 2-3 days | 3 days |
| Phase 2: Crop Keyframes | 5-7 days | 10 days |
| Phase 3: Import/Export | 4-6 days | 16 days |
| Phase 4: Speed Controls | 3-5 days | 21 days |
| Phase 5: Timeline Editing | 4-5 days | 26 days |

**Feature-Complete Estimate**: 3-4 weeks

### Deployment Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 6: Build Pipeline | 1-2 days | 28 days |
| Phase 7: Environment Setup | 1 day | 29 days |
| Phase 8: Cross-Platform | 1 day | 30 days |

**Production-Ready Estimate**: 4-5 weeks total

### Milestones

- **Week 1**: Phase 1 complete, foundation solid
- **Week 2**: Phase 2 complete, crop keyframes working (MAJOR MILESTONE)
- **Week 3**: Phase 3 complete, MVP functional (can export videos)
- **Week 4**: Phases 4-5 complete, all features implemented
- **Week 5**: Deployment complete, production-ready

---

## Success Metrics

### Technical Metrics

- **Performance**: Timeline updates at 30fps minimum, crop preview at 60fps
- **Export Speed**: 1x realtime for balanced preset
- **Memory Usage**: < 2GB during export for 1080p video
- **Load Time**: Initial app load < 2 seconds
- **Frame Accuracy**: Seeking accurate to ±1 frame

### Functional Metrics

- **Supported Formats**: MP4, MOV, WebM input/output
- **Max Video Length**: 2 hours (with hardware acceleration)
- **Keyframe Limit**: 100+ keyframes without lag
- **Clip Limit**: 20+ clips on timeline
- **Browser Support**: Chrome 90+, Firefox 88+, Safari 15+, Edge 90+

### Quality Metrics

- **Test Coverage**: 80%+ for utility functions
- **Bug Rate**: < 5 critical bugs per phase
- **Export Success Rate**: 95%+ successful exports
- **Crash Rate**: < 1% during normal usage

---

## Development Best Practices

### Code Quality

1. **Use TypeScript** for type safety (or JSDoc for JavaScript)
2. **Write tests** for all utility functions and critical algorithms
3. **Keep components small** (< 200 lines per file)
4. **Extract business logic** into custom hooks and services
5. **Comment complex algorithms** with clear explanations
6. **Follow consistent naming** conventions (PascalCase for components, camelCase for functions)

### Performance

1. **Use React.memo** for expensive components
2. **Memoize calculations** with useMemo
3. **Optimize re-renders** with useCallback
4. **Profile regularly** with React DevTools Profiler
5. **Lazy load** when appropriate
6. **Clean up resources** (event listeners, blob URLs, timers)

### State Management

1. **Single source of truth** in React Context
2. **Atomic state updates** to prevent race conditions
3. **Immutable updates** for predictable state changes
4. **Local state first**, Context only when needed across components

### Testing

1. **Unit tests** for utilities and algorithms
2. **Component tests** with React Testing Library
3. **Integration tests** for critical workflows
4. **E2E tests** with Playwright for export pipeline
5. **Performance tests** for timeline and crop operations

---

## Next Steps & Recommendations

### Immediate Actions (Day 1)

1. **Initialize Project**
   ```bash
   npm create vite@latest video-editor -- --template react
   cd video-editor
   npm install
   npm install uuid date-fns
   npm install -D @types/react vitest @testing-library/react
   ```

2. **Set Up Project Structure**
   - Create folder structure (components, hooks, utils, services, workers, types, styles)
   - Set up basic App.jsx with layout
   - Configure vite.config.js

3. **Begin Phase 1 Implementation**
   - Start with FileDropZone component
   - Implement video loading functionality
   - Set up basic state management with React Context

### Development Workflow

1. **For Each Phase**:
   - Read phase specification thoroughly
   - Implement data models first (TypeScript interfaces)
   - Build components incrementally (simplest first)
   - Test each component in isolation
   - Implement core algorithms
   - Run testing checklist from phase spec
   - Code review and refactor

2. **Daily Routine**:
   - Morning: Review phase spec, plan day's work
   - Development: Implement features following spec order
   - Testing: Test as you build, not at the end
   - Evening: Review progress, update documentation

3. **Git Workflow**:
   - Commit frequently (every feature/component)
   - Use descriptive commit messages
   - Push to remote daily
   - Create PR for each phase completion

### Claude Code Integration

**Effective Prompting**:
- Reference specific sections from phase specs
- Provide context (what's already built)
- Ask for incremental improvements
- Request tests for new functionality
- Ask for code review and refactoring suggestions

**Example Prompts**:
```
I'm implementing Phase 1: Foundation. I need to create the
FileDropZone component. Here are the requirements from the spec:
[paste requirements]

Please help me implement this component with proper TypeScript
types and error handling.
```

```
I've built the crop overlay component. Here's the current code:
[paste code]

This works but feels slow. Can you help optimize it for 60fps
updates using requestAnimationFrame?
```

---

## Conclusion

This video editor project is exceptionally well-specified and ready for implementation. The risk-first approach of building the crop keyframe system first (Phase 2) will validate the core value proposition early, while the detailed specifications minimize ambiguity for AI-assisted development.

**Key Success Factors**:

1. **Follow the Phase Order** - Don't skip ahead, each phase builds on the previous
2. **Test Thoroughly** - Use the comprehensive testing checklists in each phase spec
3. **Optimize Early** - Performance requirements are strict (60fps), profile regularly
4. **Document as You Go** - Update README, add JSDoc comments
5. **Commit Frequently** - Save progress often, use meaningful commit messages

**Expected Outcome**: A production-ready, browser-based video editor with unique animated crop capabilities and professional editing features, built in 4-5 weeks.

---

## Appendix: Quick Reference

### Phase Priorities
1. **Foundation** (LOW RISK) - Sets architectural patterns
2. **Crop Keyframes** (HIGH RISK) - Validates core innovation
3. **Import/Export** (MVP ESSENTIAL) - Proves system viability
4. **Speed Controls** (MEDIUM RISK) - Adds professional feature
5. **Timeline Editing** (LOW RISK) - Completes feature set

### Key Algorithms to Implement
- Frame-accurate seeking
- Crop keyframe interpolation (linear, ease, bezier)
- Real/playback time conversion
- Clip splitting with effect preservation
- Overlap prevention for regions
- Snap-to-grid logic

### Critical Files
- `src/utils/interpolation.js` - All interpolation algorithms
- `src/utils/timeFormat.js` - Time conversion utilities
- `src/services/ffmpegService.js` - Export pipeline
- `src/hooks/useCrop.js` - Crop state management
- `src/components/CropOverlay.jsx` - Main crop UI

### Testing Focus Areas
- Crop interpolation edge cases
- Export with all effects combined
- Multi-clip timeline operations
- Time conversion bidirectionality
- Memory leaks (blob URLs, event listeners)

---

**Document Version**: 1.0
**Last Updated**: November 5, 2025
**Author**: Implementation Planning Review
**Status**: Ready for Development
