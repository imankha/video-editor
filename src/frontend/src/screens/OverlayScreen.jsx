import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OverlayModeView } from '../modes';
import { OverlayContainer } from '../containers';
import { useHighlight, useHighlightRegions, useOverlayState } from '../modes/overlay';
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
 * - useOverlayState - overlay video state
 * - useVideo - video playback (without segment awareness)
 * - useZoom - video zoom/pan
 * - useTimelineZoom - timeline zoom
 * - OverlayContainer - overlay logic and handlers
 *
 * Props from App.jsx are minimal:
 * - projectId - current project ID
 * - project - current project object
 * - onNavigate - navigation callback
 * - onExportComplete - callback when export finishes
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

  // Shared refs (temporary - will be moved to stores later)
  videoRef,

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
}) {
  // Local state
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const exportButtonRef = useRef(null);

  // Overlay state hook
  const {
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
  } = useOverlayState();

  // Video hook - without segment awareness for overlay mode
  const {
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

  // Highlight hook
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

  // Highlight regions hook
  const {
    boundaries: highlightBoundaries,
    regions: highlightRegions,
    keyframes: highlightRegionKeyframes,
    framerate: highlightRegionsFramerate,
    initializeWithDuration: initializeHighlightRegions,
    initializeFromClipMetadata: initializeHighlightRegionsFromClips,
    addRegion: addHighlightRegion,
    deleteRegionByIndex: deleteHighlightRegion,
    moveRegionStart: moveHighlightRegionStart,
    moveRegionEnd: moveHighlightRegionEnd,
    toggleRegionEnabled: toggleHighlightRegion,
    addOrUpdateKeyframe: addHighlightRegionKeyframe,
    removeKeyframe: removeHighlightRegionKeyframe,
    isTimeInEnabledRegion,
    getRegionAtTime,
    getHighlightAtTime: getRegionHighlightAtTime,
    getRegionsForExport,
    reset: resetHighlightRegions,
    restoreRegions: restoreHighlightRegions,
  } = useHighlightRegions(effectiveHighlightMetadata);

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

  // Initialize highlight regions when video duration is available
  useEffect(() => {
    const highlightDuration = overlayVideoMetadata?.duration || duration;
    if (highlightDuration && highlightDuration > 0) {
      initializeHighlightRegions(highlightDuration);
    }
  }, [overlayVideoMetadata?.duration, duration, initializeHighlightRegions]);

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
