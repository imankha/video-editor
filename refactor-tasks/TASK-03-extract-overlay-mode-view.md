# Task 03: Extract OverlayModeView.jsx

## Goal
Move all overlay-specific JSX from App.jsx into a new OverlayModeView.jsx component.

## Impact
- **Lines removed from App.jsx**: ~400
- **Risk level**: Low (JSX only, no logic changes)

## Prerequisites
- Task 01 and 02 completed

## Files to Create
- `src/frontend/src/modes/OverlayModeView.jsx`

## Files to Modify
- `src/frontend/src/App.jsx`
- `src/frontend/src/modes/index.js`

## Key Sections to Extract from App.jsx

### 1. VideoPlayer with overlay-specific overlays
**Location**: Lines 2943-2972
- HighlightOverlay (highlight box around player)
- PlayerDetectionOverlay (AI-detected player boxes)

### 2. Controls for overlay mode
**Location**: Lines 2999-3013 (shared with framing, but conditional)

### 3. OverlayMode timeline
**Location**: Lines 3065-3107

### 4. Export required message
**Location**: Lines 3237-3255
```jsx
{editorMode === 'overlay' && !effectiveOverlayVideoUrl && videoUrl && ...}
```

### 5. ExportButton for overlay mode
**Location**: Lines 3257-3286 (shared, but with overlay-specific props)

## Step-by-Step Instructions

### Step 1: Create OverlayModeView.jsx

