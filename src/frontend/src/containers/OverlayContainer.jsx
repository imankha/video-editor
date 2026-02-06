import { useEffect, useCallback, useMemo, useState } from 'react';
import { OverlayMode, HighlightOverlay, PlayerDetectionOverlay } from '../modes/overlay';
import { extractVideoMetadata } from '../utils/videoMetadata';
import { API_BASE } from '../config';

/**
 * OverlayContainer - Encapsulates all Overlay mode logic and UI
 *
 * This container manages:
 * - Overlay video state (rendered video from Framing export)
 * - Highlight region management (create, edit, delete regions)
 * - Player detection for click-to-track feature
 * - Highlight keyframe management within regions
 * - Effect type selection (brightness_boost, original, dark_overlay)
 * - Persistence of overlay data to backend
 *
 * NOTE: Overlay state and highlight regions are passed as props from App.jsx
 * to avoid duplicate state. App.jsx owns these hooks; OverlayContainer
 * orchestrates them and provides derived state/handlers.
 *
 * @param {Object} props - Dependencies from App.jsx
 * @see APP_REFACTOR_PLAN.md Task 3.2 for refactoring context
 */
export function OverlayContainer({
  // Video element ref and state
  videoRef,
  currentTime,
  duration,
  isPlaying,
  seek,

  // Framing video state (for pass-through mode)
  framingVideoUrl,
  framingMetadata,
  framingVideoFile,

  // Keyframes and segments from Framing mode
  keyframes,
  segments,
  segmentSpeeds,
  segmentBoundaries,
  trimRange,

  // Project context
  selectedProjectId,
  selectedProject,

  // Clips state
  clips,
  hasClips,

  // Editor mode
  editorMode,
  setEditorMode,
  setSelectedLayer,

  // Overlay state from useOverlayState hook (passed from App.jsx to avoid duplicate state)
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
  // Sync state machine (replaces overlayDataLoadedForProjectRef)
  overlaySyncState,
  overlayLoadedProjectId,

  // Highlight regions from useHighlightRegions hook (passed from App.jsx to avoid duplicate state)
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

  // Callbacks
  onOverlayDataSaved,
}) {

  // DERIVED STATE: Check for framing edits
  const hasFramingEdits = useMemo(() => {
    const hasCropEdits = keyframes.length > 2 || (
      keyframes.length === 2 &&
      (keyframes[0].x !== keyframes[1].x ||
       keyframes[0].y !== keyframes[1].y ||
       keyframes[0].width !== keyframes[1].width ||
       keyframes[0].height !== keyframes[1].height)
    );
    const hasTrimEdits = trimRange !== null;
    const hasSpeedEdits = Object.values(segmentSpeeds).some(speed => speed !== 1);
    const hasSegmentSplits = segmentBoundaries.length > 2;
    return hasCropEdits || hasTrimEdits || hasSpeedEdits || hasSegmentSplits;
  }, [keyframes, trimRange, segmentSpeeds, segmentBoundaries]);

  // Check if we have multiple clips (requires export before overlay)
  const hasMultipleClips = clips.length > 1;

  // DERIVED STATE: Effective overlay video (pass-through or rendered)
  const effectiveOverlayVideoUrl = useMemo(() => {
    if (overlayVideoUrl) return overlayVideoUrl;
    if (!hasMultipleClips && !hasFramingEdits && framingVideoUrl) return framingVideoUrl;
    return null;
  }, [overlayVideoUrl, hasMultipleClips, hasFramingEdits, framingVideoUrl]);

  const effectiveOverlayMetadata = useMemo(() => {
    if (overlayVideoMetadata) return overlayVideoMetadata;
    if (!hasMultipleClips && !hasFramingEdits && framingMetadata) return framingMetadata;
    return null;
  }, [overlayVideoMetadata, hasMultipleClips, hasFramingEdits, framingMetadata]);

  const effectiveOverlayFile = useMemo(() => {
    if (overlayVideoFile) return overlayVideoFile;
    if (!hasMultipleClips && !hasFramingEdits && framingVideoFile) return framingVideoFile;
    return null;
  }, [overlayVideoFile, hasMultipleClips, hasFramingEdits, framingVideoFile]);

  // Player detection for click-to-track feature
  const playerDetectionEnabled = editorMode === 'overlay' && isTimeInEnabledRegion(currentTime);

  // Toggle for showing/hiding player detection boxes (default: visible)
  const [showPlayerBoxes, setShowPlayerBoxes] = useState(true);

  const togglePlayerBoxes = useCallback(() => {
    setShowPlayerBoxes(prev => !prev);
  }, []);

  const enablePlayerBoxes = useCallback(() => {
    setShowPlayerBoxes(true);
  }, []);

  // Get detection data from the current highlight region (stored during framing export)
  // This replaces the old usePlayerDetection hook that fetched from a per-frame cache
  const regionDetectionData = useMemo(() => {
    if (!playerDetectionEnabled || !highlightRegions?.length) {
      return { detections: [], videoWidth: 0, videoHeight: 0, hasDetections: false };
    }

    // Find the current region based on currentTime
    // Note: regions use camelCase (startTime/endTime) from useHighlightRegions
    const currentRegion = highlightRegions.find(
      region => region.enabled && currentTime >= region.startTime && currentTime <= region.endTime
    );

    if (!currentRegion?.detections?.length) {
      return { detections: [], videoWidth: 0, videoHeight: 0, hasDetections: false };
    }

    // Find the closest detection timestamp to currentTime
    let closestDetection = null;
    let closestDistance = Infinity;

    for (const detection of currentRegion.detections) {
      const distance = Math.abs(detection.timestamp - currentTime);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDetection = detection;
      }
    }

    // Only show detections if within ~1 frame of a detection timestamp
    // This ensures boxes only appear when playhead is exactly at a detection point
    // (e.g., after clicking a green marker on the timeline)
    const DETECTION_DISPLAY_THRESHOLD = 0.05; // 50ms ≈ 1.5 frames at 30fps
    if (!closestDetection || closestDistance > DETECTION_DISPLAY_THRESHOLD) {
      return {
        detections: [],
        videoWidth: currentRegion.videoWidth || 0,
        videoHeight: currentRegion.videoHeight || 0,
        hasDetections: currentRegion.detections.some(d => d.boxes?.length > 0)
      };
    }

    return {
      detections: closestDetection.boxes || [],
      videoWidth: currentRegion.videoWidth || 0,
      videoHeight: currentRegion.videoHeight || 0,
      hasDetections: true
    };
  }, [playerDetectionEnabled, highlightRegions, currentTime]);

  const playerDetections = regionDetectionData.detections;
  const isDetectionLoading = false; // No longer loading from API
  const regionHasDetections = regionDetectionData.hasDetections;

  // DERIVED STATE: Current highlight state
  const currentHighlightState = useMemo(() => {
    if (dragHighlight) {
      return {
        x: dragHighlight.x,
        y: dragHighlight.y,
        radiusX: dragHighlight.radiusX,
        radiusY: dragHighlight.radiusY,
        opacity: dragHighlight.opacity,
        color: dragHighlight.color
      };
    }

    if (!isTimeInEnabledRegion(currentTime)) {
      return null;
    }

    const highlight = getRegionHighlightAtTime(currentTime);
    if (!highlight) return null;

    return {
      x: highlight.x,
      y: highlight.y,
      radiusX: highlight.radiusX,
      radiusY: highlight.radiusY,
      opacity: highlight.opacity,
      color: highlight.color
    };
  }, [dragHighlight, currentTime, isTimeInEnabledRegion, getRegionHighlightAtTime]);

  /**
   * Handle player selection from detection overlay
   */
  const handlePlayerSelect = useCallback((playerData) => {
    const region = getRegionAtTime(currentTime);
    if (!region) {
      console.warn('[OverlayContainer] No highlight region at current time');
      return;
    }

    const defaultOpacity = currentHighlightState?.opacity ?? 0.3;
    const defaultColor = currentHighlightState?.color ?? '#FFFF00';

    const highlight = {
      x: playerData.x,
      y: playerData.y,
      radiusX: playerData.radiusX,
      radiusY: playerData.radiusY,
      opacity: defaultOpacity,
      color: defaultColor,
      fromDetection: true,  // Mark keyframe as created from player detection
    };

    console.log('[OverlayContainer] Player detected, creating keyframe:', {
      time: currentTime,
      position: { x: playerData.x, y: playerData.y },
      region: { start: region.startTime, end: region.endTime }
    });

    addHighlightRegionKeyframe(currentTime, highlight, duration);
  }, [currentTime, duration, currentHighlightState, addHighlightRegionKeyframe, getRegionAtTime]);

  /**
   * Handle highlight changes during drag/resize
   */
  const handleHighlightChange = useCallback((newHighlight) => {
    setDragHighlight(newHighlight);
  }, []);

  /**
   * Handle highlight complete (create/update keyframe in enabled region)
   */
  const handleHighlightComplete = useCallback((highlightData) => {
    if (!isTimeInEnabledRegion(currentTime)) {
      console.warn('[OverlayContainer] Cannot add highlight keyframe - not in enabled region');
      setDragHighlight(null);
      return;
    }

    const frame = Math.round(currentTime * highlightRegionsFramerate);
    console.log(`[OverlayContainer] Highlight keyframe at ${currentTime.toFixed(2)}s (frame ${frame})`);

    addHighlightRegionKeyframe(currentTime, highlightData);
    setDragHighlight(null);
  }, [currentTime, highlightRegionsFramerate, isTimeInEnabledRegion, addHighlightRegionKeyframe]);

  /**
   * Handle transition from Framing to Overlay mode
   */
  const handleProceedToOverlay = useCallback(async (renderedVideoBlob, clipMetadata = null) => {
    try {
      const url = URL.createObjectURL(renderedVideoBlob);
      const meta = await extractVideoMetadata(renderedVideoBlob);

      if (overlayVideoUrl) {
        URL.revokeObjectURL(overlayVideoUrl);
      }

      setOverlayVideoFile(renderedVideoBlob);
      setOverlayVideoUrl(url);
      setOverlayVideoMetadata(meta);
      setOverlayClipMetadata(clipMetadata);

      // Reset highlight state for fresh start
      resetHighlightRegions();

      setEditorMode('overlay');

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          videoRef.current.pause();
        }
      }, 100);

      console.log('[OverlayContainer] Transitioned to Overlay mode:', {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        hasClipMetadata: !!clipMetadata,
      });
    } catch (err) {
      console.error('[OverlayContainer] Failed to transition to Overlay mode:', err);
      throw err;
    }
  }, [overlayVideoUrl, videoRef, resetHighlightRegions, setEditorMode]);

  /**
   * Save overlay data to backend (debounced)
   */
  const saveOverlayData = useCallback(async (data) => {
    if (!selectedProjectId || editorMode !== 'overlay') return;

    if (pendingOverlaySaveRef.current) {
      clearTimeout(pendingOverlaySaveRef.current);
    }

    pendingOverlaySaveRef.current = setTimeout(async () => {
      const saveProjectId = selectedProjectId;

      try {
        const formData = new FormData();
        formData.append('highlights_data', JSON.stringify(data.highlightRegions || []));
        formData.append('text_overlays', JSON.stringify(data.textOverlays || []));
        formData.append('effect_type', data.effectType || 'original');

        await fetch(`${API_BASE}/api/export/projects/${saveProjectId}/overlay-data`, {
          method: 'PUT',
          body: formData
        });

        console.log('[OverlayContainer] Overlay data saved for project:', saveProjectId);
        onOverlayDataSaved?.();
      } catch (e) {
        console.error('[OverlayContainer] Failed to save overlay data:', e);
      }
    }, 2000);
  }, [selectedProjectId, editorMode, onOverlayDataSaved]);

  // NOTE: Effects for highlight region initialization and persistence are in OverlayScreen.jsx
  // OverlayContainer only provides derived state and handlers to avoid duplicate effects

  return {
    // Video state
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayVideoFile,
    isLoadingWorkingVideo,
    effectiveOverlayVideoUrl,
    effectiveOverlayMetadata,
    effectiveOverlayFile,

    // Highlight regions
    highlightRegions,
    highlightBoundaries,
    highlightRegionKeyframes,
    highlightRegionsFramerate,
    currentHighlightState,

    // Highlight region actions
    addHighlightRegion,
    deleteHighlightRegion,
    moveHighlightRegionStart,
    moveHighlightRegionEnd,
    toggleHighlightRegion,
    addHighlightRegionKeyframe,
    removeHighlightRegionKeyframe,
    resetHighlightRegions,
    getRegionsForExport,
    isTimeInEnabledRegion,

    // Highlight effect
    highlightEffectType,
    setHighlightEffectType,
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,

    // Player detection (from highlight region data, not per-frame API)
    playerDetectionEnabled,
    playerDetections,
    isDetectionLoading,
    regionHasDetections,  // Whether current region has any detection data
    showPlayerBoxes,
    togglePlayerBoxes,
    enablePlayerBoxes,

    // Derived state
    hasFramingEdits,
    hasMultipleClips,

    // Handlers
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
    handleProceedToOverlay,

    // Persistence
    saveOverlayData,
    overlaySyncState,
    overlayLoadedProjectId,
    pendingOverlaySaveRef,

    // State setters (for external use)
    setOverlayVideoFile,
    setOverlayVideoUrl,
    setOverlayVideoMetadata,
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,
  };
}

