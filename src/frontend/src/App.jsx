import { useState, useEffect, useMemo, useRef } from 'react';
import { useVideo } from './hooks/useVideo';
import useCrop from './hooks/useCrop';
import useHighlight from './hooks/useHighlight';
import useZoom from './hooks/useZoom';
import useTimelineZoom from './hooks/useTimelineZoom';
import { useSegments } from './hooks/useSegments';
import { VideoPlayer } from './components/VideoPlayer';
import { Timeline } from './components/Timeline';
import { Controls } from './components/Controls';
import { FileUpload } from './components/FileUpload';
import AspectRatioSelector from './components/AspectRatioSelector';
import ZoomControls from './components/ZoomControls';
import ExportButton from './components/ExportButton';
import CompareModelsButton from './components/CompareModelsButton';
import DebugInfo from './components/DebugInfo';
import { CropProvider } from './contexts/CropContext';
import { HighlightProvider } from './contexts/HighlightContext';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from './utils/keyframeUtils';

// Feature flags for experimental features
// Set to true to enable model comparison UI (for A/B testing different AI models)
const ENABLE_MODEL_COMPARISON = false;

function App() {
  const [videoFile, setVideoFile] = useState(null);
  // Temporary state for live drag/resize preview (null when not dragging)
  const [dragCrop, setDragCrop] = useState(null);
  const [dragHighlight, setDragHighlight] = useState(null);

  // Layer selection state for arrow key navigation
  const [selectedLayer, setSelectedLayer] = useState('playhead'); // 'playhead' | 'crop' | 'highlight'
  // NOTE: selectedCropKeyframeIndex and selectedHighlightKeyframeIndex are now derived via useMemo
  // (defined after hooks that provide keyframes and currentTime)

  // Segments hook (defined early so we can pass getSegmentAtTime and clampToVisibleRange to useVideo)
  const {
    boundaries: segmentBoundaries,
    segments,
    sourceDuration,
    visualDuration,
    trimmedDuration,
    segmentVisualLayout,
    framerate: segmentFramerate,
    trimRange,  // NEW: Watch for trim range changes
    trimHistory,  // NEW: Trim history for de-trim buttons
    initializeWithDuration: initializeSegments,
    reset: resetSegments,
    addBoundary: addSegmentBoundary,
    removeBoundary: removeSegmentBoundary,
    setSegmentSpeed,
    toggleTrimSegment,
    getSegmentAtTime,
    getExportData: getSegmentExportData,
    isTimeVisible,
    clampToVisibleRange,  // NEW: Single source of truth for valid playback positions
    sourceTimeToVisualTime,
    visualTimeToSourceTime,
    createFrameRangeKey,
    isSegmentTrimmed,
    detrimStart,  // NEW: De-trim from start
    detrimEnd,  // NEW: De-trim from end
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
  } = useVideo(getSegmentAtTime, clampToVisibleRange);

  // Crop hook - always active when video loaded
  const {
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    framerate,
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,  // NEW: Clean up trim-related keyframes
    copyCropKeyframe,
    pasteCropKeyframe,
    interpolateCrop,
    hasKeyframeAt,
    getCropDataAtTime,
    getKeyframesForExport,
    reset: resetCrop,
  } = useCrop(metadata, trimRange);

  // Highlight hook - for highlighting specific players
  const {
    keyframes: highlightKeyframes,
    isEndKeyframeExplicit: isHighlightEndKeyframeExplicit,
    copiedHighlight,
    framerate: highlightFramerate,
    isEnabled: isHighlightEnabled,
    highlightDuration,
    toggleEnabled: toggleHighlightEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    removeKeyframe: removeHighlightKeyframe,
    deleteKeyframesInRange: deleteHighlightKeyframesInRange,
    cleanupTrimKeyframes: cleanupHighlightTrimKeyframes,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    interpolateHighlight,
    hasKeyframeAt: hasHighlightKeyframeAt,
    getHighlightDataAtTime,
    getKeyframesForExport: getHighlightKeyframesForExport,
    reset: resetHighlight,
  } = useHighlight(metadata, trimRange);

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

  // Timeline zoom hook
  const {
    timelineZoom,
    scrollPosition: timelineScrollPosition,
    zoomByWheel: timelineZoomByWheel,
    updateScrollPosition: updateTimelineScrollPosition,
    getTimelineScale,
  } = useTimelineZoom();

  // Frame tolerance for selection - approximately 5 pixels on each side
  // Derived selection state - computed from playhead position and keyframes
  // This eliminates race conditions between auto-selection and manual selection
  const selectedCropKeyframeIndex = useMemo(() => {
    if (!videoUrl) return null;
    const currentFrame = Math.round(currentTime * framerate);
    const index = findKeyframeIndexNearFrame(keyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, framerate, keyframes]);

  const selectedHighlightKeyframeIndex = useMemo(() => {
    if (!videoUrl || !isHighlightEnabled) return null;
    const currentFrame = Math.round(currentTime * highlightFramerate);
    const index = findKeyframeIndexNearFrame(highlightKeyframes, currentFrame, FRAME_TOLERANCE);
    return index !== -1 ? index : null;
  }, [videoUrl, currentTime, highlightFramerate, highlightKeyframes, isHighlightEnabled]);

  const handleFileSelect = async (file) => {
    // Reset all state before loading new video
    resetSegments();
    resetCrop();
    resetHighlight();
    // Reset layer selection (keyframe selection is derived automatically)
    setSelectedLayer('playhead');
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

  // DERIVED STATE: Current highlight state
  // Only show highlight when current time is within the highlight duration
  const currentHighlightState = useMemo(() => {
    // Don't show highlight if current time is past the highlight duration
    // Add small tolerance (~1 frame at 30fps) to handle floating point precision
    const TOLERANCE = 0.033;
    if (currentTime > highlightDuration + TOLERANCE) {
      return null;
    }

    let highlight;
    if (dragHighlight) {
      highlight = dragHighlight;
    } else if (highlightKeyframes.length === 0) {
      return null;
    } else {
      highlight = interpolateHighlight(currentTime);
    }

    if (!highlight) return null;
    return {
      x: highlight.x,
      y: highlight.y,
      radiusX: highlight.radiusX,
      radiusY: highlight.radiusY,
      opacity: highlight.opacity,
      color: highlight.color
    };
  }, [dragHighlight, highlightKeyframes, currentTime, interpolateHighlight, highlightDuration]);

  // Debug: Log keyframes changes
  useEffect(() => {
    console.log('[App] Crop keyframes changed:', keyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin
    })));
  }, [keyframes, framerate]);

  // Debug: Log highlight keyframes changes
  useEffect(() => {
    console.log('[App] Highlight keyframes changed:', highlightKeyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / highlightFramerate,
      origin: kf.origin
    })));
  }, [highlightKeyframes, highlightFramerate]);

  // Debug: Log currentCropState changes (disabled - too spammy)
  // useEffect(() => {
  //   console.log('[App] Current crop state:', currentCropState);
  // }, [currentCropState]);

  // BUG FIX: Auto-cleanup trim keyframes when trimRange is cleared
  // Use ref to track previous value to avoid cleanup on initial mount
  const prevTrimRangeRef = useRef(undefined);
  useEffect(() => {
    // Only cleanup if transitioning from non-null to null (not on initial mount)
    if (prevTrimRangeRef.current !== undefined && prevTrimRangeRef.current !== null && trimRange === null) {
      console.log('[App] trimRange cleared - cleaning up trim keyframes');
      cleanupTrimKeyframes();
      cleanupHighlightTrimKeyframes();
    }
    prevTrimRangeRef.current = trimRange;
  }, [trimRange, cleanupTrimKeyframes, cleanupHighlightTrimKeyframes]);

  // BUG FIX: Auto-reposition playhead when it becomes invalid after trim operation
  // This ensures the playhead is always within the visible (non-trimmed) range
  const lastSeekTimeRef = useRef(null);
  useEffect(() => {
    if (!trimRange || !videoUrl) return;

    // Check if current playhead position is outside the valid trim range
    const isPlayheadInvalid = currentTime < trimRange.start || currentTime > trimRange.end;

    if (isPlayheadInvalid) {
      // Clamp to the nearest valid position
      const validTime = clampToVisibleRange(currentTime);

      // Only seek if the difference is significant (avoid floating point precision loops)
      const threshold = 0.001; // 1ms threshold
      const needsSeek = lastSeekTimeRef.current === null ||
                        Math.abs(validTime - lastSeekTimeRef.current) > threshold;

      if (needsSeek) {
        console.log('[App] Playhead repositioned after trim:', currentTime, '->', validTime);
        lastSeekTimeRef.current = validTime;
        seek(validTime);
      }
    }
  }, [trimRange, currentTime, videoUrl, clampToVisibleRange, seek]);

  // Auto-update selected layer based on which keyframes are at current position
  // Selection state (selectedCropKeyframeIndex, selectedHighlightKeyframeIndex) is now
  // derived via useMemo, eliminating race conditions between auto and manual selection
  useEffect(() => {
    if (!videoUrl) return;

    const hasCropKeyframe = selectedCropKeyframeIndex !== null;
    const hasHighlightKeyframe = selectedHighlightKeyframeIndex !== null;

    // Update selected layer based on what's available
    // Only change layer if current layer has no keyframe but another does
    if (hasCropKeyframe && hasHighlightKeyframe) {
      // Both have keyframes - keep current layer selection, but ensure it's a keyframe layer
      if (selectedLayer === 'playhead') {
        setSelectedLayer('crop'); // Default to crop when coming from playhead
      }
    } else if (hasCropKeyframe && !hasHighlightKeyframe) {
      // Only crop has keyframe
      if (selectedLayer !== 'crop') {
        setSelectedLayer('crop');
      }
    } else if (!hasCropKeyframe && hasHighlightKeyframe) {
      // Only highlight has keyframe
      if (selectedLayer !== 'highlight') {
        setSelectedLayer('highlight');
      }
    }
    // If neither has keyframe, don't change selectedLayer
  }, [selectedCropKeyframeIndex, selectedHighlightKeyframeIndex, videoUrl, selectedLayer]);

  // Handler functions for copy/paste (defined BEFORE useEffect to avoid initialization errors)
  const handleCopyCrop = (time = currentTime) => {
    if (videoUrl) {
      copyCropKeyframe(time);
    }
  };

  const handlePasteCrop = (time = currentTime) => {
    if (videoUrl && copiedCrop) {
      pasteCropKeyframe(time, duration);
      // Note: Don't move playhead - paste happens at current playhead position
    }
  };

  // Handler functions for highlight copy/paste
  const handleCopyHighlight = (time = currentTime) => {
    if (videoUrl && isHighlightEnabled) {
      copyHighlightKeyframe(time);
    }
  };

  const handlePasteHighlight = (time = currentTime) => {
    if (videoUrl && copiedHighlight && isHighlightEnabled) {
      pasteHighlightKeyframe(time, duration);
      // Note: Don't move playhead - paste happens at current playhead position
    }
  };

  /**
   * Coordinated segment trim handler
   * This function ensures keyframes are properly managed when trimming segments:
   * 1. Deletes all crop and highlight keyframes in the trimmed region
   * 2. Updates the boundary crop and highlight keyframes with data from the furthest keyframes in the trimmed region
   * 3. Toggles the segment trim state
   *
   * Both crop and highlight keyframes use identical trim logic for consistency.
   */
  const handleTrimSegment = (segmentIndex) => {
    if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

    const segment = segments[segmentIndex];
    const isCurrentlyTrimmed = segment.isTrimmed;

    console.log('========== TRIM OPERATION START ==========');
    console.log('[App] handleTrimSegment - segment:', segment, 'isCurrentlyTrimmed:', isCurrentlyTrimmed);
    console.log('[App] BEFORE TRIM - Crop keyframes:', keyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin,
      x: kf.x,
      y: kf.y,
      width: kf.width,
      height: kf.height
    })));
    console.log('[App] BEFORE TRIM - Highlight keyframes:', highlightKeyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin,
      x: kf.x,
      y: kf.y,
      radiusX: kf.radiusX,
      radiusY: kf.radiusY
    })));
    console.log('[App] BEFORE TRIM - trimRange:', trimRange);
    console.log('[App] BEFORE TRIM - currentTime:', currentTime);

    // INVARIANT: Can only trim edge segments
    if (process.env.NODE_ENV === 'development') {
      if (!isCurrentlyTrimmed && !segment.isFirst && !segment.isLast) {
        console.error('⚠️ INVARIANT VIOLATION: Attempting to trim non-edge segment:', segmentIndex);
        return;
      }
    }

    if (!isCurrentlyTrimmed) {
      // We're about to trim this segment

      // ========== CROP KEYFRAMES ==========
      // Step 1: Find the furthest crop keyframe in the trimmed region to preserve its data
      let boundaryTime;
      let furthestCropKeyframeInTrimmedRegion = null;

      if (segment.isLast) {
        // Trimming from the end
        boundaryTime = segment.start;

        // Find the furthest keyframe before or at the segment end
        for (let i = keyframes.length - 1; i >= 0; i--) {
          const kfTime = keyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestCropKeyframeInTrimmedRegion = keyframes[i];
            break;
          }
        }
      } else if (segment.isFirst) {
        // Trimming from the start
        boundaryTime = segment.end;

        // Find the furthest keyframe after or at the segment start
        for (let i = 0; i < keyframes.length; i++) {
          const kfTime = keyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestCropKeyframeInTrimmedRegion = keyframes[i];
          }
        }
      }

      // Step 2: If we found a crop keyframe in the trimmed region, get its data
      // Otherwise, interpolate at the furthest point in the trimmed region
      let cropDataToPreserve = null;
      if (furthestCropKeyframeInTrimmedRegion) {
        const kfTime = furthestCropKeyframeInTrimmedRegion.frame / framerate;
        cropDataToPreserve = getCropDataAtTime(kfTime);
        console.log('[App] Preserving crop from keyframe at:', kfTime, 'data:', cropDataToPreserve);
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        cropDataToPreserve = getCropDataAtTime(edgeTime);
        console.log('[App] No crop keyframe in trimmed region, interpolating at:', edgeTime, 'data:', cropDataToPreserve);
      }

      // Step 3: Delete crop keyframes in the trimmed range
      console.log('[App] Deleting crop keyframes in range:', segment.start, '-', segment.end);
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent keyframe at the boundary
      // The permanent keyframe (frame 0 or end) was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (cropDataToPreserve && boundaryTime !== undefined) {
        console.log('[App] Reconstituting permanent crop keyframe at:', boundaryTime, 'with data:', cropDataToPreserve);
        addOrUpdateKeyframe(boundaryTime, cropDataToPreserve, duration, 'permanent');
      }

      // ========== HIGHLIGHT KEYFRAMES ==========
      // Step 1: Find the furthest highlight keyframe in the trimmed region to preserve its data
      let furthestHighlightKeyframeInTrimmedRegion = null;

      if (segment.isLast) {
        // Trimming from the end
        // Find the furthest keyframe before or at the segment end
        for (let i = highlightKeyframes.length - 1; i >= 0; i--) {
          const kfTime = highlightKeyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestHighlightKeyframeInTrimmedRegion = highlightKeyframes[i];
            break;
          }
        }
      } else if (segment.isFirst) {
        // Trimming from the start
        // Find the furthest keyframe after or at the segment start
        for (let i = 0; i < highlightKeyframes.length; i++) {
          const kfTime = highlightKeyframes[i].frame / framerate;
          if (kfTime >= segment.start && kfTime <= segment.end) {
            furthestHighlightKeyframeInTrimmedRegion = highlightKeyframes[i];
          }
        }
      }

      // Step 2: If we found a highlight keyframe in the trimmed region, get its data
      // Otherwise, interpolate at the furthest point in the trimmed region
      let highlightDataToPreserve = null;
      if (furthestHighlightKeyframeInTrimmedRegion) {
        const kfTime = furthestHighlightKeyframeInTrimmedRegion.frame / framerate;
        highlightDataToPreserve = getHighlightDataAtTime(kfTime);
        console.log('[App] Preserving highlight from keyframe at:', kfTime, 'data:', highlightDataToPreserve);
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        highlightDataToPreserve = getHighlightDataAtTime(edgeTime);
        console.log('[App] No highlight keyframe in trimmed region, interpolating at:', edgeTime, 'data:', highlightDataToPreserve);
      }

      // Step 3: Delete highlight keyframes in the trimmed range
      console.log('[App] Deleting highlight keyframes in range:', segment.start, '-', segment.end);
      deleteHighlightKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent highlight keyframe at the boundary
      // The permanent keyframe was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (highlightDataToPreserve && boundaryTime !== undefined) {
        console.log('[App] Reconstituting permanent highlight keyframe at:', boundaryTime, 'with data:', highlightDataToPreserve);
        addOrUpdateHighlightKeyframe(boundaryTime, highlightDataToPreserve, duration, 'permanent');
      }
    }
    // Note: Cleanup of trim keyframes is now automatic via useEffect watching trimRange

    // Step 5: Toggle the trim state (this works for both trimming and restoring)
    console.log('[App] Toggling trim state for segment:', segmentIndex);
    console.log('========== TRIM OPERATION COMPLETE ==========');

    // NOTE: Keyframe state updates happen asynchronously via React's batching.
    // Check the "[App] Keyframes changed" log to see the actual updated state.
    // setTimeout closures capture stale variables and show incorrect state.

    toggleTrimSegment(segmentIndex);
  };

  /**
   * Coordinated de-trim handler for start
   * This function ensures keyframes are properly reconstituted when un-trimming from start:
   * 1. Gets the keyframe data at the current trim boundary
   * 2. Deletes the keyframe at the trim boundary
   * 3. Reconstitutes the keyframe at frame 0
   * 4. Calls the original detrimStart function
   */
  const handleDetrimStart = () => {
    if (!trimRange || !duration) return;

    console.log('========== DETRIM START OPERATION ==========');
    console.log('[App] handleDetrimStart - current trimRange:', trimRange);
    console.log('[App] handleDetrimStart - BEFORE crop keyframes:', keyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin
    })));
    console.log('[App] handleDetrimStart - BEFORE highlight keyframes:', highlightKeyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / highlightFramerate,
      origin: kf.origin
    })));

    // The current trim boundary is trimRange.start
    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);
    console.log('[App] handleDetrimStart - crop data at boundary:', boundaryTime, cropDataAtBoundary);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        console.log('[App] handleDetrimStart - deleting crop keyframe at frame:', boundaryFrame);
        // We need to delete this keyframe - use a small range around it
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (cropDataAtBoundary) {
      console.log('[App] handleDetrimStart - reconstituting crop keyframe at frame 0');
      addOrUpdateKeyframe(0, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);
    console.log('[App] handleDetrimStart - highlight data at boundary:', boundaryTime, highlightDataAtBoundary);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        console.log('[App] handleDetrimStart - deleting highlight keyframe at frame:', boundaryFrame);
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (highlightDataAtBoundary) {
      console.log('[App] handleDetrimStart - reconstituting highlight keyframe at frame 0');
      addOrUpdateHighlightKeyframe(0, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimStart function to update trimRange
    console.log('[App] handleDetrimStart - calling detrimStart()');
    detrimStart();

    console.log('========== DETRIM START OPERATION COMPLETE ==========');
  };

  /**
   * Coordinated de-trim handler for end
   * This function ensures keyframes are properly reconstituted when un-trimming from end:
   * 1. Gets the keyframe data at the current trim boundary
   * 2. Deletes the keyframe at the trim boundary
   * 3. Reconstitutes the keyframe at the original end position
   * 4. Calls the original detrimEnd function
   */
  const handleDetrimEnd = () => {
    if (!trimRange || !duration) return;

    console.log('========== DETRIM END OPERATION ==========');
    console.log('[App] handleDetrimEnd - current trimRange:', trimRange);
    console.log('[App] handleDetrimEnd - BEFORE crop keyframes:', keyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin
    })));
    console.log('[App] handleDetrimEnd - BEFORE highlight keyframes:', highlightKeyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / highlightFramerate,
      origin: kf.origin
    })));

    // The current trim boundary is trimRange.end
    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);
    console.log('[App] handleDetrimEnd - crop data at boundary:', boundaryTime, cropDataAtBoundary);

    // Delete the keyframe at the trim boundary (if it exists and is not the end frame)
    if (boundaryFrame < endFrame) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        console.log('[App] handleDetrimEnd - deleting crop keyframe at frame:', boundaryFrame);
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the original end
    if (cropDataAtBoundary) {
      console.log('[App] handleDetrimEnd - reconstituting crop keyframe at end frame:', endFrame);
      addOrUpdateKeyframe(duration, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);
    const highlightEndFrame = Math.round(highlightDuration * highlightFramerate);
    console.log('[App] handleDetrimEnd - highlight data at boundary:', boundaryTime, highlightDataAtBoundary);

    // Delete the keyframe at the trim boundary (if it exists and is not the highlight end frame)
    if (boundaryFrame < highlightEndFrame) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        console.log('[App] handleDetrimEnd - deleting highlight keyframe at frame:', boundaryFrame);
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the highlight end
    if (highlightDataAtBoundary && boundaryTime < highlightDuration) {
      console.log('[App] handleDetrimEnd - reconstituting highlight keyframe at highlightDuration:', highlightDuration);
      addOrUpdateHighlightKeyframe(highlightDuration, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimEnd function to update trimRange
    console.log('[App] handleDetrimEnd - calling detrimEnd()');
    detrimEnd();

    console.log('========== DETRIM END OPERATION COMPLETE ==========');
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

  // Keyboard handler: Arrow keys for layer-specific navigation
  useEffect(() => {
    const handleArrowKeys = (event) => {
      // Only handle if video is loaded and arrow keys pressed
      if (!videoUrl) return;
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;

      // Don't handle if modifier keys are pressed (let other shortcuts work)
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();

      const isLeft = event.code === 'ArrowLeft';
      const direction = isLeft ? -1 : 1;

      switch (selectedLayer) {
        case 'playhead': {
          // Move playhead one frame in the direction
          if (isLeft) {
            stepBackward();
          } else {
            stepForward();
          }
          break;
        }

        case 'crop': {
          // Navigate to next/previous crop keyframe
          // Selection is derived from playhead position, so just seek to keyframe time
          if (keyframes.length === 0) break;

          let targetIndex;
          if (selectedCropKeyframeIndex === null) {
            // No keyframe selected, select based on direction
            targetIndex = isLeft ? keyframes.length - 1 : 0;
          } else {
            // Move to next/previous keyframe
            targetIndex = selectedCropKeyframeIndex + direction;
            // Clamp to valid range
            targetIndex = Math.max(0, Math.min(targetIndex, keyframes.length - 1));
          }

          if (targetIndex !== selectedCropKeyframeIndex) {
            const keyframe = keyframes[targetIndex];
            const keyframeTime = keyframe.frame / framerate;
            seek(keyframeTime); // Selection updates automatically via useMemo
          }
          break;
        }

        case 'highlight': {
          // Navigate to next/previous highlight keyframe
          // Selection is derived from playhead position, so just seek to keyframe time
          if (highlightKeyframes.length === 0 || !isHighlightEnabled) break;

          let targetIndex;
          if (selectedHighlightKeyframeIndex === null) {
            // No keyframe selected, select based on direction
            targetIndex = isLeft ? highlightKeyframes.length - 1 : 0;
          } else {
            // Move to next/previous keyframe
            targetIndex = selectedHighlightKeyframeIndex + direction;
            // Clamp to valid range
            targetIndex = Math.max(0, Math.min(targetIndex, highlightKeyframes.length - 1));
          }

          if (targetIndex !== selectedHighlightKeyframeIndex) {
            const keyframe = highlightKeyframes[targetIndex];
            const keyframeTime = keyframe.frame / highlightFramerate;
            seek(keyframeTime); // Selection updates automatically via useMemo
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleArrowKeys);
    return () => document.removeEventListener('keydown', handleArrowKeys);
  }, [videoUrl, selectedLayer, selectedCropKeyframeIndex, selectedHighlightKeyframeIndex, keyframes, highlightKeyframes, framerate, highlightFramerate, isHighlightEnabled, stepForward, stepBackward, seek]);

  // Handle crop changes during drag/resize (live preview)
  const handleCropChange = (newCrop) => {
    setDragCrop(newCrop);
  };

  // Handle crop complete (create keyframe and clear drag state)
  const handleCropComplete = (cropData) => {
    console.log('========== CROP EDIT ==========');
    console.log('[App] handleCropComplete - currentTime:', currentTime);
    console.log('[App] handleCropComplete - cropData:', cropData);
    console.log('[App] handleCropComplete - existing keyframes:', keyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin
    })));
    const frame = Math.round(currentTime * framerate);
    const existingKeyframe = keyframes.find(kf => kf.frame === frame);
    console.log('[App] handleCropComplete - looking for keyframe at frame:', frame, '(time:', currentTime, ')');
    console.log('[App] handleCropComplete - existing keyframe at this frame:', existingKeyframe);

    addOrUpdateKeyframe(currentTime, cropData, duration);
    setDragCrop(null); // Clear drag preview
  };

  // Handle highlight changes during drag/resize
  const handleHighlightChange = (newHighlight) => {
    setDragHighlight(newHighlight);
  };

  // Handle highlight complete (create keyframe and clear drag state)
  const handleHighlightComplete = (highlightData) => {
    console.log('========== HIGHLIGHT EDIT ==========');
    console.log('[App] handleHighlightComplete - currentTime:', currentTime);
    console.log('[App] handleHighlightComplete - highlightData:', highlightData);
    console.log('[App] handleHighlightComplete - existing keyframes:', highlightKeyframes.map(kf => ({
      frame: kf.frame,
      time: kf.frame / framerate,
      origin: kf.origin
    })));
    const frame = Math.round(currentTime * framerate);
    const existingKeyframe = highlightKeyframes.find(kf => kf.frame === frame);
    console.log('[App] handleHighlightComplete - looking for keyframe at frame:', frame, '(time:', currentTime, ')');
    console.log('[App] handleHighlightComplete - existing keyframe at this frame:', existingKeyframe);

    addOrUpdateHighlightKeyframe(currentTime, highlightData, duration);
    setDragHighlight(null);
  };

  // Handle keyframe click (seek to keyframe time - selection is derived automatically)
  const handleKeyframeClick = (time, index) => {
    seek(time);
    setSelectedLayer('crop');
  };

  // Handle keyframe delete (pass duration to removeKeyframe)
  // Selection automatically becomes null when keyframe no longer exists (derived state)
  const handleKeyframeDelete = (time) => {
    removeKeyframe(time, duration);
  };

  // Handle highlight keyframe click (seek - selection is derived automatically)
  const handleHighlightKeyframeClick = (time, index) => {
    console.log('[App] handleHighlightKeyframeClick - time:', time, 'index:', index);
    seek(time);
    setSelectedLayer('highlight');
  };

  // Handle highlight keyframe delete
  // Selection automatically becomes null when keyframe no longer exists (derived state)
  const handleHighlightKeyframeDelete = (time) => {
    removeHighlightKeyframe(time, duration);
  };

  // Handle highlight duration change
  const handleHighlightDurationChange = (newDuration) => {
    updateHighlightDuration(newDuration, duration);
    // Sync playhead to the new duration position
    seek(newDuration);
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

  // Prepare highlight context value
  const highlightContextValue = useMemo(() => ({
    keyframes: highlightKeyframes,
    isEndKeyframeExplicit: isHighlightEndKeyframeExplicit,
    copiedHighlight,
    isEnabled: isHighlightEnabled,
    highlightDuration,
    toggleEnabled: toggleHighlightEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe: addOrUpdateHighlightKeyframe,
    removeKeyframe: removeHighlightKeyframe,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    interpolateHighlight,
    hasKeyframeAt: hasHighlightKeyframeAt,
  }), [highlightKeyframes, isHighlightEndKeyframeExplicit, copiedHighlight, isHighlightEnabled, highlightDuration, toggleHighlightEnabled, updateHighlightDuration, addOrUpdateHighlightKeyframe, removeHighlightKeyframe, copyHighlightKeyframe, pasteHighlightKeyframe, interpolateHighlight, hasHighlightKeyframeAt]);

  /**
   * Get filtered keyframes for export
   * Includes keyframes within trim range PLUS surrounding keyframes for proper interpolation
   */
  const getFilteredKeyframesForExport = useMemo(() => {
    const allKeyframes = getKeyframesForExport();
    const segmentData = getSegmentExportData();

    // If no trimming, return all keyframes
    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    // Find keyframes needed for proper interpolation:
    // 1. All keyframes within trim range
    // 2. Last keyframe BEFORE trim start (for interpolation at trim start)
    // 3. First keyframe AFTER trim end (for interpolation at trim end)
    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        // Keyframe is within trim range
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        // Track last keyframe before trim start
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        // Track first keyframe after trim end
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    // Combine all needed keyframes
    const filtered = [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];

    // Debug log (disabled - too spammy)
    // console.log('[App] Filtered keyframes for export:', {
    //   original: allKeyframes.length,
    //   filtered: filtered.length,
    //   trimStart,
    //   trimEnd,
    //   includedBefore: !!lastBeforeTrimStart,
    //   includedAfter: !!firstAfterTrimEnd
    // });

    return filtered;
  }, [getKeyframesForExport, getSegmentExportData, duration]);

  /**
   * Get filtered highlight keyframes for export
   * Includes keyframes within trim range PLUS surrounding keyframes for proper interpolation
   */
  const getFilteredHighlightKeyframesForExport = useMemo(() => {
    if (!isHighlightEnabled) {
      return []; // Don't export if highlight layer is disabled
    }

    const allKeyframes = getHighlightKeyframesForExport();
    const segmentData = getSegmentExportData();

    // If no trimming, return all keyframes
    if (!segmentData || (!segmentData.trim_start && !segmentData.trim_end)) {
      return allKeyframes;
    }

    const trimStart = segmentData.trim_start || 0;
    const trimEnd = segmentData.trim_end || duration || Infinity;

    // Find keyframes needed for proper interpolation:
    // 1. All keyframes within trim range
    // 2. Last keyframe BEFORE trim start (for interpolation at trim start)
    // 3. First keyframe AFTER trim end (for interpolation at trim end)
    let lastBeforeTrimStart = null;
    let firstAfterTrimEnd = null;
    const keyframesInRange = [];

    allKeyframes.forEach(kf => {
      if (kf.time >= trimStart && kf.time <= trimEnd) {
        // Keyframe is within trim range
        keyframesInRange.push(kf);
      } else if (kf.time < trimStart) {
        // Track last keyframe before trim start
        if (!lastBeforeTrimStart || kf.time > lastBeforeTrimStart.time) {
          lastBeforeTrimStart = kf;
        }
      } else if (kf.time > trimEnd) {
        // Track first keyframe after trim end
        if (!firstAfterTrimEnd || kf.time < firstAfterTrimEnd.time) {
          firstAfterTrimEnd = kf;
        }
      }
    });

    // Combine all needed keyframes
    const filtered = [
      ...(lastBeforeTrimStart ? [lastBeforeTrimStart] : []),
      ...keyframesInRange,
      ...(firstAfterTrimEnd ? [firstAfterTrimEnd] : [])
    ];

    // Debug log (disabled - too spammy)
    // console.log('[App] Filtered highlight keyframes for export:', {
    //   original: allKeyframes.length,
    //   filtered: filtered.length,
    //   trimStart,
    //   trimEnd,
    //   includedBefore: !!lastBeforeTrimStart,
    //   includedAfter: !!firstAfterTrimEnd
    // });

    return filtered;
  }, [isHighlightEnabled, getHighlightKeyframesForExport, getSegmentExportData, duration]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              Player Highlighter
            </h1>
            <p className="text-gray-400">
              Share your player's brilliance
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
              <AspectRatioSelector
                aspectRatio={aspectRatio}
                onAspectRatioChange={updateAspectRatio}
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
            selectedKeyframeIndex={selectedCropKeyframeIndex}
            showHighlightOverlay={!!videoUrl}
            currentHighlight={currentHighlightState}
            isHighlightEnabled={isHighlightEnabled}
            onHighlightChange={handleHighlightChange}
            onHighlightComplete={handleHighlightComplete}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={zoomByWheel}
            onPanChange={updatePan}
          />

          {/* Timeline */}
          {videoUrl && (
            <div className="mt-6">
              <CropProvider value={cropContextValue}>
                <HighlightProvider value={highlightContextValue}>
                  <Timeline
                    currentTime={currentTime}
                    duration={duration}
                    visualDuration={visualDuration || duration}
                    sourceDuration={sourceDuration || duration}
                    trimmedDuration={trimmedDuration || 0}
                    onSeek={seek}
                    cropKeyframes={keyframes}
                    framerate={framerate}
                    isCropActive={true}
                    onCropKeyframeClick={handleKeyframeClick}
                    onCropKeyframeDelete={handleKeyframeDelete}
                    onCropKeyframeCopy={handleCopyCrop}
                    onCropKeyframePaste={handlePasteCrop}
                    selectedCropKeyframeIndex={selectedCropKeyframeIndex}
                    highlightKeyframes={highlightKeyframes}
                    highlightFramerate={highlightFramerate}
                    isHighlightActive={true}
                    onHighlightKeyframeClick={handleHighlightKeyframeClick}
                    onHighlightKeyframeDelete={handleHighlightKeyframeDelete}
                    onHighlightKeyframeCopy={handleCopyHighlight}
                    onHighlightKeyframePaste={handlePasteHighlight}
                    selectedHighlightKeyframeIndex={selectedHighlightKeyframeIndex}
                    onHighlightToggleEnabled={toggleHighlightEnabled}
                    onHighlightDurationChange={handleHighlightDurationChange}
                    selectedLayer={selectedLayer}
                    onLayerSelect={setSelectedLayer}
                    segments={segments}
                    segmentBoundaries={segmentBoundaries}
                    segmentVisualLayout={segmentVisualLayout}
                    isSegmentActive={true}
                    onAddSegmentBoundary={addSegmentBoundary}
                    onRemoveSegmentBoundary={removeSegmentBoundary}
                    onSegmentSpeedChange={setSegmentSpeed}
                    onSegmentTrim={handleTrimSegment}
                    trimRange={trimRange}
                    trimHistory={trimHistory}
                    onDetrimStart={handleDetrimStart}
                    onDetrimEnd={handleDetrimEnd}
                    sourceTimeToVisualTime={sourceTimeToVisualTime}
                    visualTimeToSourceTime={visualTimeToSourceTime}
                    timelineZoom={timelineZoom}
                    onTimelineZoomByWheel={timelineZoomByWheel}
                    timelineScale={getTimelineScale()}
                    timelineScrollPosition={timelineScrollPosition}
                    onTimelineScrollPositionChange={updateTimelineScrollPosition}
                  />
                </HighlightProvider>
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
                cropKeyframes={getFilteredKeyframesForExport}
                highlightKeyframes={getFilteredHighlightKeyframesForExport}
                isHighlightEnabled={isHighlightEnabled}
                segmentData={getSegmentExportData()}
                disabled={!videoFile}
              />
            </div>
          )}

          {/* Model Comparison Button (for testing different AI models) */}
          {ENABLE_MODEL_COMPARISON && videoUrl && (
            <div className="mt-6">
              <CompareModelsButton
                videoFile={videoFile}
                cropKeyframes={getFilteredKeyframesForExport}
                highlightKeyframes={getFilteredHighlightKeyframesForExport}
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
              <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">📤</div>
                  <h3 className="font-semibold text-white mb-1">1. Upload</h3>
                  <p>Upload your game footage to get started</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">✂️</div>
                  <h3 className="font-semibold text-white mb-1">2. Trim</h3>
                  <p>Cut out the boring parts and keep only the action</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🎯</div>
                  <h3 className="font-semibold text-white mb-1">3. Zoom</h3>
                  <p>Follow your player with dynamic crop keyframes</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🐌</div>
                  <h3 className="font-semibold text-white mb-1">4. Slow-Mo</h3>
                  <p>Create slow motion segments for key moments</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">🚀</div>
                  <h3 className="font-semibold text-white mb-1">5. Export</h3>
                  <p>Play the video to make sure it's perfect and hit export to leverage AI Upscale</p>
                </div>
              </div>
              <div className="mt-6 text-xs text-gray-500">
                <p>Supported formats: MP4, MOV, WebM</p>
                <p>Maximum file size: 4GB</p>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Debug Info - Shows current branch and commit */}
      <DebugInfo />
    </div>
  );
}

export default App;
