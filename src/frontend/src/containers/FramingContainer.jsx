import { useEffect, useCallback, useMemo, useRef } from 'react';
import { useCrop, useSegments, FramingMode, CropOverlay } from '../modes/framing';
import { useClipManager } from '../hooks/useClipManager';

/**
 * FramingContainer - Encapsulates all Framing mode logic and UI
 *
 * This container manages:
 * - Crop keyframe management (add, update, delete, interpolate)
 * - Segment management (split, trim, speed control)
 * - Multi-clip workflow (clip switching, state persistence)
 * - Auto-save of framing edits to backend
 * - Copy/paste crop keyframes
 *
 * @param {Object} props - Dependencies from App.jsx
 * @see APP_REFACTOR_PLAN.md Task 3.3 for refactoring context
 */
export function FramingContainer({
  // Video element ref and state
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  framerate,
  isPlaying,
  seek,

  // Project context
  selectedProjectId,
  selectedProject,

  // Editor mode
  editorMode,

  // Highlight hook (for coordinated trim operations)
  highlightHook,

  // Callbacks
  onCropChange,
  onUserEdit,
}) {
  // Crop management hook
  const {
    keyframes,
    aspectRatio,
    isEndKeyframeExplicit,
    copiedCrop,
    initialize: initializeCrop,
    reset: resetCrop,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    getCropDataAtTime,
    interpolateCrop,
    hasKeyframeAt,
    getKeyframesForExport,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    restoreState: restoreCropState,
    updateAspectRatio,
  } = useCrop(metadata, null);

  // Segment management hook
  const {
    segments,
    boundaries: segmentBoundaries,
    segmentSpeeds,
    trimRange,
    setTrimRange,
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    getSegmentAtTime,
    addSplit,
    removeSplit,
    setSegmentSpeed,
    toggleTrimSegment,
    detrimStart,
    detrimEnd,
    getExportData: getSegmentExportData,
    clampToVisibleRange,
    restoreState: restoreSegmentState,
  } = useSegments();

  // Clip management
  const {
    clips,
    selectedClipId,
    selectedClip,
    selectedClipIndex,
    hasClips,
    globalAspectRatio,
    globalTransition,
    addClip,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getExportData: getClipExportData,
    calculateCenteredCrop,
  } = useClipManager();

  // Refs for auto-save debouncing
  const pendingFramingSaveRef = useRef(null);
  const clipHasUserEditsRef = useRef(false);

  // DERIVED STATE: Current crop state at playhead
  const currentCropState = useMemo(() => {
    if (!metadata) return null;
    return getCropDataAtTime(currentTime);
  }, [metadata, currentTime, getCropDataAtTime]);

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

  /**
   * Clips with current clip's live state merged.
   * Since clip state (keyframes, segments) is managed in useCrop/useSegments hooks,
   * we need to merge the current clip's live state before export.
   */
  const clipsWithCurrentState = useMemo(() => {
    if (!hasClips || !clips || !selectedClipId) return clips;

    const convertKeyframesToTime = (kfs, clipFramerate) => {
      if (!kfs || !Array.isArray(kfs)) return [];
      return kfs.map(kf => {
        if (kf.time !== undefined) return kf;
        const time = kf.frame / clipFramerate;
        const { frame, ...rest } = kf;
        return { time, ...rest };
      });
    };

    const calculateDefaultCrop = (sourceWidth, sourceHeight, targetAspectRatio) => {
      if (!sourceWidth || !sourceHeight) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
      const targetRatio = ratioW / ratioH;
      const videoRatio = sourceWidth / sourceHeight;

      let cropWidth, cropHeight;
      if (videoRatio > targetRatio) {
        cropHeight = sourceHeight;
        cropWidth = cropHeight * targetRatio;
      } else {
        cropWidth = sourceWidth;
        cropHeight = cropWidth / targetRatio;
      }

      const x = (sourceWidth - cropWidth) / 2;
      const y = (sourceHeight - cropHeight) / 2;

      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(cropWidth),
        height: Math.round(cropHeight)
      };
    };

    const currentClipExportKeyframes = getKeyframesForExport();

    return clips.map(clip => {
      if (clip.id === selectedClipId) {
        return {
          ...clip,
          cropKeyframes: currentClipExportKeyframes,
          segments: {
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: trimRange
          },
          trimRange: trimRange
        };
      }

      let convertedKeyframes = convertKeyframesToTime(clip.cropKeyframes, clip.framerate || 30);

      if (convertedKeyframes.length === 0 && clip.sourceWidth && clip.sourceHeight && clip.duration) {
        const defaultCrop = calculateDefaultCrop(clip.sourceWidth, clip.sourceHeight, globalAspectRatio);
        convertedKeyframes = [
          { time: 0, ...defaultCrop },
          { time: clip.duration, ...defaultCrop }
        ];
      }

      return {
        ...clip,
        cropKeyframes: convertedKeyframes
      };
    });
  }, [clips, selectedClipId, getKeyframesForExport, segmentBoundaries, segmentSpeeds, trimRange, hasClips, globalAspectRatio]);

  /**
   * Save current clip's framing state to backend
   */
  const saveCurrentClipState = useCallback(async () => {
    if (!selectedClipId || !selectedProjectId) return;

    const currentClip = clips.find(c => c.id === selectedClipId);
    if (!currentClip?.workingClipId) return;

    const segmentState = {
      boundaries: segmentBoundaries,
      segmentSpeeds: segmentSpeeds,
      trimRange: trimRange,
    };

    try {
      const formData = new FormData();
      formData.append('crop_data', JSON.stringify(keyframes));
      formData.append('segments_data', JSON.stringify(segmentState));
      formData.append('timing_data', JSON.stringify({ trimRange }));

      await fetch(
        `http://localhost:8000/api/clips/projects/${selectedProjectId}/clips/${currentClip.workingClipId}`,
        {
          method: 'PUT',
          body: formData
        }
      );

      console.log('[FramingContainer] Saved framing state for clip:', currentClip.workingClipId);
    } catch (e) {
      console.error('[FramingContainer] Failed to save framing state:', e);
    }
  }, [selectedClipId, selectedProjectId, clips, keyframes, segmentBoundaries, segmentSpeeds, trimRange]);

  /**
   * Auto-save framing edits (debounced)
   */
  const autoSaveFramingEdits = useCallback(async () => {
    if (!selectedClipId || editorMode !== 'framing') return;

    if (pendingFramingSaveRef.current) {
      clearTimeout(pendingFramingSaveRef.current);
    }

    pendingFramingSaveRef.current = setTimeout(async () => {
      await saveCurrentClipState();
    }, 2000);
  }, [selectedClipId, editorMode, saveCurrentClipState]);

  /**
   * Handle crop changes during drag/resize (live preview)
   */
  const handleCropChange = useCallback((newCrop) => {
    onCropChange?.(newCrop);
  }, [onCropChange]);

  /**
   * Handle crop complete (create keyframe)
   */
  const handleCropComplete = useCallback((cropData) => {
    const frame = Math.round(currentTime * framerate);
    console.log(`[FramingContainer] Crop at ${currentTime.toFixed(2)}s (frame ${frame})`);

    clipHasUserEditsRef.current = true;
    addOrUpdateKeyframe(currentTime, cropData, duration);
    onCropChange?.(null);
    onUserEdit?.();
  }, [currentTime, framerate, duration, addOrUpdateKeyframe, onCropChange, onUserEdit]);

  /**
   * Coordinated segment trim handler
   */
  const handleTrimSegment = useCallback((segmentIndex) => {
    if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

    clipHasUserEditsRef.current = true;

    const segment = segments[segmentIndex];
    const isCurrentlyTrimmed = segment.isTrimmed;

    console.log(`[FramingContainer] Trim segment ${segmentIndex}`);

    if (!isCurrentlyTrimmed) {
      // We're about to trim this segment
      let boundaryTime;

      if (segment.isLast) {
        boundaryTime = segment.start;
      } else if (segment.isFirst) {
        boundaryTime = segment.end;
      }

      // Find crop data to preserve
      let cropDataToPreserve = null;
      for (let i = keyframes.length - 1; i >= 0; i--) {
        const kfTime = keyframes[i].frame / framerate;
        if (kfTime >= segment.start && kfTime <= segment.end) {
          cropDataToPreserve = getCropDataAtTime(kfTime);
          break;
        }
      }

      if (!cropDataToPreserve) {
        const edgeTime = segment.isLast ? segment.end : segment.start;
        cropDataToPreserve = getCropDataAtTime(edgeTime);
      }

      // Delete crop keyframes in trimmed range
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Reconstitute permanent keyframe at boundary
      if (cropDataToPreserve && boundaryTime !== undefined) {
        addOrUpdateKeyframe(boundaryTime, cropDataToPreserve, duration, 'permanent');
      }

      // Handle highlight keyframes if available
      if (highlightHook) {
        const highlightDataToPreserve = highlightHook.getHighlightDataAtTime?.(
          segment.isLast ? segment.end : segment.start
        );
        highlightHook.deleteKeyframesInRange?.(segment.start, segment.end, duration);
        if (highlightDataToPreserve && boundaryTime !== undefined) {
          highlightHook.addOrUpdateKeyframe?.(boundaryTime, highlightDataToPreserve, duration, 'permanent');
        }
      }
    }

    toggleTrimSegment(segmentIndex);
    onUserEdit?.();
  }, [duration, segments, keyframes, framerate, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, toggleTrimSegment, highlightHook, onUserEdit]);

  /**
   * Coordinated de-trim handler for start
   */
  const handleDetrimStart = useCallback(() => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);

    // Handle crop keyframes
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    if (boundaryFrame > 0) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(0, cropDataAtBoundary, duration, 'permanent');
    }

    // Handle highlight keyframes if available
    if (highlightHook) {
      const highlightDataAtBoundary = highlightHook.getHighlightDataAtTime?.(boundaryTime);
      if (boundaryFrame > 0) {
        const highlightKfAtBoundary = highlightHook.keyframes?.find(kf => kf.frame === boundaryFrame);
        if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
          highlightHook.deleteKeyframesInRange?.(boundaryTime - 0.001, boundaryTime + 0.001, duration);
        }
      }
      if (highlightDataAtBoundary) {
        highlightHook.addOrUpdateKeyframe?.(0, highlightDataAtBoundary, duration, 'permanent');
      }
    }

    detrimStart();
    onUserEdit?.();
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, detrimStart, highlightHook, onUserEdit]);

  /**
   * Coordinated de-trim handler for end
   */
  const handleDetrimEnd = useCallback(() => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);

    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    if (boundaryFrame < endFrame) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(duration, cropDataAtBoundary, duration, 'permanent');
    }

    // Handle highlight keyframes if available
    if (highlightHook) {
      const highlightDataAtBoundary = highlightHook.getHighlightDataAtTime?.(boundaryTime);
      const highlightDuration = highlightHook.duration || duration;
      const highlightEndFrame = Math.round(highlightDuration * (highlightHook.framerate || 30));

      if (boundaryFrame < highlightEndFrame) {
        const highlightKfAtBoundary = highlightHook.keyframes?.find(kf => kf.frame === boundaryFrame);
        if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
          highlightHook.deleteKeyframesInRange?.(boundaryTime - 0.001, boundaryTime + 0.001, duration);
        }
      }
      if (highlightDataAtBoundary && boundaryTime < highlightDuration) {
        highlightHook.addOrUpdateKeyframe?.(highlightDuration, highlightDataAtBoundary, duration, 'permanent');
      }
    }

    detrimEnd();
    onUserEdit?.();
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, detrimEnd, highlightHook, onUserEdit]);

  /**
   * Handle keyframe click (seek to keyframe time)
   */
  const handleKeyframeClick = useCallback((time, index) => {
    seek(time);
  }, [seek]);

  /**
   * Handle keyframe delete
   */
  const handleKeyframeDelete = useCallback((time) => {
    clipHasUserEditsRef.current = true;
    removeKeyframe(time, duration);
    onUserEdit?.();
  }, [duration, removeKeyframe, onUserEdit]);

  /**
   * Handler for copy crop at current time
   */
  const handleCopyCrop = useCallback((time = currentTime) => {
    if (videoUrl) {
      copyCropKeyframe(time);
    }
  }, [videoUrl, currentTime, copyCropKeyframe]);

  /**
   * Handler for paste crop at current time
   */
  const handlePasteCrop = useCallback((time = currentTime) => {
    if (videoUrl && copiedCrop) {
      pasteCropKeyframe(time, duration);
      onUserEdit?.();
    }
  }, [videoUrl, currentTime, copiedCrop, duration, pasteCropKeyframe, onUserEdit]);

  /**
   * Get filtered keyframes for export (handles trim range)
   */
  const getFilteredKeyframesForExport = useMemo(() => {
    const allKeyframes = getKeyframesForExport();
    const segmentData = getSegmentExportData();

    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    return [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];
  }, [getKeyframesForExport, getSegmentExportData, duration]);

  // Effect: Auto-cleanup trim keyframes when trimRange is cleared
  const prevTrimRangeRef = useRef(undefined);
  useEffect(() => {
    if (prevTrimRangeRef.current !== undefined && prevTrimRangeRef.current !== null && trimRange === null) {
      cleanupTrimKeyframes();
      highlightHook?.cleanupTrimKeyframes?.();
    }
    prevTrimRangeRef.current = trimRange;
  }, [trimRange, cleanupTrimKeyframes, highlightHook]);

  // Effect: Auto-reposition playhead when it becomes invalid after trim
  const lastSeekTimeRef = useRef(null);
  useEffect(() => {
    if (!trimRange || !videoUrl) return;

    const isPlayheadInvalid = currentTime < trimRange.start || currentTime > trimRange.end;

    if (isPlayheadInvalid) {
      const validTime = clampToVisibleRange(currentTime);
      const threshold = 0.001;
      const needsSeek = lastSeekTimeRef.current === null ||
                        Math.abs(validTime - lastSeekTimeRef.current) > threshold;

      if (needsSeek) {
        lastSeekTimeRef.current = validTime;
        seek(validTime);
      }
    }
  }, [trimRange, currentTime, videoUrl, clampToVisibleRange, seek]);

  // Effect: Reset user edit tracking when clip selection changes
  useEffect(() => {
    clipHasUserEditsRef.current = false;
  }, [selectedClipId]);

  // Effect: Auto-save framing data when keyframes/segments change
  useEffect(() => {
    if (editorMode !== 'framing' || !selectedClipId || !selectedProjectId) return;

    const currentClip = clips.find(c => c.id === selectedClipId);
    const clipHadSavedData = currentClip && (
      (currentClip.cropKeyframes && currentClip.cropKeyframes.length > 0) ||
      (currentClip.segments && Object.keys(currentClip.segments).length > 0 &&
        (currentClip.segments.userSplits?.length > 0 || Object.keys(currentClip.segments.segmentSpeeds || {}).length > 0)) ||
      currentClip.trimRange != null
    );

    if (clipHasUserEditsRef.current || clipHadSavedData) {
      autoSaveFramingEdits();
    }
  }, [keyframes, segmentBoundaries, segmentSpeeds, trimRange, editorMode, selectedClipId, selectedProjectId, autoSaveFramingEdits, clips]);

  return {
    // Crop state
    keyframes,
    aspectRatio,
    isEndKeyframeExplicit,
    copiedCrop,
    currentCropState,

    // Crop actions
    initializeCrop,
    resetCrop,
    addOrUpdateKeyframe,
    removeKeyframe,
    copyCropKeyframe,
    pasteCropKeyframe,
    getCropDataAtTime,
    interpolateCrop,
    hasKeyframeAt,
    getKeyframesForExport,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    restoreCropState,
    updateAspectRatio,

    // Segment state
    segments,
    segmentBoundaries,
    segmentSpeeds,
    trimRange,

    // Segment actions
    initializeSegments,
    resetSegments,
    getSegmentAtTime,
    addSplit,
    removeSplit,
    setSegmentSpeed,
    toggleTrimSegment,
    detrimStart,
    detrimEnd,
    getSegmentExportData,
    clampToVisibleRange,
    restoreSegmentState,

    // Clip state
    clips,
    selectedClipId,
    selectedClip,
    selectedClipIndex,
    hasClips,
    globalAspectRatio,
    globalTransition,

    // Clip actions
    addClip,
    deleteClip,
    selectClip,
    reorderClips,
    updateClipData,
    setGlobalAspectRatio,
    setGlobalTransition,
    getClipExportData,
    calculateCenteredCrop,

    // Derived state
    hasFramingEdits,
    clipsWithCurrentState,
    getFilteredKeyframesForExport,

    // Handlers
    handleCropChange,
    handleCropComplete,
    handleTrimSegment,
    handleDetrimStart,
    handleDetrimEnd,
    handleKeyframeClick,
    handleKeyframeDelete,
    handleCopyCrop,
    handlePasteCrop,

    // Persistence
    saveCurrentClipState,
    autoSaveFramingEdits,
    pendingFramingSaveRef,
    clipHasUserEditsRef,
  };
}