/**
 * OverlayVideoOverlays - Video overlay components for Overlay mode
 */
export function OverlayVideoOverlays({
  effectiveOverlayVideoUrl,
  effectiveOverlayMetadata,
  currentHighlightState,
  onHighlightChange,
  onHighlightComplete,
  isTimeInEnabledRegion,
  currentTime,
  highlightEffectType,
  zoom,
  panOffset,
  videoRef,
  // Player detection (auto-detected during framing export - U8)
  playerDetectionEnabled,
  playerDetections,
  isDetectionLoading,
  showPlayerBoxes,
  onPlayerSelect,
}) {
  if (!effectiveOverlayVideoUrl) return null;

  // Show detection boxes if: enabled, has detections, and boxes are toggled on
  const shouldShowDetections = playerDetectionEnabled && playerDetections?.length > 0 && showPlayerBoxes;

  return (
    <>
      {/* Highlight overlay */}
      {currentHighlightState && effectiveOverlayMetadata && (
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
      )}

      {/* Player detection overlay - shows boxes when detected (auto-detection from framing export) */}
      {effectiveOverlayMetadata && shouldShowDetections && (
        <PlayerDetectionOverlay
          key="player-detection"
          videoRef={videoRef}
          videoMetadata={effectiveOverlayMetadata}
          detections={playerDetections}
          isLoading={isDetectionLoading}
          onPlayerSelect={onPlayerSelect}
          zoom={zoom}
          panOffset={panOffset}
        />
      )}
    </>
  );
}