```jsx
// src/frontend/src/modes/OverlayModeView.jsx

import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import ExportButton from '../components/ExportButton';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from '../modes/overlay';

/**
 * OverlayModeView - Complete view for Overlay mode
 *
 * Contains all overlay-specific JSX previously in App.jsx.
 */
export function OverlayModeView({
  // Video state
  videoRef,
  effectiveOverlayVideoUrl,
  effectiveOverlayMetadata,
  effectiveOverlayFile,
  currentTime,
  duration,
  isPlaying,
  handlers,

  // Playback controls
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,

  // Highlight state
  currentHighlightState,
  highlightRegions,
  highlightBoundaries,
  highlightRegionKeyframes,
  highlightRegionsFramerate,
  highlightEffectType,
  isTimeInEnabledRegion,

  // Highlight handlers
  onHighlightChange,
  onHighlightComplete,
  onAddHighlightRegion,
  onDeleteHighlightRegion,
  onMoveHighlightRegionStart,
  onMoveHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  onHighlightEffectTypeChange,

  // Player detection
  playerDetectionEnabled,
  playerDetections,
  isDetectionLoading,
  isDetectionUploading,
  onPlayerSelect,

  // Zoom
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

  // Layers
  selectedLayer,
  onLayerSelect,

  // Export
  getRegionsForExport,
  includeAudio,
  onIncludeAudioChange,
  onExportComplete,

  // Mode switching
  onSwitchToFraming,
  hasFramingEdits,
  hasMultipleClips,
  framingVideoUrl,
}) {
  // Show "export required" message if no overlay video but framing has edits
  const showExportRequired = !effectiveOverlayVideoUrl && framingVideoUrl && (hasFramingEdits || hasMultipleClips);

  return (
    <>
      {/* Video Metadata - use overlay metadata */}
      {effectiveOverlayMetadata && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span className="font-semibold text-white">{effectiveOverlayMetadata.fileName}</span>
            <div className="flex space-x-6">
              <span>
                <span className="text-gray-400">Resolution:</span>{' '}
                {effectiveOverlayMetadata.width}x{effectiveOverlayMetadata.height}
              </span>
              {effectiveOverlayMetadata.framerate && (
                <span>
                  <span className="text-gray-400">Framerate:</span>{' '}
                  {effectiveOverlayMetadata.framerate} fps
                </span>
              )}
              <span>
                <span className="text-gray-400">Format:</span>{' '}
                {effectiveOverlayMetadata.format?.toUpperCase() || 'MP4'}
              </span>
              <span>
                <span className="text-gray-400">Size:</span>{' '}
                {(effectiveOverlayMetadata.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
        {/* Controls Bar */}
        {effectiveOverlayVideoUrl && (
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

        {/* Video Player with overlay-specific overlays */}
        <div className="relative bg-gray-900 rounded-lg">
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={effectiveOverlayVideoUrl}
            handlers={handlers}
            overlays={[
              // HighlightOverlay - highlight box around player
              currentHighlightState && effectiveOverlayMetadata && (
                <HighlightOverlay
                  key="highlight"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  currentHighlight={currentHighlightState}
                  onHighlightChange={onHighlightChange}
                  onHighlightComplete={onHighlightComplete}
                  isEnabled={isTimeInEnabledRegion(currentTime)}
                  effectType={highlightEffectType}
                  zoom={zoom}
                  panOffset={panOffset}
                />
              ),
              // PlayerDetectionOverlay - AI-detected player boxes
              effectiveOverlayMetadata && playerDetectionEnabled && (
                <PlayerDetectionOverlay
                  key="player-detection"
                  videoRef={videoRef}
                  videoMetadata={effectiveOverlayMetadata}
                  detections={playerDetections}
                  isLoading={isDetectionLoading || isDetectionUploading}
                  onPlayerSelect={onPlayerSelect}
                  zoom={zoom}
                  panOffset={panOffset}
                />
              ),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={onZoomByWheel}
            onPanChange={onPanChange}
          />

          {/* Controls */}
          {effectiveOverlayVideoUrl && (
            <Controls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={effectiveOverlayMetadata?.duration || duration}
              onTogglePlay={togglePlay}
              onStepForward={stepForward}
              onStepBackward={stepBackward}
              onRestart={restart}
            />
          )}
        </div>

        {/* Overlay Mode Timeline */}
        {effectiveOverlayVideoUrl && (
          <OverlayMode
            videoRef={videoRef}
            videoUrl={effectiveOverlayVideoUrl}
            metadata={effectiveOverlayMetadata}
            currentTime={currentTime}
            duration={effectiveOverlayMetadata?.duration || duration}
            highlightRegions={highlightRegions}
            highlightBoundaries={highlightBoundaries}
            highlightKeyframes={highlightRegionKeyframes}
            highlightFramerate={highlightRegionsFramerate}
            onAddHighlightRegion={onAddHighlightRegion}
            onDeleteHighlightRegion={onDeleteHighlightRegion}
            onMoveHighlightRegionStart={onMoveHighlightRegionStart}
            onMoveHighlightRegionEnd={onMoveHighlightRegionEnd}
            onRemoveHighlightKeyframe={onRemoveHighlightKeyframe}
            onToggleHighlightRegion={onToggleHighlightRegion}
            onSelectedKeyframeChange={onSelectedKeyframeChange}
            onHighlightChange={onHighlightChange}
            onHighlightComplete={onHighlightComplete}
            zoom={zoom}
            panOffset={panOffset}
            visualDuration={effectiveOverlayMetadata?.duration || duration}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            onSeek={seek}
            sourceTimeToVisualTime={(t) => t}
            visualTimeToSourceTime={(t) => t}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={getTimelineScale()}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            trimRange={null}
            isPlaying={isPlaying}
          />
        )}

        {/* Export Required Message */}
        {showExportRequired && (
          <div className="mt-6 bg-purple-900/30 border border-purple-500/50 rounded-lg p-6 text-center">
            <p className="text-purple-200 font-medium mb-2">
              Export required for overlay mode
            </p>
            <p className="text-purple-300/70 text-sm mb-4">
              {hasMultipleClips
                ? 'You have multiple clips loaded. Export first to combine them into a single video before adding overlays.'
                : 'You have made edits in Framing mode. Export first to apply them before adding overlays.'}
            </p>
            <button
              onClick={onSwitchToFraming}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Switch to Framing Mode
            </button>
          </div>
        )}

        {/* Export Button */}
        {effectiveOverlayVideoUrl && (
          <div className="mt-6">
            <ExportButton
              videoFile={effectiveOverlayFile}
              cropKeyframes={[]}
              highlightRegions={getRegionsForExport()}
              isHighlightEnabled={highlightRegions.length > 0}
              segmentData={null}
              disabled={!effectiveOverlayFile}
              includeAudio={includeAudio}
              onIncludeAudioChange={onIncludeAudioChange}
              highlightEffectType={highlightEffectType}
              onHighlightEffectTypeChange={onHighlightEffectTypeChange}
              onExportComplete={onExportComplete}
            />
          </div>
        )}
      </div>
    </>
  );
}
```

### Step 2: Update modes/index.js

```jsx
export { FramingModeView } from './FramingModeView';
export { AnnotateModeView } from './AnnotateModeView';
export { OverlayModeView } from './OverlayModeView';
```

### Step 3: Update App.jsx

Replace overlay-specific JSX with:
```jsx
import { OverlayModeView } from './modes';

// In render:
{editorMode === 'overlay' && (
  <OverlayModeView
    videoRef={videoRef}
    effectiveOverlayVideoUrl={effectiveOverlayVideoUrl}
    // ... all other props
  />
)}
```

## Verification Checklist

- [ ] OverlayModeView.jsx created with all overlay JSX
- [ ] App.jsx imports and uses OverlayModeView
- [ ] All props are passed correctly
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Switch to overlay mode, highlight regions work, export works

## Rollback

```bash
git checkout src/frontend/src/App.jsx
rm src/frontend/src/modes/OverlayModeView.jsx
```