/**
 * FramingVideoOverlay - Crop overlay component for Framing mode
 */
export function FramingVideoOverlay({
  videoRef,
  metadata,
  currentCropState,
  onCropChange,
  onCropComplete,
  aspectRatio,
  zoom,
  panOffset,
  dragCrop,
}) {
  if (!metadata || !currentCropState) return null;

  return (
    <CropOverlay
      videoRef={videoRef}
      videoMetadata={metadata}
      currentCrop={dragCrop || currentCropState}
      onCropChange={onCropChange}
      onCropComplete={onCropComplete}
      aspectRatio={aspectRatio}
      zoom={zoom}
      panOffset={panOffset}
    />
  );
}

/**
 * FramingTimeline - Timeline component for Framing mode
 */
export function FramingTimeline({
  videoRef,
  videoUrl,
  metadata,
  currentTime,
  duration,
  keyframes,
  framerate,
  segments,
  trimRange,
  onKeyframeClick,
  onKeyframeDelete,
  onAddSplit,
  onRemoveSplit,
  onTrimSegment,
  onDetrimStart,
  onDetrimEnd,
  onSegmentSpeedChange,
  selectedLayer,
  onLayerSelect,
  selectedCropKeyframeIndex,
  onSeek,
  zoom,
  panOffset,
  visualDuration,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  timelineZoom,
  onTimelineZoomByWheel,
  timelineScale,
  timelineScrollPosition,
  onTimelineScrollPositionChange,
  isPlaying,
}) {
  return (
    <FramingMode
      videoRef={videoRef}
      videoUrl={videoUrl}
      metadata={metadata}
      currentTime={currentTime}
      duration={duration}
      keyframes={keyframes}
      framerate={framerate}
      segments={segments}
      trimRange={trimRange}
      onKeyframeClick={onKeyframeClick}
      onKeyframeDelete={onKeyframeDelete}
      onAddSplit={onAddSplit}
      onRemoveSplit={onRemoveSplit}
      onTrimSegment={onTrimSegment}
      onDetrimStart={onDetrimStart}
      onDetrimEnd={onDetrimEnd}
      onSegmentSpeedChange={onSegmentSpeedChange}
      selectedLayer={selectedLayer}
      onLayerSelect={onLayerSelect}
      selectedCropKeyframeIndex={selectedCropKeyframeIndex}
      onSeek={onSeek}
      zoom={zoom}
      panOffset={panOffset}
      visualDuration={visualDuration}
      sourceTimeToVisualTime={sourceTimeToVisualTime}
      visualTimeToSourceTime={visualTimeToSourceTime}
      timelineZoom={timelineZoom}
      onTimelineZoomByWheel={onTimelineZoomByWheel}
      timelineScale={timelineScale}
      timelineScrollPosition={timelineScrollPosition}
      onTimelineScrollPositionChange={onTimelineScrollPositionChange}
      isPlaying={isPlaying}
    />
  );
}

export default FramingContainer;
