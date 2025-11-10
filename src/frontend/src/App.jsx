import { useState, useEffect, useMemo } from 'react';
import { useVideo } from './hooks/useVideo';
import useCrop from './hooks/useCrop';
import useZoom from './hooks/useZoom';
import { useSegments } from './hooks/useSegments';
import { VideoPlayer } from './components/VideoPlayer';
import { Timeline } from './components/Timeline';
import { Controls } from './components/Controls';
import { FileUpload } from './components/FileUpload';
import AspectRatioSelector from './components/AspectRatioSelector';
import ZoomControls from './components/ZoomControls';
import ExportButton from './components/ExportButton';
import DebugInfo from './components/DebugInfo';
import { CropProvider } from './contexts/CropContext';

function App() {
  const [videoFile, setVideoFile] = useState(null);
  // Temporary state for live drag/resize preview (null when not dragging)
  const [dragCrop, setDragCrop] = useState(null);

  // Segments hook (defined early so we can pass getSegmentAtTime to useVideo)
  const {
    boundaries: segmentBoundaries,
    segments,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    addBoundary: addSegmentBoundary,
    removeBoundary: removeSegmentBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getExportData: getSegmentExportData,
    isTimeVisible,
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
  } = useSegments();

  const {
    videoRef,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    error,
    isLoading,
    loadVideo,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    handlers,
  } = useVideo(getSegmentAtTime);

  // Crop hook - always active when video loaded
  const {
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
  } = useCrop(metadata);

  // Zoom hook
  const {
    zoom,
    panOffset,
    isZoomed,
    MIN_ZOOM,
    MAX_ZOOM,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomByWheel,
    updatePan,
  } = useZoom();

  const handleFileSelect = async (file) => {
    setVideoFile(file);
    await loadVideo(file);
  };

  // Initialize segments when video duration is available
  useEffect(() => {
    if (duration && duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // DERIVED STATE: Single source of truth
  // - If dragging: show live preview (dragCrop)
  // - Otherwise: interpolate from keyframes
  // IMPORTANT: Extract only spatial properties (x, y, width, height) - no time!
  const currentCropState = useMemo(() => {
    let crop;
    if (dragCrop) {
      crop = dragCrop;
    } else if (keyframes.length === 0) {
      return null;
    } else {
      crop = interpolateCrop(currentTime);
    }

    // Strip time property - CropOverlay should only know about spatial coords
    if (!crop) return null;
    return {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height
    };
  }, [dragCrop, keyframes, currentTime, interpolateCrop]);

  // Debug: Log keyframes changes
  useEffect(() => {
    console.log('[App] Keyframes changed:', keyframes);
  }, [keyframes]);

  // Debug: Log currentCropState changes
  useEffect(() => {
    console.log('[App] Current crop state:', currentCropState);
  }, [currentCropState]);

  // Handler functions for copy/paste (defined BEFORE useEffect to avoid initialization errors)
  const handleCopyCrop = (time = currentTime) => {
    if (videoUrl) {
      copyCropKeyframe(time);
    }
  };

  const handlePasteCrop = (time = currentTime) => {
    if (videoUrl && copiedCrop) {
      pasteCropKeyframe(time, duration);
      // Move playhead to the pasted keyframe location
      seek(time);
    }
  };

  // Keyboard handler: Space bar toggles play/pause
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle spacebar if video is loaded
      if (event.code === 'Space' && videoUrl) {
        // Prevent default spacebar behavior (page scroll)
        event.preventDefault();
        togglePlay();
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [videoUrl, togglePlay]);

  // Keyboard handler: Ctrl-C/Cmd-C copies crop, Ctrl-V/Cmd-V pastes crop
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle if video is loaded
      if (!videoUrl) return;

      // Check for Ctrl-C or Cmd-C (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
        // Only prevent default if no text is selected (to allow normal browser copy)
        if (window.getSelection().toString().length === 0) {
          event.preventDefault();
          handleCopyCrop();
        }
      }

      // Check for Ctrl-V or Cmd-V (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        // Only prevent default if we have crop data to paste
        if (copiedCrop) {
          event.preventDefault();
          handlePasteCrop();
        }
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [videoUrl, currentTime, duration, copiedCrop, copyCropKeyframe, pasteCropKeyframe]);

  // Handle crop changes during drag/resize (live preview)
  const handleCropChange = (newCrop) => {
    setDragCrop(newCrop);
  };

  // Handle crop complete (create keyframe and clear drag state)
  const handleCropComplete = (cropData) => {
    addOrUpdateKeyframe(currentTime, cropData, duration);
    setDragCrop(null); // Clear drag preview
  };

  // Handle keyframe click (seek to keyframe time)
  const handleKeyframeClick = (time) => {
    seek(time);
  };

  // Handle keyframe delete (pass duration to removeKeyframe)
  const handleKeyframeDelete = (time) => {
    removeKeyframe(time, duration);
  };

  // Prepare crop context value
  const cropContextValue = useMemo(() => ({
    keyframes,
    isEndKeyframeExplicit,
    aspectRatio,
    copiedCrop,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
  }), [keyframes, isEndKeyframeExplicit, aspectRatio, copiedCrop, updateAspectRatio, addOrUpdateKeyframe, removeKeyframe, copyCropKeyframe, pasteCropKeyframe, interpolateCrop, hasKeyframeAt]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              🎬 Highlight Reel Builder
            </h1>
            <p className="text-gray-400">
              Upload a video to get started
            </p>
          </div>
          <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
            <p className="text-red-200 font-semibold mb-1">❌ Error</p>
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
              <AspectRatioSelector
                aspectRatio={aspectRatio}
                onAspectRatioChange={updateAspectRatio}
                copiedCrop={copiedCrop}
                onPasteCrop={handlePasteCrop}
              />
              <div className="ml-auto">
                <ZoomControls
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onResetZoom={resetZoom}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                />
              </div>
            </div>
          )}

          {/* Video Player */}
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={videoUrl}
            handlers={handlers}
            onFileSelect={handleFileSelect}
            videoMetadata={metadata}
            showCropOverlay={!!videoUrl}
            currentCrop={currentCropState}
            aspectRatio={aspectRatio}
            onCropChange={handleCropChange}
            onCropComplete={handleCropComplete}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={zoomByWheel}
            onPanChange={updatePan}
          />

          {/* Timeline */}
          {videoUrl && (
            <div className="mt-6">
              <CropProvider value={cropContextValue}>
                <Timeline
                  currentTime={currentTime}
                  duration={duration}
                  visualDuration={visualDuration || duration}
                  sourceDuration={sourceDuration || duration}
                  trimmedDuration={trimmedDuration || 0}
                  onSeek={seek}
                  cropKeyframes={keyframes}
                  isCropActive={true}
                  onCropKeyframeClick={handleKeyframeClick}
                  onCropKeyframeDelete={handleKeyframeDelete}
                  onCropKeyframeCopy={handleCopyCrop}
                  onCropKeyframePaste={handlePasteCrop}
                  segments={segments}
                  segmentBoundaries={segmentBoundaries}
                  segmentVisualLayout={segmentVisualLayout}
                  isSegmentActive={true}
                  onAddSegmentBoundary={addSegmentBoundary}
                  onRemoveSegmentBoundary={removeSegmentBoundary}
                  onSegmentSpeedChange={setSegmentSpeed}
                  onSegmentTrim={toggleTrimSegment}
                  sourceTimeToVisualTime={sourceTimeToVisualTime}
                  visualTimeToSourceTime={visualTimeToSourceTime}
                />
              </CropProvider>
            </div>
          )}

          {/* Controls */}
          {videoUrl && (
            <div className="mt-6">
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
              />
            </div>
          )}

          {/* Export Button */}
          {videoUrl && (
            <div className="mt-6">
              <ExportButton
                videoFile={videoFile}
                cropKeyframes={keyframes}
                segmentData={getSegmentExportData()}
                disabled={!videoFile}
              />
            </div>
          )}
        </div>

        {/* Instructions */}
        {!videoUrl && !isLoading && !error && (
          <div className="mt-8 text-center text-gray-400">
            <div className="max-w-2xl mx-auto space-y-4">
              <h2 className="text-xl font-semibold text-white mb-4">
                Getting Started
              </h2>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">📤</div>
                  <h3 className="font-semibold text-white mb-1">1. Upload</h3>
                  <p>Click "Upload Video" to select a video file (MP4, MOV, WebM)</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">▶️</div>
                  <h3 className="font-semibold text-white mb-1">2. Play</h3>
                  <p>Use the play/pause button to control playback</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">⏱️</div>
                  <h3 className="font-semibold text-white mb-1">3. Scrub</h3>
                  <p>Click or drag the timeline to navigate through your video</p>
                </div>
              </div>
              <div className="mt-6 text-xs text-gray-500">
                <p>Supported formats: MP4, MOV, WebM</p>
                <p>Maximum file size: 4GB</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Phase 2: Crop Tool with Keyframe Animation</p>
        </div>
      </div>

      {/* Debug Info - Shows current branch and commit */}
      <DebugInfo />
    </div>
  );
}

export default App;