/**
 * OverlayTimeline - Timeline component for Overlay mode
 */
export function OverlayTimeline({
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  highlightRegions,
  highlightBoundaries,
  highlightKeyframes,
  highlightFramerate,
  onAddHighlightRegion,
  onDeleteHighlightRegion,
  onMoveHighlightRegionStart,
  onMoveHighlightRegionEnd,
  onRemoveHighlightKeyframe,
  onToggleHighlightRegion,
  onSelectedKeyframeChange,
  onHighlightChange,
  onHighlightComplete,
  zoom,
  panOffset,
  visualDuration,
  selectedLayer,
  onLayerSelect,
  onSeek,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  trimRange,
  isPlaying,
}) {
  return (
    <OverlayMode
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      currentTime={currentTime}
      duration={duration}
      highlightRegions={highlightRegions}
      highlightBoundaries={highlightBoundaries}
      highlightKeyframes={highlightKeyframes}
      highlightFramerate={highlightFramerate}
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
      visualDuration={visualDuration}
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
      onSeek={onSeek}
      sourceTimeToVisualTime={sourceTimeToVisualTime}
      visualTimeToSourceTime={visualTimeToSourceTime}
      timelineZoom={timelineZoom}
      onTimelineZoomByWheel={onTimelineZoomByWheel}
      timelineScale={timelineScale}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineScrollPositionChange={onTimelineScrollPositionChange}
      trimRange={trimRange}
      isPlaying={isPlaying}
    />
  );
}

export default OverlayContainer;
