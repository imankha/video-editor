# Task 01: Extract FramingModeView.jsx

## Goal
Move all framing-specific JSX from App.jsx into a new FramingModeView.jsx component.

## Impact
- **Lines removed from App.jsx**: ~500
- **Risk level**: Low (JSX only, no logic changes)

## Files to Create
- `src/frontend/src/modes/FramingModeView.jsx`

## Files to Modify
- `src/frontend/src/App.jsx`

## Step-by-Step Instructions

### Step 1: Create the modes folder
```bash
mkdir -p src/frontend/src/modes
```

### Step 2: Identify framing-specific JSX in App.jsx

Look for these sections (approximate line numbers):
- **Video metadata display for framing**: Lines 2811-2838
- **Controls bar with ZoomControls**: Lines 2867-2881
- **VideoPlayer with CropOverlay**: Lines 2896-2910
- **Controls component**: Lines 2999-3013
- **FramingMode timeline**: Lines 3017-3063
- **ExportButton for framing**: Lines 3257-3286

### Step 3: Create FramingModeView.jsx

```jsx
// src/frontend/src/modes/FramingModeView.jsx

import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import ExportButton from '../components/ExportButton';
import { FramingMode, CropOverlay } from '../modes/framing';

/**
 * FramingModeView - Complete view for Framing mode
 *
 * This component contains all framing-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 */
export function FramingModeView({
  // Video state
  videoRef,
  videoUrl,
  metadata,
  videoFile,
  currentTime,
  duration,
  isPlaying,
  isLoading,
  error,
  handlers,

  // Playback controls
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,

  // Crop state
  currentCropState,
  aspectRatio,
  keyframes,
  framerate,
  selectedCropKeyframeIndex,
  copiedCrop,
  dragCrop,

  // Crop handlers
  onCropChange,
  onCropComplete,
  onKeyframeClick,
  onKeyframeDelete,
  onCopyCrop,
  onPasteCrop,

  // Zoom state
  zoom,
  panOffset,
  MIN_ZOOM,
  MAX_ZOOM,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomByWheel,
  onPanChange,

  // Timeline zoom
  timelineZoom,
  timelineScrollPosition,
  onTimelineZoomByWheel,
  onTimelineScrollPositionChange,
  getTimelineScale,

  // Segments
  segments,
  segmentBoundaries,
  segmentVisualLayout,
  visualDuration,
  trimRange,
  trimHistory,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  onDetrimStart,
  onDetrimEnd,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,

  // Layers
  selectedLayer,
  onLayerSelect,

  // Clips
  clips,
  hasClips,
  clipsWithCurrentState,
  globalAspectRatio,
  globalTransition,

  // Export
  getFilteredKeyframesForExport,
  getSegmentExportData,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  onExportComplete,

  // File handling
  onFileSelect,

  // Context
  cropContextValue,
}) {
  return (
    <>
      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
          <p className="text-red-200 font-semibold mb-1">Error</p>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Video Metadata */}
      {metadata && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span className="font-semibold text-white">{metadata.fileName}</span>
            <div className="flex space-x-6">
              <span>
                <span className="text-gray-400">Resolution:</span>{' '}
                {metadata.width}x{metadata.height}
              </span>
              {metadata.framerate && (
                <span>
                  <span className="text-gray-400">Framerate:</span>{' '}
                  {metadata.framerate} fps
                </span>
              )}
              <span>
                <span className="text-gray-400">Format:</span>{' '}
                {metadata.format.toUpperCase()}
              </span>
              <span>
                <span className="text-gray-400">Size:</span>{' '}
                {(metadata.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
        {/* Controls Bar */}
        {videoUrl && (
          <div className="mb-6 flex gap-4 items-center">
            <div className="ml-auto">
              <ZoomControls
                zoom={zoom}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onResetZoom={onResetZoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
              />
            </div>
          </div>
        )}

        {/* Video Player with CropOverlay */}
        <div className="relative bg-gray-900 rounded-lg">
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={videoUrl}
            handlers={handlers}
            onFileSelect={onFileSelect}
            overlays={[
              videoUrl && currentCropState && metadata && (
                <CropOverlay
                  key="crop"
                  videoRef={videoRef}
                  videoMetadata={metadata}
                  currentCrop={currentCropState}
                  aspectRatio={aspectRatio}
                  onCropChange={onCropChange}
                  onCropComplete={onCropComplete}
                  zoom={zoom}
                  panOffset={panOffset}
                  selectedKeyframeIndex={selectedCropKeyframeIndex}
                />
              ),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={onZoomByWheel}
            onPanChange={onPanChange}
          />

          {/* Controls */}
          {videoUrl && (
            <Controls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              onTogglePlay={togglePlay}
              onStepForward={stepForward}
              onStepBackward={stepBackward}
              onRestart={restart}
            />
          )}
        </div>

        {/* Framing Mode Timeline */}
        {videoUrl && (
          <FramingMode
            videoRef={videoRef}
            videoUrl={videoUrl}
            metadata={metadata}
            currentTime={currentTime}
            duration={duration}
            cropContextValue={cropContextValue}
            currentCropState={currentCropState}
            aspectRatio={aspectRatio}
            cropKeyframes={keyframes}
            framerate={framerate}
            selectedCropKeyframeIndex={selectedCropKeyframeIndex}
            copiedCrop={copiedCrop}
            onCropChange={onCropChange}
            onCropComplete={onCropComplete}
            onCropKeyframeClick={onKeyframeClick}
            onCropKeyframeDelete={onKeyframeDelete}
            onCropKeyframeCopy={onCopyCrop}
            onCropKeyframePaste={onPasteCrop}
            zoom={zoom}
            panOffset={panOffset}
            segments={segments}
            segmentBoundaries={segmentBoundaries}
            segmentVisualLayout={segmentVisualLayout}
            visualDuration={visualDuration || duration}
            trimRange={trimRange}
            trimHistory={trimHistory}
            onAddSegmentBoundary={onAddSegmentBoundary}
            onRemoveSegmentBoundary={onRemoveSegmentBoundary}
            onSegmentSpeedChange={onSegmentSpeedChange}
            onSegmentTrim={onSegmentTrim}
            onDetrimStart={onDetrimStart}
            onDetrimEnd={onDetrimEnd}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            onSeek={seek}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={getTimelineScale()}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            isPlaying={isPlaying}
          />
        )}

        {/* Export Button */}
        {videoUrl && (
          <div className="mt-6">
            <ExportButton
              videoFile={videoFile}
              cropKeyframes={getFilteredKeyframesForExport}
              highlightRegions={[]}
              isHighlightEnabled={false}
              segmentData={getSegmentExportData()}
              disabled={!videoFile}
              includeAudio={includeAudio}
              onIncludeAudioChange={onIncludeAudioChange}
              onProceedToOverlay={onProceedToOverlay}
              clips={hasClips ? clipsWithCurrentState : null}
              globalAspectRatio={globalAspectRatio}
              globalTransition={globalTransition}
              onExportComplete={onExportComplete}
            />
          </div>
        )}
      </div>

      {/* Instructions when no video */}
      {!videoUrl && !isLoading && !error && (
        <div className="mt-8 text-center text-gray-400">
          {/* ... instructions JSX ... */}
        </div>
      )}
    </>
  );
}
```

### Step 4: Update App.jsx to use FramingModeView

In App.jsx, replace the framing-specific JSX with:

```jsx
import { FramingModeView } from './modes/FramingModeView';

// In the render section, replace framing JSX with:
{editorMode === 'framing' && (
  <FramingModeView
    // Pass all required props
    videoRef={videoRef}
    videoUrl={videoUrl}
    // ... etc
  />
)}
```

### Step 5: Create barrel export

```jsx
// src/frontend/src/modes/index.js
export { FramingModeView } from './FramingModeView';
```

## Verification Checklist

- [ ] FramingModeView.jsx created with all framing JSX
- [ ] App.jsx imports and uses FramingModeView
- [ ] All props are passed correctly
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Load video, crop keyframes work, export works

## Rollback

If issues arise:
```bash
git checkout src/frontend/src/App.jsx
rm -rf src/frontend/src/modes/FramingModeView.jsx
```
