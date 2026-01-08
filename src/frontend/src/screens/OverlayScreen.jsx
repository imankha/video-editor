import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OverlayModeView } from '../modes';
import { OverlayContainer } from '../containers';
import { useHighlight } from '../modes/overlay';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import { API_BASE } from '../config';

/**
 * OverlayScreen - Self-contained screen for Overlay mode
 *
 * This component owns all overlay-specific hooks and state:
 * - useHighlight - highlight keyframe management
 * - useHighlightRegions - highlight region management
 * - useVideo - video playback (without segment awareness)
 * - useZoom - video zoom/pan
 * - useTimelineZoom - timeline zoom
 * - OverlayContainer - overlay logic and handlers
 *
 * IMPORTANT: Overlay video state (overlayVideoUrl, etc.) is passed from App.jsx
 * as props to avoid state isolation issues. App.jsx owns the useOverlayState
 * instance and passes it down.
 *
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for architecture context
 */
export function OverlayScreen({
  // Project context
  projectId,
  project,

  // Navigation
  onNavigate,
  onSwitchToFraming,

  // Export callback
  onExportComplete,

  // Framing data (needed for pass-through mode and comparison)
  framingVideoUrl,
  framingMetadata,
  framingVideoFile,
  framingKeyframes,
  framingSegments,
  framingSegmentSpeeds,
  framingSegmentBoundaries,
  framingTrimRange,
  framingClips,
  hasFramingClips,
  hasFramingEdits,
  hasMultipleClips,

  // Audio settings
  includeAudio,
  onIncludeAudioChange,

  // Overlay state (passed from App.jsx to avoid state isolation)
  // IMPORTANT: These come from App.jsx's useOverlayState instance, not a local one
  overlayVideoFile,
  overlayVideoUrl,
  overlayVideoMetadata,
  overlayClipMetadata,
  isLoadingWorkingVideo,
  setOverlayVideoFile,
  setOverlayVideoUrl,
  setOverlayVideoMetadata,
  setOverlayClipMetadata,
  setIsLoadingWorkingVideo,
  dragHighlight,
  setDragHighlight,
  selectedHighlightKeyframeTime,
  setSelectedHighlightKeyframeTime,
  highlightEffectType,
  setHighlightEffectType,
  pendingOverlaySaveRef,
  overlayDataLoadedRef,

  // Highlight regions state (passed from App.jsx to avoid state isolation)
  // IMPORTANT: These come from App.jsx's useHighlightRegions instance
  highlightBoundaries,
  highlightRegions,
  highlightRegionKeyframes,
  highlightRegionsFramerate,
  initializeHighlightRegions,
  initializeHighlightRegionsFromClips,
  addHighlightRegion,
  deleteHighlightRegion,
  moveHighlightRegionStart,
  moveHighlightRegionEnd,
  toggleHighlightRegion,
  addHighlightRegionKeyframe,
  removeHighlightRegionKeyframe,
  isTimeInEnabledRegion,
  getRegionAtTime,
  getRegionHighlightAtTime,
  getRegionsForExport,
  resetHighlightRegions,
  restoreHighlightRegions,
}) {
  // Local state
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const exportButtonRef = useRef(null);

  // Video hook - without segment awareness for overlay mode
  // IMPORTANT: We use the videoRef from this hook (not from App.jsx props)
  // This ensures seek/play/pause work correctly with the video element
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
    loadVideoFromUrl,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    restart,
    handlers,
  } = useVideo(null, null); // No segment functions in overlay mode

  // Determine effective video source
  const effectiveOverlayVideoUrl = overlayVideoUrl || framingVideoUrl;
  const effectiveOverlayMetadata = overlayVideoMetadata || framingMetadata;
  const effectiveOverlayFile = overlayVideoFile || framingVideoFile;
  const effectiveHighlightMetadata = overlayVideoMetadata || framingMetadata;

  // Highlight hook (still local - for keyframe-based highlighting, not region-based)
  const {
    keyframes: highlightKeyframes,
    framerate: highlightFramerate,
    isEnabled: isHighlightEnabled,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    deleteKeyframesInRange: deleteHighlightKeyframesInRange,
    cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    getHighlightDataAtTime,
    reset: resetHighlight,
  } = useHighlight(effectiveHighlightMetadata, null);

  // Note: Highlight regions state is now passed as props from App.jsx
  // to avoid state isolation issues (same fix as useOverlayState)

  // Zoom hooks
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

  const {
    timelineZoom,
    scrollPosition: timelineScrollPosition,
    zoomByWheel: timelineZoomByWheel,
    updateScrollPosition: updateTimelineScrollPosition,
    getTimelineScale,
  } = useTimelineZoom();

  // OverlayContainer - encapsulates overlay mode logic
  const overlay = OverlayContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    seek,
    framingVideoUrl,
    framingMetadata,
    framingVideoFile,
    keyframes: framingKeyframes,
    segments: framingSegments,
    segmentSpeeds: framingSegmentSpeeds,
    segmentBoundaries: framingSegmentBoundaries,
    trimRange: framingTrimRange,
    selectedProjectId: projectId,
    selectedProject: project,
    clips: framingClips,
    hasClips: hasFramingClips,
    editorMode: 'overlay',
    setEditorMode: () => {},
    setSelectedLayer,
    overlayVideoFile,
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    setOverlayVideoFile,
    setOverlayVideoUrl,
    setOverlayVideoMetadata,
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    highlightEffectType,
    setHighlightEffectType,
    pendingOverlaySaveRef,
    overlayDataLoadedRef,
    highlightRegions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    initializeHighlightRegions,
    resetHighlightRegions,
    addHighlightRegion,
    deleteHighlightRegion,
    moveHighlightRegionStart,
    moveHighlightRegionEnd,
    toggleHighlightRegion,
    addHighlightRegionKeyframe,
    removeHighlightRegionKeyframe,
    getRegionAtTime,
    isTimeInEnabledRegion,
    getRegionHighlightAtTime,
    getRegionsForExport,
    restoreHighlightRegions,
    initializeHighlightRegionsFromClips,
    onOverlayDataSaved: () => {},
  });

  const {
    currentHighlightState,
    playerDetectionEnabled,
    playerDetections,
    isDetectionLoading,
    isDetectionUploading,
    detectionError,
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
  } = overlay;

  // Note: Highlight region initialization is handled by App.jsx
  // App.jsx initializes default regions and restores saved regions from backend
  // Since state is now passed as props, we don't need to initialize here

  // Keyboard shortcuts for overlay mode
  // IMPORTANT: We handle shortcuts here (not in App.jsx's useKeyboardShortcuts)
  // because we use OverlayScreen's useVideo instance which has the correct videoRef
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      // Space bar: Toggle play/pause
      if (event.code === 'Space' && effectiveOverlayVideoUrl) {
        event.preventDefault();
        togglePlay();
        return;
      }

      // Arrow keys: Step forward/backward
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!effectiveOverlayVideoUrl) return;
        // Don't handle if modifier keys are pressed
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        if (event.code === 'ArrowLeft') {
          stepBackward();
        } else {
          stepForward();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [effectiveOverlayVideoUrl, togglePlay, stepForward, stepBackward]);

  return (
    <OverlayModeView
      // Video state
      videoRef={videoRef}
      effectiveOverlayVideoUrl={effectiveOverlayVideoUrl}
      effectiveOverlayMetadata={effectiveOverlayMetadata}
      effectiveOverlayFile={effectiveOverlayFile}
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
      handlers={handlers}
      // Playback controls
      togglePlay={togglePlay}
      stepForward={stepForward}
      stepBackward={stepBackward}
      restart={restart}
      seek={seek}
      // Highlight state
      currentHighlightState={currentHighlightState}
      highlightRegions={highlightRegions}
      highlightBoundaries={highlightBoundaries}
      highlightRegionKeyframes={highlightRegionKeyframes}
      highlightRegionsFramerate={highlightRegionsFramerate}
      highlightEffectType={highlightEffectType}
      isTimeInEnabledRegion={isTimeInEnabledRegion}
      // Highlight handlers
      onHighlightChange={handleHighlightChange}
      onHighlightComplete={handleHighlightComplete}
      onAddHighlightRegion={addHighlightRegion}
      onDeleteHighlightRegion={deleteHighlightRegion}
      onMoveHighlightRegionStart={moveHighlightRegionStart}
      onMoveHighlightRegionEnd={moveHighlightRegionEnd}
      onRemoveHighlightKeyframe={removeHighlightRegionKeyframe}
      onToggleHighlightRegion={toggleHighlightRegion}
      onSelectedKeyframeChange={setSelectedHighlightKeyframeTime}
      onHighlightEffectTypeChange={setHighlightEffectType}
      // Player detection
      playerDetectionEnabled={playerDetectionEnabled}
      playerDetections={playerDetections}
      isDetectionLoading={isDetectionLoading}
      isDetectionUploading={isDetectionUploading}
      onPlayerSelect={handlePlayerSelect}
      // Zoom
      zoom={zoom}
      panOffset={panOffset}
      MIN_ZOOM={MIN_ZOOM}
      MAX_ZOOM={MAX_ZOOM}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
      onResetZoom={resetZoom}
      onZoomByWheel={zoomByWheel}
      onPanChange={updatePan}
      // Timeline zoom
      timelineZoom={timelineZoom}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineZoomByWheel={timelineZoomByWheel}
      onTimelineScrollPositionChange={updateTimelineScrollPosition}
      getTimelineScale={getTimelineScale}
      // Layers
      selectedLayer={selectedLayer}
      onLayerSelect={setSelectedLayer}
      // Export
      exportButtonRef={exportButtonRef}
      getRegionsForExport={getRegionsForExport}
      includeAudio={includeAudio}
      onIncludeAudioChange={onIncludeAudioChange}
      onExportComplete={onExportComplete}
      // Mode switching
      onSwitchToFraming={onSwitchToFraming}
      hasFramingEdits={hasFramingEdits}
      hasMultipleClips={hasMultipleClips}
      framingVideoUrl={framingVideoUrl}
    />
  );
}

export default OverlayScreen;
