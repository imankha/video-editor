import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVideo } from './hooks/useVideo';
import useZoom from './hooks/useZoom';
import useTimelineZoom from './hooks/useTimelineZoom';
import { useClipManager } from './hooks/useClipManager';
import { VideoPlayer } from './components/VideoPlayer';
import { Controls } from './components/Controls';
import { FileUpload } from './components/FileUpload';
import { ClipSelectorSidebar } from './components/ClipSelectorSidebar';
import AspectRatioSelector from './components/AspectRatioSelector';
import ZoomControls from './components/ZoomControls';
import ExportButton from './components/ExportButton';
import CompareModelsButton from './components/CompareModelsButton';
import DebugInfo from './components/DebugInfo';
import { ModeSwitcher } from './components/shared/ModeSwitcher';
// Mode-specific imports
import { useCrop, useSegments, FramingMode, CropOverlay } from './modes/framing';
import { useHighlight, OverlayMode, HighlightOverlay } from './modes/overlay';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from './utils/keyframeUtils';
import { extractVideoMetadata } from './utils/videoMetadata';

// Feature flags for experimental features
// Set to true to enable model comparison UI (for A/B testing different AI models)
const ENABLE_MODEL_COMPARISON = false;

function App() {
  const [videoFile, setVideoFile] = useState(null);
  // Temporary state for live drag/resize preview (null when not dragging)
  const [dragCrop, setDragCrop] = useState(null);
  const [dragHighlight, setDragHighlight] = useState(null);

  // Editor mode state ('framing' | 'overlay')
  const [editorMode, setEditorMode] = useState('framing');

  // Overlay mode video state (SEPARATE from framing video)
  // This is either: 1) Rendered output from Framing, or 2) Fresh upload for Overlay
  const [overlayVideoFile, setOverlayVideoFile] = useState(null);
  const [overlayVideoUrl, setOverlayVideoUrl] = useState(null);
  const [overlayVideoMetadata, setOverlayVideoMetadata] = useState(null);

  // Layer selection state for arrow key navigation
  const [selectedLayer, setSelectedLayer] = useState('playhead'); // 'playhead' | 'crop' | 'highlight'

  // Audio state - synced between export settings and playback (Framing mode only)
  const [includeAudio, setIncludeAudio] = useState(true);

  // Highlight effect type - controls both client-side preview and export
  // 'brightness_boost' | 'original' | 'dark_overlay'
  const [highlightEffectType, setHighlightEffectType] = useState('original');

  // NOTE: selectedCropKeyframeIndex and selectedHighlightKeyframeIndex are now derived via useMemo
  // (defined after hooks that provide keyframes and currentTime)

  // Multi-clip management hook
  const {
    clips,
    selectedClipId,
    selectedClip,
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
  } = useClipManager();

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
    segmentSpeeds,  // Speed settings by segment index
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
  // NOTE: Only pass segment functions in Framing mode. In Overlay mode, the rendered
  // video doesn't have segments/trimming, so we pass null to avoid incorrect playback behavior.
  } = useVideo(
    editorMode === 'framing' ? getSegmentAtTime : null,
    editorMode === 'framing' ? clampToVisibleRange : null
  );

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
  // NOTE: In Overlay mode, use overlay video metadata; no trimRange in overlay mode
  const effectiveHighlightMetadata = editorMode === 'overlay' && overlayVideoMetadata
    ? overlayVideoMetadata
    : metadata;
  const effectiveHighlightTrimRange = editorMode === 'overlay' ? null : trimRange;

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
  } = useHighlight(effectiveHighlightMetadata, effectiveHighlightTrimRange);

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

  /**
   * Clips with current clip's live state merged.
   * Since clip state (keyframes, segments) is managed in useCrop/useSegments hooks,
   * we need to merge the current clip's live state before export.
   */
  const clipsWithCurrentState = useMemo(() => {
    if (!hasClips || !clips || !selectedClipId) return clips;

    // Helper to convert frame-based keyframes to time-based for export
    const convertKeyframesToTime = (keyframes, clipFramerate) => {
      if (!keyframes || !Array.isArray(keyframes)) return [];
      return keyframes.map(kf => {
        // If already has 'time', it's already converted
        if (kf.time !== undefined) return kf;
        // Convert frame to time
        const time = kf.frame / clipFramerate;
        const { frame, ...rest } = kf;
        return { time, ...rest };
      });
    };

    // Helper to calculate default crop for a given aspect ratio
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

    // Use getKeyframesForExport() for current clip (proper conversion)
    const currentClipExportKeyframes = getKeyframesForExport();

    // Debug logging
    console.log('[clipsWithCurrentState] Building export state:');
    console.log('  - selectedClipId:', selectedClipId);
    console.log('  - currentClipExportKeyframes:', currentClipExportKeyframes?.length, currentClipExportKeyframes);
    console.log('  - segmentSpeeds:', segmentSpeeds);

    return clips.map(clip => {
      if (clip.id === selectedClipId) {
        // Current clip: use live state from hooks
        const result = {
          ...clip,
          cropKeyframes: currentClipExportKeyframes,
          segments: {
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: trimRange
          },
          trimRange: trimRange
        };
        console.log(`  - Clip ${clip.id} (CURRENT):`, result.cropKeyframes?.length, 'keyframes, speeds:', result.segments.segmentSpeeds);
        return result;
      }
      // Other clips: convert saved keyframes from frame to time
      let convertedKeyframes = convertKeyframesToTime(clip.cropKeyframes, clip.framerate || 30);

      // FIX: If no keyframes were saved (race condition on fast clip add),
      // generate default keyframes based on clip dimensions and global aspect ratio
      if (convertedKeyframes.length === 0 && clip.sourceWidth && clip.sourceHeight && clip.duration) {
        const defaultCrop = calculateDefaultCrop(clip.sourceWidth, clip.sourceHeight, globalAspectRatio);
        convertedKeyframes = [
          { time: 0, ...defaultCrop },
          { time: clip.duration, ...defaultCrop }
        ];
        console.log(`  - Clip ${clip.id} (saved): EMPTY keyframes - generated defaults:`, convertedKeyframes);
      } else {
        console.log(`  - Clip ${clip.id} (saved): raw=${clip.cropKeyframes?.length}, converted=${convertedKeyframes?.length} keyframes, segments:`, clip.segments);
      }

      return {
        ...clip,
        cropKeyframes: convertedKeyframes
      };
    });
  }, [clips, selectedClipId, getKeyframesForExport, segmentBoundaries, segmentSpeeds, trimRange, hasClips, globalAspectRatio]);

  /**
   * Save current clip's state before switching
   */
  const saveCurrentClipState = useCallback(() => {
    if (!selectedClipId) {
      console.log('[App] saveCurrentClipState: No selectedClipId, skipping');
      return;
    }

    // Save current segment state including speeds
    const segmentState = {
      boundaries: segmentBoundaries,
      segmentSpeeds: segmentSpeeds,
      trimRange: trimRange,
    };

    console.log('[App] saveCurrentClipState for clip:', selectedClipId);
    console.log('  - keyframes to save:', keyframes?.length, keyframes);
    console.log('  - segmentState:', segmentState);

    // Save current crop keyframes
    updateClipData(selectedClipId, {
      segments: segmentState,
      cropKeyframes: keyframes,
      trimRange: trimRange
    });

    console.log('[App] Saved state for clip:', selectedClipId);
  }, [selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, keyframes, updateClipData]);

  /**
   * Handle file selection - adds clip to clip manager
   */
  const handleFileSelect = async (file) => {
    try {
      // Extract metadata first
      const videoMetadata = await extractVideoMetadata(file);

      // Add clip to the clip manager
      const newClipId = addClip(file, videoMetadata);

      console.log('[App] handleFileSelect: hasClips=', hasClips, 'clips.length=', clips.length, 'selectedClipId=', selectedClipId);

      // If this is the first clip, load it immediately
      if (!hasClips || clips.length === 0) {
        console.log('[App] First clip - no state to save');
        // Reset all state for fresh start
        resetSegments();
        resetCrop();
        resetHighlight();
        setSelectedLayer('playhead');
        setVideoFile(file);
        await loadVideo(file);
      } else {
        console.log('[App] Additional clip - saving state for clip:', selectedClipId);
        // Additional clips - save current state first
        saveCurrentClipState();

        // Then select and load the new clip
        selectClip(newClipId);
        resetSegments();
        resetCrop();
        resetHighlight();
        setSelectedLayer('playhead');
        setVideoFile(file);
        await loadVideo(file);
      }

      console.log('[App] Added clip:', newClipId, file.name);
    } catch (err) {
      console.error('[App] Failed to add clip:', err);
    }
  };

  /**
   * Handle clip selection from sidebar
   */
  const handleSelectClip = useCallback(async (clipId) => {
    if (clipId === selectedClipId) return;

    // Save current clip's state
    saveCurrentClipState();

    // Find the clip to load
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      console.error('[App] Clip not found:', clipId);
      return;
    }

    // Select the new clip
    selectClip(clipId);

    // Reset hooks and load new clip's video
    resetSegments();
    resetCrop();
    resetHighlight();
    setSelectedLayer('playhead');
    setVideoFile(clip.file);
    await loadVideo(clip.file);

    // TODO: Restore saved segment/crop state for this clip
    // This requires modifying useSegments and useCrop to accept initial state

    console.log('[App] Switched to clip:', clipId, clip.fileName);
  }, [selectedClipId, saveCurrentClipState, clips, selectClip, resetSegments, resetCrop, resetHighlight, loadVideo]);

  /**
   * Handle clip deletion from sidebar
   */
  const handleDeleteClip = useCallback((clipId) => {
    const clipToDelete = clips.find(c => c.id === clipId);
    if (!clipToDelete) return;

    // If deleting the currently selected clip, need to handle differently
    if (clipId === selectedClipId) {
      // Find another clip to select
      const remainingClips = clips.filter(c => c.id !== clipId);

      if (remainingClips.length > 0) {
        // Select the first remaining clip
        handleSelectClip(remainingClips[0].id);
      } else {
        // No more clips - reset everything
        resetSegments();
        resetCrop();
        resetHighlight();
        setVideoFile(null);
        // Clear video - loadVideo with null will handle cleanup
      }
    }

    // Delete the clip
    deleteClip(clipId);

    console.log('[App] Deleted clip:', clipId, clipToDelete.fileName);
  }, [clips, selectedClipId, handleSelectClip, deleteClip, resetSegments, resetCrop, resetHighlight]);

  /**
   * Handle adding a new clip from sidebar
   */
  const handleAddClipFromSidebar = useCallback((file) => {
    handleFileSelect(file);
  }, []);

  // Initialize segments when video duration is available
  useEffect(() => {
    if (duration && duration > 0) {
      initializeSegments(duration);
    }
  }, [duration, initializeSegments]);

  // Sync video mute state with export audio setting
  // When user turns off audio in export settings, also mute playback preview
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !includeAudio;
    }
  }, [includeAudio, videoRef]);

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

  // Debug: Log keyframes changes (disabled - too frequent, use React DevTools instead)

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

    console.log(`[App] Trim segment ${segmentIndex}: ${segment.start.toFixed(2)}s-${segment.end.toFixed(2)}s, isTrimmed=${isCurrentlyTrimmed}, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

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
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        cropDataToPreserve = getCropDataAtTime(edgeTime);
      }

      // Step 3: Delete crop keyframes in the trimmed range
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent keyframe at the boundary
      // The permanent keyframe (frame 0 or end) was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (cropDataToPreserve && boundaryTime !== undefined) {
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
      } else {
        // No keyframe in trimmed region, interpolate at the far edge
        const edgeTime = segment.isLast ? segment.end : segment.start;
        highlightDataToPreserve = getHighlightDataAtTime(edgeTime);
      }

      // Step 3: Delete highlight keyframes in the trimmed range
      deleteHighlightKeyframesInRange(segment.start, segment.end, duration);

      // Step 4: Reconstitute the permanent highlight keyframe at the boundary
      // The permanent keyframe was deleted in the trimmed range,
      // so we reconstitute it at the new boundary with origin='permanent'
      if (highlightDataToPreserve && boundaryTime !== undefined) {
        addOrUpdateHighlightKeyframe(boundaryTime, highlightDataToPreserve, duration, 'permanent');
      }
    }
    // Note: Cleanup of trim keyframes is now automatic via useEffect watching trimRange

    // Step 5: Toggle the trim state (this works for both trimming and restoring)

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

    console.log(`[App] Detrim start: boundary=${trimRange.start.toFixed(2)}s, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

    // The current trim boundary is trimRange.start
    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        // We need to delete this keyframe - use a small range around it
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(0, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not frame 0)
    if (boundaryFrame > 0) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at frame 0
    if (highlightDataAtBoundary) {
      addOrUpdateHighlightKeyframe(0, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimStart function to update trimRange
    detrimStart();
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

    console.log(`[App] Detrim end: boundary=${trimRange.end.toFixed(2)}s, cropKFs=${keyframes.length}, highlightKFs=${highlightKeyframes.length}`);

    // The current trim boundary is trimRange.end
    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);

    // ========== CROP KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    // Delete the keyframe at the trim boundary (if it exists and is not the end frame)
    if (boundaryFrame < endFrame) {
      const cropKfAtBoundary = keyframes.find(kf => kf.frame === boundaryFrame);
      if (cropKfAtBoundary && cropKfAtBoundary.origin === 'permanent') {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the original end
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(duration, cropDataAtBoundary, duration, 'permanent');
    }

    // ========== HIGHLIGHT KEYFRAMES ==========
    // Get data from keyframe at the trim boundary
    const highlightDataAtBoundary = getHighlightDataAtTime(boundaryTime);
    const highlightEndFrame = Math.round(highlightDuration * highlightFramerate);

    // Delete the keyframe at the trim boundary (if it exists and is not the highlight end frame)
    if (boundaryFrame < highlightEndFrame) {
      const highlightKfAtBoundary = highlightKeyframes.find(kf => kf.frame === boundaryFrame);
      if (highlightKfAtBoundary && highlightKfAtBoundary.origin === 'permanent') {
        deleteHighlightKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Reconstitute the keyframe at the highlight end
    if (highlightDataAtBoundary && boundaryTime < highlightDuration) {
      addOrUpdateHighlightKeyframe(highlightDuration, highlightDataAtBoundary, duration, 'permanent');
    }

    // Call the original detrimEnd function to update trimRange
    detrimEnd();
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
    const frame = Math.round(currentTime * framerate);
    const isUpdate = keyframes.some(kf => kf.frame === frame);
    console.log(`[App] Crop ${isUpdate ? 'update' : 'add'} at ${currentTime.toFixed(2)}s (frame ${frame}): x=${cropData.x}, y=${cropData.y}, ${cropData.width}x${cropData.height}`);

    addOrUpdateKeyframe(currentTime, cropData, duration);
    setDragCrop(null); // Clear drag preview
  };

  // Handle highlight changes during drag/resize
  const handleHighlightChange = (newHighlight) => {
    setDragHighlight(newHighlight);
  };

  // Handle highlight complete (create keyframe and clear drag state)
  const handleHighlightComplete = (highlightData) => {
    // NOTE: Must use highlightFramerate (not crop framerate) since highlight keyframes use highlight framerate
    const frame = Math.round(currentTime * highlightFramerate);
    const isUpdate = highlightKeyframes.some(kf => kf.frame === frame);
    console.log(`[App] Highlight ${isUpdate ? 'update' : 'add'} at ${currentTime.toFixed(2)}s (frame ${frame}): pos=(${highlightData.x},${highlightData.y}), r=${highlightData.radiusX}x${highlightData.radiusY}`);

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

  /**
   * Handle transition from Framing to Overlay mode
   * Called when user exports from Framing mode
   * @param {Blob} renderedVideoBlob - The rendered video from framing export
   */
  const handleProceedToOverlay = async (renderedVideoBlob) => {
    try {
      // Create URL for the rendered video
      const url = URL.createObjectURL(renderedVideoBlob);

      // Extract metadata from the rendered video
      const meta = await extractVideoMetadata(renderedVideoBlob);

      // Clean up old overlay video URL if exists
      if (overlayVideoUrl) {
        URL.revokeObjectURL(overlayVideoUrl);
      }

      // Set overlay video state
      setOverlayVideoFile(renderedVideoBlob);
      setOverlayVideoUrl(url);
      setOverlayVideoMetadata(meta);

      // Reset highlight keyframes for fresh start in overlay mode
      resetHighlight();

      // Switch to overlay mode
      setEditorMode('overlay');

      // Wait for video element to load the new source, then seek to beginning
      // Use a small delay to allow React to update and video to start loading
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = 0;
          // Also pause to ensure it's ready to play from the start
          videoRef.current.pause();
        }
      }, 100);

      console.log('[App] Transitioned to Overlay mode with rendered video:', {
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        aspectRatio: meta.aspectRatio,
      });
    } catch (err) {
      console.error('[App] Failed to transition to Overlay mode:', err);
      throw err; // Re-throw so ExportButton can show error
    }
  };

  /**
   * Handle mode change between Framing and Overlay
   * When switching back to Framing mode, reload the selected clip's video
   * to ensure all state is properly restored.
   */
  const handleModeChange = useCallback(async (newMode) => {
    if (newMode === editorMode) return;

    if (newMode === 'framing') {
      // Switching back to framing mode - need to reload the framing video
      console.log('[App] Switching back to Framing mode');

      // If we have a selected clip, reload its video
      if (selectedClip && selectedClip.file) {
        console.log('[App] Reloading clip:', selectedClip.id, selectedClip.fileName);

        // Set the video file state
        setVideoFile(selectedClip.file);

        // Reload the video - this will update videoUrl and metadata
        await loadVideo(selectedClip.file);

        // Seek to the beginning after a short delay to let React update
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.pause();
          }
        }, 100);
      }
    }

    // Set the new mode
    setEditorMode(newMode);
  }, [editorMode, selectedClip, loadVideo, videoRef]);

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
   *
   * In FRAMING mode: Filters keyframes based on trim range (includes surrounding keyframes for interpolation)
   * In OVERLAY mode: Returns ALL keyframes (overlay video is already trimmed, so no filtering needed)
   */
  const getFilteredHighlightKeyframesForExport = useMemo(() => {
    if (!isHighlightEnabled) {
      return []; // Don't export if highlight layer is disabled
    }

    const allKeyframes = getHighlightKeyframesForExport();

    // In overlay mode, return all keyframes - the video is already trimmed,
    // and highlight keyframes are on the new video's timeline
    if (editorMode === 'overlay') {
      return allKeyframes;
    }

    // Framing mode: Apply trim filtering
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

    return filtered;
  }, [isHighlightEnabled, getHighlightKeyframesForExport, getSegmentExportData, duration, editorMode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Sidebar - only show when clips exist */}
      {hasClips && clips.length > 0 && editorMode === 'framing' && (
        <ClipSelectorSidebar
          clips={clips}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onAddClip={handleAddClipFromSidebar}
          onDeleteClip={handleDeleteClip}
          onReorderClips={reorderClips}
          globalTransition={globalTransition}
          onTransitionChange={setGlobalTransition}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
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
            <div className="flex items-center gap-4">
              <ModeSwitcher
                mode={editorMode}
                onModeChange={handleModeChange}
                disabled={!videoUrl}
              />
              <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
            </div>
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
              {/* AspectRatioSelector only visible in Framing mode */}
              {/* Uses global aspect ratio that applies to all clips */}
              {/* When hasClips, updates BOTH the clips array AND the current clip's live keyframes */}
              {editorMode === 'framing' && (
                <AspectRatioSelector
                  aspectRatio={hasClips ? globalAspectRatio : aspectRatio}
                  onAspectRatioChange={hasClips ? (newRatio) => {
                    // Update stored clips' keyframes
                    setGlobalAspectRatio(newRatio);
                    // Also update current clip's live keyframes (managed by useCrop)
                    updateAspectRatio(newRatio);
                  } : updateAspectRatio}
                />
              )}
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

          {/* Video Player with mode-specific overlays */}
          {/* In Overlay mode, use overlay video if available */}
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={editorMode === 'overlay' && overlayVideoUrl ? overlayVideoUrl : videoUrl}
            handlers={handlers}
            onFileSelect={handleFileSelect}
            overlays={[
              // Framing mode overlay (CropOverlay)
              editorMode === 'framing' && videoUrl && currentCropState && metadata && (
                <CropOverlay
                  key="crop"
                  videoRef={videoRef}
                  videoMetadata={metadata}
                  currentCrop={currentCropState}
                  aspectRatio={aspectRatio}
                  onCropChange={handleCropChange}
                  onCropComplete={handleCropComplete}
                  zoom={zoom}
                  panOffset={panOffset}
                  selectedKeyframeIndex={selectedCropKeyframeIndex}
                />
              ),
              // Overlay mode overlay (HighlightOverlay) - uses overlay video metadata
              editorMode === 'overlay' && overlayVideoUrl && currentHighlightState && overlayVideoMetadata && (
                <HighlightOverlay
                  key="highlight"
                  videoRef={videoRef}
                  videoMetadata={overlayVideoMetadata}
                  currentHighlight={currentHighlightState}
                  onHighlightChange={handleHighlightChange}
                  onHighlightComplete={handleHighlightComplete}
                  isEnabled={isHighlightEnabled}
                  effectType={highlightEffectType}
                  zoom={zoom}
                  panOffset={panOffset}
                />
              ),
            ].filter(Boolean)}
            zoom={zoom}
            panOffset={panOffset}
            onZoomChange={zoomByWheel}
            onPanChange={updatePan}
          />

          {/* Mode-specific content (overlays + timelines) */}
          {videoUrl && editorMode === 'framing' && (
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
              onCropChange={handleCropChange}
              onCropComplete={handleCropComplete}
              onCropKeyframeClick={handleKeyframeClick}
              onCropKeyframeDelete={handleKeyframeDelete}
              onCropKeyframeCopy={handleCopyCrop}
              onCropKeyframePaste={handlePasteCrop}
              zoom={zoom}
              panOffset={panOffset}
              segments={segments}
              segmentBoundaries={segmentBoundaries}
              segmentVisualLayout={segmentVisualLayout}
              visualDuration={visualDuration || duration}
              trimRange={trimRange}
              trimHistory={trimHistory}
              onAddSegmentBoundary={addSegmentBoundary}
              onRemoveSegmentBoundary={removeSegmentBoundary}
              onSegmentSpeedChange={setSegmentSpeed}
              onSegmentTrim={handleTrimSegment}
              onDetrimStart={handleDetrimStart}
              onDetrimEnd={handleDetrimEnd}
              sourceTimeToVisualTime={sourceTimeToVisualTime}
              visualTimeToSourceTime={visualTimeToSourceTime}
              selectedLayer={selectedLayer}
              onLayerSelect={setSelectedLayer}
              onSeek={seek}
              timelineZoom={timelineZoom}
              onTimelineZoomByWheel={timelineZoomByWheel}
              timelineScale={getTimelineScale()}
              timelineScrollPosition={timelineScrollPosition}
              onTimelineScrollPositionChange={updateTimelineScrollPosition}
            />
          )}

          {/* Overlay mode requires overlayVideoUrl (rendered from Framing) */}
          {overlayVideoUrl && editorMode === 'overlay' && (
            <OverlayMode
              videoRef={videoRef}
              videoUrl={overlayVideoUrl}
              metadata={overlayVideoMetadata}
              currentTime={currentTime}
              duration={overlayVideoMetadata?.duration || duration}
              highlightContextValue={highlightContextValue}
              currentHighlightState={currentHighlightState}
              isHighlightEnabled={isHighlightEnabled}
              highlightKeyframes={highlightKeyframes}
              highlightFramerate={highlightFramerate}
              highlightDuration={highlightDuration}
              selectedHighlightKeyframeIndex={selectedHighlightKeyframeIndex}
              copiedHighlight={copiedHighlight}
              onHighlightChange={handleHighlightChange}
              onHighlightComplete={handleHighlightComplete}
              onHighlightKeyframeClick={handleHighlightKeyframeClick}
              onHighlightKeyframeDelete={handleHighlightKeyframeDelete}
              onHighlightKeyframeCopy={handleCopyHighlight}
              onHighlightKeyframePaste={handlePasteHighlight}
              onHighlightToggleEnabled={toggleHighlightEnabled}
              onHighlightDurationChange={handleHighlightDurationChange}
              zoom={zoom}
              panOffset={panOffset}
              visualDuration={overlayVideoMetadata?.duration || duration}
              selectedLayer={selectedLayer}
              onLayerSelect={setSelectedLayer}
              onSeek={seek}
              // NOTE: Overlay mode uses identity functions - no segment transformations
              // The overlay video is a fresh render without speed/trim segments
              sourceTimeToVisualTime={(t) => t}
              visualTimeToSourceTime={(t) => t}
              timelineZoom={timelineZoom}
              onTimelineZoomByWheel={timelineZoomByWheel}
              timelineScale={getTimelineScale()}
              timelineScrollPosition={timelineScrollPosition}
              onTimelineScrollPositionChange={updateTimelineScrollPosition}
              trimRange={null}  // No trimming in overlay mode
            />
          )}

          {/* Message when in Overlay mode but no overlay video */}
          {editorMode === 'overlay' && !overlayVideoUrl && videoUrl && (
            <div className="mt-6 bg-purple-900/30 border border-purple-500/50 rounded-lg p-6 text-center">
              <p className="text-purple-200 font-medium mb-2">
                No overlay video available
              </p>
              <p className="text-purple-300/70 text-sm mb-4">
                Export from Framing mode first to create a video for overlay editing.
              </p>
              <button
                onClick={() => handleModeChange('framing')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Switch to Framing Mode
              </button>
            </div>
          )}

          {/* Controls - show for current mode's video */}
          {((editorMode === 'framing' && videoUrl) || (editorMode === 'overlay' && overlayVideoUrl)) && (
            <div className="mt-6">
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={editorMode === 'overlay' ? (overlayVideoMetadata?.duration || duration) : duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
              />
            </div>
          )}

          {/* Export Button - show for current mode's video */}
          {((editorMode === 'framing' && videoUrl) || (editorMode === 'overlay' && overlayVideoUrl)) && (
            <div className="mt-6">
              <ExportButton
                videoFile={editorMode === 'overlay' ? overlayVideoFile : videoFile}
                cropKeyframes={editorMode === 'framing' ? getFilteredKeyframesForExport : []}
                highlightKeyframes={editorMode === 'overlay' ? getFilteredHighlightKeyframesForExport : []}
                isHighlightEnabled={editorMode === 'overlay' && isHighlightEnabled}
                segmentData={editorMode === 'framing' ? getSegmentExportData() : null}
                disabled={editorMode === 'framing' ? !videoFile : !overlayVideoFile}
                includeAudio={includeAudio}
                onIncludeAudioChange={setIncludeAudio}
                highlightEffectType={highlightEffectType}
                onHighlightEffectTypeChange={setHighlightEffectType}
                editorMode={editorMode}
                onProceedToOverlay={handleProceedToOverlay}
                // Multi-clip props (use clipsWithCurrentState to include current clip's live keyframes)
                clips={editorMode === 'framing' && hasClips ? clipsWithCurrentState : null}
                globalAspectRatio={globalAspectRatio}
                globalTransition={globalTransition}
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
      </div>

      {/* Debug Info - Shows current branch and commit */}
      <DebugInfo />
    </div>
  );
}

export default App;
