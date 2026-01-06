# Task 02: Extract AnnotateModeView.jsx

## Goal
Move all annotate-specific JSX from App.jsx into a new AnnotateModeView.jsx component.

## Impact
- **Lines removed from App.jsx**: ~400
- **Risk level**: Low (JSX only, no logic changes)

## Prerequisites
- Task 01 completed (establishes the pattern)

## Files to Create
- `src/frontend/src/modes/AnnotateModeView.jsx`

## Files to Modify
- `src/frontend/src/App.jsx`
- `src/frontend/src/modes/index.js`

## Key Sections to Extract from App.jsx

### 1. Video metadata display for annotate mode
**Location**: Lines 2840-2863
```jsx
{editorMode === 'annotate' && annotateVideoMetadata && !annotateFullscreen && (
  <div className="mb-4 bg-white/10 ...">
    {/* metadata display */}
  </div>
)}
```

### 2. VideoPlayer with annotate overlays
**Location**: Lines 2911-2942
- NotesOverlay (shows name, rating, notes for current region)
- AnnotateFullscreenOverlay (appears when paused in fullscreen)

### 3. AnnotateControls
**Location**: Lines 2983-2998
```jsx
{editorMode === 'annotate' && annotateVideoUrl && (
  <AnnotateControls ... />
)}
```

### 4. AnnotateMode timeline
**Location**: Lines 3109-3123
```jsx
{annotateVideoUrl && editorMode === 'annotate' && (
  <AnnotateMode ... />
)}
```

### 5. Annotate export section
**Location**: Lines 3125-3235
- Export settings panel
- Progress bar
- "Create Annotated Video" button
- "Import Into Projects" button with settings

## Step-by-Step Instructions

### Step 1: Create AnnotateModeView.jsx

