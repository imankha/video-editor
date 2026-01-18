import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OverlayModeView } from '../modes';
import { OverlayContainer } from '../containers';
import { useHighlight, useHighlightRegions, useOverlayState } from '../modes/overlay';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import useTimelineZoom from '../hooks/useTimelineZoom';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { API_BASE } from '../config';
import { useProject } from '../contexts/ProjectContext';
import { useNavigationStore } from '../stores/navigationStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useExportStore } from '../stores/exportStore';

/**
 * OverlayScreen - Self-contained screen for Overlay mode
 *
 * This component owns all overlay-specific hooks and state:
 * - useOverlayState - consolidated overlay interaction state
 * - useHighlight - highlight keyframe management
 * - useHighlightRegions - highlight region management
 * - useVideo - video playback (without segment awareness)
 * - useZoom - video zoom/pan
 * - useTimelineZoom - timeline zoom
 * - OverlayContainer - overlay logic and handlers
 *
 * Data Sources:
 * - Project context (projectId, project)
 * - overlayStore (working video set by FramingScreen export)
 * - projectDataStore (clips for pass-through mode)
 * - framingStore (for detecting uncommitted framing changes)
 *
 * @see AppJSX_REDUCTION/TASK-04-self-contained-overlay-screen.md
 */
export function OverlayScreen({
  // Export callback (legacy - will be moved to store in Task 07)
  onExportComplete,
}) {
  // Navigation
  const navigate = useNavigationStore(state => state.navigate);

  // Project context
  const { projectId, project, refresh: refreshProject } = useProject();

  // Overlay store - working video (set by FramingScreen on export)
  const {
    workingVideo,
    clipMetadata: overlayClipMetadata,
    effectType: highlightEffectType,
    isLoadingWorkingVideo,
    isDataLoaded,
    setWorkingVideo,
    setClipMetadata: setOverlayClipMetadata,
    setEffectType: setHighlightEffectType,
    setIsLoadingWorkingVideo,
    setIsDataLoaded,
  } = useOverlayStore();

  // Project data store - for framing clips (pass-through mode)
  const clips = useProjectDataStore(state => state.clips);
  const hasClips = clips && clips.length > 0;

  // Framing store - for detecting uncommitted changes
  const hasChangedSinceExport = useFramingStore(state => state.hasChangedSinceExport);

  // Export store - for dismissing "export complete" toast on changes
  const dismissExportCompleteToast = useExportStore(state => state.dismissExportCompleteToast);

  // Local overlay state (drag, selection, etc.)
  const overlayState = useOverlayState();
  const {
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,
    pendingOverlaySaveRef,
    overlayDataLoadedRef,
  } = overlayState;

  // Local state
  const [selectedLayer, setSelectedLayer] = useState('playhead');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const exportButtonRef = useRef(null);
  const fullscreenContainerRef = useRef(null);
  const videoLoadedFromUrlRef = useRef(null); // Track which URL we've loaded to prevent infinite loops

  // =========================================
  // DETERMINE EFFECTIVE VIDEO SOURCE
  // =========================================

  // Get framing video data from clips (for pass-through mode - only used when no working video)
  const framingVideoUrl = clips[0]?.fileUrl || clips[0]?.url;
  const framingMetadata = clips[0]?.metadata;
  const framingVideoFile = clips[0]?.file;

  // Determine if we should wait for working video (don't use original clip as fallback)
  // If project has a working_video_id but workingVideo is null, we're loading it
  const shouldWaitForWorkingVideo = !workingVideo && (project?.working_video_id || isLoadingWorkingVideo);

  // Effective video: working video from store, or fallback to framing video only if no working video exists
  const effectiveOverlayVideoUrl = workingVideo?.url || (shouldWaitForWorkingVideo ? null : framingVideoUrl);
  const effectiveOverlayMetadata = workingVideo?.metadata || (shouldWaitForWorkingVideo ? null : framingMetadata);
  const effectiveOverlayFile = workingVideo?.file || (shouldWaitForWorkingVideo ? null : framingVideoFile);

  // =========================================
  // VIDEO HOOK - Without segment awareness for overlay mode
  // =========================================

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

  // =========================================
  // HIGHLIGHT HOOKS - OWNED BY THIS SCREEN
  // =========================================

  // Highlight hook - for keyframe-based highlighting (not region-based)
  const {
    keyframes: highlightKeyframes,
    framerate: highlightFramerate,
    isEnabled: isHighlightEnabled,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    deleteKeyframesInRange: deleteHighlightKeyframesInRange,
    cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    getHighlightDataAtTime,
    reset: resetHighlight,
  } = useHighlight(effectiveOverlayMetadata, null);

  // Highlight regions hook - boundary-based system (like segments)
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
  } = useHighlightRegions(effectiveOverlayMetadata);

  // =========================================
  // ZOOM HOOKS
  // =========================================

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

  // =========================================
  // INITIALIZATION - Load working video if needed
  // =========================================

  useEffect(() => {
    // If no working video in store but project has one, load it
    if (!workingVideo && project?.working_video_id && !isLoadingWorkingVideo) {
      setIsLoadingWorkingVideo(true);

      (async () => {
        try {
          console.log('[OverlayScreen] Loading working video from project');
          const response = await fetch(`${API_BASE}/api/projects/${projectId}/working-video`);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], 'working_video.mp4', { type: 'video/mp4' });
            const url = URL.createObjectURL(file);
            const meta = await extractVideoMetadata(file);
            setWorkingVideo({ file, url, metadata: meta });
          }
        } catch (err) {
          console.error('[OverlayScreen] Failed to load working video:', err);
        } finally {
          setIsLoadingWorkingVideo(false);
        }
      })();
    }
  }, [workingVideo, project?.working_video_id, projectId, isLoadingWorkingVideo, setIsLoadingWorkingVideo, setWorkingVideo]);

  // Load video into useVideo hook when effectiveOverlayVideoUrl is available
  // Uses a ref to track the source URL to prevent infinite loops (blob URLs are always unique)
  useEffect(() => {
    if (effectiveOverlayVideoUrl && effectiveOverlayVideoUrl !== videoLoadedFromUrlRef.current) {
      console.log('[OverlayScreen] Loading video from URL:', effectiveOverlayVideoUrl.substring(0, 50));
      videoLoadedFromUrlRef.current = effectiveOverlayVideoUrl;
      loadVideoFromUrl(effectiveOverlayVideoUrl, 'overlay_video.mp4');
    }
  }, [effectiveOverlayVideoUrl, loadVideoFromUrl]);

  // Initialize highlight regions when duration available
  useEffect(() => {
    const highlightDuration = effectiveOverlayMetadata?.duration || duration;
    if (highlightDuration && highlightDuration > 0) {
      initializeHighlightRegions(highlightDuration);
    }
  }, [effectiveOverlayMetadata?.duration, duration, initializeHighlightRegions]);

  // Auto-create highlight regions from clip metadata (from framing export)
  // This runs when transitioning from framing to overlay after a fresh export
  // It takes priority over loading saved overlay data (which would be stale)
  useEffect(() => {
    if (overlayClipMetadata && effectiveOverlayMetadata) {
      // Reset any existing regions first - clip metadata means fresh framing export
      resetHighlightRegions();

      const count = initializeHighlightRegionsFromClips(
        overlayClipMetadata,
        effectiveOverlayMetadata.width,
        effectiveOverlayMetadata.height
      );

      if (count > 0) {
        console.log(`[OverlayScreen] Auto-created ${count} highlight regions from clip metadata`);
      }

      // Mark data as loaded to prevent overlay data fetch from overwriting
      overlayDataLoadedRef.current = true;
      setIsDataLoaded(true);

      // Clear clip metadata after processing to prevent re-triggering
      setOverlayClipMetadata(null);
    }
  }, [overlayClipMetadata, effectiveOverlayMetadata, initializeHighlightRegionsFromClips, setOverlayClipMetadata, resetHighlightRegions, setIsDataLoaded]);

  // Fallback: Create default highlight region if no regions exist after loading
  // This handles the case where user navigates to overlay mode without clip metadata
  useEffect(() => {
    // Only run after data loading is complete and if we have no regions
    if (isDataLoaded && highlightRegions.length === 0 && !overlayClipMetadata && effectiveOverlayMetadata?.duration > 0) {
      console.log('[OverlayScreen] No highlight regions - creating default for first 2 seconds');
      addHighlightRegion(0); // Creates 2-second region starting at 0
    }
  }, [isDataLoaded, highlightRegions.length, overlayClipMetadata, effectiveOverlayMetadata?.duration, addHighlightRegion]);

  // =========================================
  // OVERLAY DATA PERSISTENCE
  // =========================================

  // Load overlay data from backend
  // Skip if we have fresh clip metadata (from framing export) - that takes priority
  useEffect(() => {
    const effectiveDuration = effectiveOverlayMetadata?.duration;
    // Don't load saved overlay data if we have fresh clip metadata from framing export
    if (projectId && !overlayDataLoadedRef.current && effectiveDuration && !overlayClipMetadata) {
      (async () => {
        try {
          console.log('[OverlayScreen] Loading overlay data for project:', projectId);
          const response = await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`);
          const data = await response.json();

          if (data.has_data && data.highlights_data?.length > 0) {
            restoreHighlightRegions(data.highlights_data, effectiveDuration);
            console.log('[OverlayScreen] Restored', data.highlights_data.length, 'highlight regions');
          }
          if (data.effect_type) {
            setHighlightEffectType(data.effect_type);
          }

          overlayDataLoadedRef.current = true;
          setIsDataLoaded(true);
        } catch (err) {
          console.error('[OverlayScreen] Failed to load overlay data:', err);
        }
      })();
    }
  }, [projectId, effectiveOverlayMetadata?.duration, restoreHighlightRegions, setHighlightEffectType, setIsDataLoaded, overlayClipMetadata]);

  // Save overlay data to backend (debounced)
  const saveOverlayData = useCallback(async () => {
    if (!projectId) return;

    // Cancel any pending save
    if (pendingOverlaySaveRef.current) {
      clearTimeout(pendingOverlaySaveRef.current);
    }

    // Debounce: wait 2 seconds after last change
    pendingOverlaySaveRef.current = setTimeout(async () => {
      try {
        const formData = new FormData();
        formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
        formData.append('text_overlays', JSON.stringify([]));
        formData.append('effect_type', highlightEffectType || 'original');

        await fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`, {
          method: 'PUT',
          body: formData
        });

        console.log('[OverlayScreen] Overlay data saved');
      } catch (err) {
        console.error('[OverlayScreen] Failed to save overlay data:', err);
      }
    }, 2000);
  }, [projectId, getRegionsForExport, highlightEffectType]);

  // Auto-save on changes
  useEffect(() => {
    if (overlayDataLoadedRef.current && projectId) {
      saveOverlayData();
    }
  }, [highlightRegions, highlightEffectType, projectId, saveOverlayData]);

  // Dismiss "export complete" toast when user makes changes
  // This lets users know they need to re-export after modifying highlights
  useEffect(() => {
    if (overlayDataLoadedRef.current) {
      dismissExportCompleteToast();
    }
  }, [highlightRegions, highlightEffectType, dismissExportCompleteToast]);

  // Save before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingOverlaySaveRef.current) {
        clearTimeout(pendingOverlaySaveRef.current);
        pendingOverlaySaveRef.current = null;

        if (projectId) {
          const formData = new FormData();
          formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
          formData.append('text_overlays', JSON.stringify([]));
          formData.append('effect_type', highlightEffectType || 'original');
          fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`, {
            method: 'PUT',
            body: formData,
            keepalive: true
          }).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [projectId, getRegionsForExport, highlightEffectType]);

  // =========================================
  // OVERLAY CONTAINER - Encapsulates overlay logic
  // =========================================

  // Determine if we have framing edits (clips modified or multiple clips)
  const hasFramingEdits = useMemo(() => {
    if (!hasClips) return false;
    // Multiple clips means there were edits to combine them
    if (clips.length > 1) return true;
    // Check if single clip has segments or crop modifications
    const firstClip = clips[0];
    if (firstClip?.segments) {
      const { boundaries, segmentSpeeds, trimRange } = firstClip.segments;
      if (boundaries?.length > 2 || Object.keys(segmentSpeeds || {}).length > 0 || trimRange) {
        return true;
      }
    }
    if (firstClip?.cropKeyframes?.length > 0) return true;
    return false;
  }, [hasClips, clips]);

  const hasMultipleClips = clips.length > 1;

  const overlay = OverlayContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    seek,
    framingVideoUrl,
    framingMetadata,
    framingVideoFile,
    keyframes: [], // No framing keyframes in overlay mode
    segments: null,
    segmentSpeeds: {},
    segmentBoundaries: [],
    trimRange: null,
    selectedProjectId: projectId,
    selectedProject: project,
    clips,
    hasClips,
    editorMode: 'overlay',
    setEditorMode: () => {},
    setSelectedLayer,
    overlayVideoFile: workingVideo?.file,
    overlayVideoUrl: workingVideo?.url,
    overlayVideoMetadata: workingVideo?.metadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    setOverlayVideoFile: (file) => setWorkingVideo(prev => prev ? { ...prev, file } : { file, url: null, metadata: null }),
    setOverlayVideoUrl: (url) => setWorkingVideo(prev => prev ? { ...prev, url } : { file: null, url, metadata: null }),
    setOverlayVideoMetadata: (meta) => setWorkingVideo(prev => prev ? { ...prev, metadata: meta } : { file: null, url: null, metadata: meta }),
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
    showPlayerBoxes,
    togglePlayerBoxes,
    handlePlayerSelect,
    handleHighlightChange,
    handleHighlightComplete,
  } = overlay;

  // =========================================
  // KEYBOARD SHORTCUTS
  // =========================================

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

  // =========================================
  // FULLSCREEN HANDLER
  // =========================================

  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // =========================================
  // HANDLERS
  // =========================================

  const handleSwitchToFraming = useCallback(() => {
    // Flush any pending saves
    if (pendingOverlaySaveRef.current) {
      clearTimeout(pendingOverlaySaveRef.current);
      pendingOverlaySaveRef.current = null;
      // Immediate save
      if (projectId) {
        const formData = new FormData();
        formData.append('highlights_data', JSON.stringify(getRegionsForExport() || []));
        formData.append('text_overlays', JSON.stringify([]));
        formData.append('effect_type', highlightEffectType || 'original');
        fetch(`${API_BASE}/api/export/projects/${projectId}/overlay-data`, {
          method: 'PUT',
          body: formData
        }).catch(e => console.error('[OverlayScreen] Failed to flush overlay save:', e));
      }
    }
    navigate('framing');
  }, [navigate, projectId, getRegionsForExport, highlightEffectType]);

  const handleBackToProjects = useCallback(() => {
    navigate('project-manager');
  }, [navigate]);

  const handleExportComplete = useCallback(() => {
    refreshProject();
    if (onExportComplete) {
      onExportComplete();
    }
  }, [refreshProject, onExportComplete]);

  // =========================================
  // RENDER
  // =========================================

  return (
    <OverlayModeView
      // Fullscreen
      fullscreenContainerRef={fullscreenContainerRef}
      isFullscreen={isFullscreen}
      onToggleFullscreen={handleToggleFullscreen}
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
      showPlayerBoxes={showPlayerBoxes}
      onTogglePlayerBoxes={togglePlayerBoxes}
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
      includeAudio={true} // Default to true for overlay mode
      onIncludeAudioChange={() => {}} // Overlay mode doesn't support audio toggle
      onExportComplete={handleExportComplete}
      // Mode switching
      onSwitchToFraming={handleSwitchToFraming}
      hasFramingEdits={hasFramingEdits}
      hasMultipleClips={hasMultipleClips}
      framingVideoUrl={framingVideoUrl}
    />
  );
}

export default OverlayScreen;