```jsx
// src/frontend/src/modes/AnnotateModeView.jsx

import { Download, Loader, Upload, Settings } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from '../modes/annotate';

/**
 * AnnotateModeView - Complete view for Annotate mode
 *
 * Contains all annotate-specific JSX previously in App.jsx.
 */
export function AnnotateModeView({
  // Video state
  videoRef,
  annotateVideoUrl,
  annotateVideoMetadata,
  annotateContainerRef,
  currentTime,
  duration,
  isPlaying,
  handlers,

  // Fullscreen state
  annotateFullscreen,
  showAnnotateOverlay,

  // Playback
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,
  annotatePlaybackSpeed,
  onSpeedChange,

  // Clips/regions
  annotateRegionsWithLayout,
  annotateSelectedRegionId,
  hasAnnotateClips,
  clipRegions,

  // Handlers
  onSelectRegion,
  onDeleteRegion,
  onToggleFullscreen,
  onAddClip,
  getAnnotateRegionAtTime,
  getAnnotateExportData,

  // Fullscreen overlay handlers
  onFullscreenCreateClip,
  onFullscreenUpdateClip,
  onOverlayResume,
  onOverlayClose,

  // Layer selection
  annotateSelectedLayer,
  onLayerSelect,

  // Export state
  exportProgress,
  isCreatingAnnotatedVideo,
  isImportingToProjects,
  isUploadingGameVideo,

  // Export handlers
  onCreateAnnotatedVideo,
  onImportIntoProjects,
  onOpenProjectCreationSettings,

  // Zoom (for video player)
  zoom,
  panOffset,
  onZoomChange,
  onPanChange,
}) {
  return (
    <>
      {/* Video Metadata - Annotate mode */}
      {annotateVideoMetadata && !annotateFullscreen && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span className="font-semibold text-white truncate max-w-md" title={annotateVideoMetadata.fileName}>
              {annotateVideoMetadata.fileName}
            </span>
            <div className="flex space-x-6">
              <span>
                <span className="text-gray-400">Resolution:</span>{' '}
                {annotateVideoMetadata.resolution}
              </span>
              <span>
                <span className="text-gray-400">Format:</span>{' '}
                {annotateVideoMetadata.format?.toUpperCase() || 'MP4'}
              </span>
              <span>
                <span className="text-gray-400">Size:</span>{' '}
                {annotateVideoMetadata.sizeFormatted || `${(annotateVideoMetadata.size / (1024 * 1024)).toFixed(2)} MB`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
        {/* Video Player with annotate overlays */}
        <div ref={annotateContainerRef} className="relative bg-gray-900 rounded-lg">
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={annotateVideoUrl}
            handlers={handlers}
            overlays={[
              // NotesOverlay - shows name, rating, notes for region at playhead
              (() => {
                const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
                return (regionAtPlayhead?.name || regionAtPlayhead?.notes) ? (
                  <NotesOverlay
                    key="annotate-notes"
                    name={regionAtPlayhead.name}
                    notes={regionAtPlayhead.notes}
                    rating={regionAtPlayhead.rating}
                    isVisible={true}
                    isFullscreen={annotateFullscreen}
                  />
                ) : null;
              })(),
              // AnnotateFullscreenOverlay - appears when paused in fullscreen
              showAnnotateOverlay && (() => {
                const existingClip = getAnnotateRegionAtTime(currentTime);
                return (
                  <AnnotateFullscreenOverlay
                    key="annotate-fullscreen"
                    isVisible={showAnnotateOverlay}
                    currentTime={currentTime}
                    videoDuration={annotateVideoMetadata?.duration || 0}
                    existingClip={existingClip}
                    onCreateClip={onFullscreenCreateClip}
                    onUpdateClip={onFullscreenUpdateClip}
                    onResume={onOverlayResume}
                    onClose={onOverlayClose}
                  />
                );
              })(),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={onZoomChange}
            onPanChange={onPanChange}
            isFullscreen={annotateFullscreen}
            clipRating={getAnnotateRegionAtTime(currentTime)?.rating ?? null}
          />

          {/* Annotate Controls */}
          <AnnotateControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={annotateVideoMetadata?.duration || duration}
            onTogglePlay={togglePlay}
            onStepForward={stepForward}
            onStepBackward={stepBackward}
            onRestart={restart}
            playbackSpeed={annotatePlaybackSpeed}
            onSpeedChange={onSpeedChange}
            isFullscreen={annotateFullscreen}
            onToggleFullscreen={onToggleFullscreen}
            onAddClip={onAddClip}
          />
        </div>

        {/* Annotate Mode Timeline */}
        <AnnotateMode
          currentTime={currentTime}
          duration={annotateVideoMetadata?.duration || 0}
          isPlaying={isPlaying}
          onSeek={seek}
          regions={annotateRegionsWithLayout}
          selectedRegionId={annotateSelectedRegionId}
          onSelectRegion={onSelectRegion}
          onDeleteRegion={onDeleteRegion}
          selectedLayer={annotateSelectedLayer}
          onLayerSelect={onLayerSelect}
        />

        {/* Export Section */}
        <div className="mt-6">
          <div className="space-y-3">
            {/* Export Settings */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
              <div className="text-sm font-medium text-gray-300 mb-3">
                Annotate Settings
              </div>
              <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
                Extracts marked clips and loads them into Framing mode
              </div>
            </div>

            {/* Export buttons */}
            <div className="space-y-2">
              {/* Progress bar */}
              {exportProgress && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">{exportProgress.message}</span>
                    {exportProgress.total > 0 && (
                      <span className="text-xs text-gray-500">
                        {Math.round((exportProgress.current / exportProgress.total) * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        exportProgress.done ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{
                        width: exportProgress.total > 0
                          ? `${(exportProgress.current / exportProgress.total) * 100}%`
                          : '0%'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Create Annotated Video button */}
              <button
                onClick={() => onCreateAnnotatedVideo(getAnnotateExportData())}
                disabled={!hasAnnotateClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo}
                className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  !hasAnnotateClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isUploadingGameVideo ? (
                  <>
                    <Loader className="animate-spin" size={18} />
                    <span>Uploading video...</span>
                  </>
                ) : isCreatingAnnotatedVideo ? (
                  <>
                    <Loader className="animate-spin" size={18} />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    <span>Create Annotated Video</span>
                  </>
                )}
              </button>

              {/* Import Into Projects button */}
              <div className="flex gap-2">
                <button
                  onClick={() => onImportIntoProjects(getAnnotateExportData())}
                  disabled={!hasAnnotateClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    !hasAnnotateClips || isCreatingAnnotatedVideo || isImportingToProjects || isUploadingGameVideo
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {isImportingToProjects ? (
                    <>
                      <Loader className="animate-spin" size={18} />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      <span>Import Into Projects</span>
                    </>
                  )}
                </button>
                <button
                  onClick={onOpenProjectCreationSettings}
                  className="px-3 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
                  title="Project creation settings"
                >
                  <Settings size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

### Step 2: Update modes/index.js

```jsx
export { FramingModeView } from './FramingModeView';
export { AnnotateModeView } from './AnnotateModeView';
```

### Step 3: Update App.jsx

Replace annotate-specific JSX with:
```jsx
import { AnnotateModeView } from './modes';

// In render:
{editorMode === 'annotate' && annotateVideoUrl && (
  <AnnotateModeView
    videoRef={videoRef}
    annotateVideoUrl={annotateVideoUrl}
    // ... all other props
  />
)}
```

## Verification Checklist

- [ ] AnnotateModeView.jsx created with all annotate JSX
- [ ] App.jsx imports and uses AnnotateModeView
- [ ] All props are passed correctly
- [ ] No TypeScript/ESLint errors
- [ ] Run: `cd src/frontend && npm test` - all tests pass
- [ ] Run: `cd src/frontend && npx playwright test` - all E2E tests pass
- [ ] Manual test: Load game, create clips, export works

## Rollback

```bash
git checkout src/frontend/src/App.jsx
rm src/frontend/src/modes/AnnotateModeView.jsx
```
