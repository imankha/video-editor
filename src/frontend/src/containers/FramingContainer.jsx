import { useEffect, useCallback, useMemo, useRef } from 'react';
import { FramingMode, CropOverlay } from '../modes/framing';
import { API_BASE } from '../config';
import * as framingActions from '../api/framingActions';

/**
 * FramingContainer - Encapsulates Framing mode logic and computed state
 *
 * This container receives state from App.jsx's hooks (useCrop, useSegments, useClipManager)
 * and returns derived state and handlers specific to Framing mode.
 *
 * Pattern: Takes state as props, returns derived values and handlers (like OverlayContainer)
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
  isPlaying,
  seek,

  // Project context
  selectedProjectId,
  selectedProject,

  // Editor mode
  editorMode,
  setEditorMode,

  // Crop state and actions (from useCrop in App.jsx)
  keyframes,
  aspectRatio,
  framerate,
  isEndKeyframeExplicit,
  copiedCrop,
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
  resetCrop,

  // Segment state and actions (from useSegments in App.jsx)
  segments,
  segmentBoundaries,
  segmentSpeeds,
  trimRange,
  trimHistory,
  sourceDuration,
  visualDuration,
  trimmedDuration,
  segmentVisualLayout,
  segmentFramerate,
  initializeSegments,
  resetSegments,
  restoreSegmentState,
  addSegmentBoundary,
  removeSegmentBoundary,
  setSegmentSpeed,
  toggleTrimSegment,
  getSegmentAtTime,
  getSegmentExportData,
  isTimeVisible,
  clampToVisibleRange,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,
  createFrameRangeKey,
  isSegmentTrimmed,
  detrimStart,
  detrimEnd,

  // Clip state and actions (from useClipManager in App.jsx)
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
  getClipExportData,

  // Highlight hook (for coordinated trim operations)
  highlightHook,

  // Project clips hook (for backend persistence)
  saveFramingEdits,

  // Callbacks
  onCropChange,
  onUserEdit,
  setFramingChangedSinceExport,
}) {
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
      // Save to local clip manager state
      updateClipData(selectedClipId, {
        segments: segmentState,
        cropKeyframes: keyframes,
        trimRange: trimRange
      });

      // Save to backend (use frame-based keyframes for storage - FFmpeg conversion happens at export)
      if (saveFramingEdits) {
        // Store raw frame-based keyframes - time conversion happens only at FFmpeg export
        const exportSegments = getSegmentExportData();
        const result = await saveFramingEdits(currentClip.workingClipId, {
          cropKeyframes: keyframes,  // Frame-based - NOT time-based
          segments: exportSegments,
          trimRange: trimRange
        });

        // If backend created a new version, update local clip's workingClipId
        if (result?.newClipId) {
          console.log('[FramingContainer] Clip versioned, updating workingClipId:', currentClip.workingClipId, '->', result.newClipId);
          updateClipData(selectedClipId, { workingClipId: result.newClipId });
        }
      }

      console.log('[FramingContainer] Saved framing state for clip:', selectedClipId);
    } catch (e) {
      console.error('[FramingContainer] Failed to save framing state:', e);
    }
  }, [selectedClipId, selectedProjectId, clips, keyframes, segmentBoundaries, segmentSpeeds, trimRange, updateClipData, saveFramingEdits, getKeyframesForExport, getSegmentExportData]);

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
    setFramingChangedSinceExport?.(true);

    // Dispatch action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      framingActions.addCropKeyframe(selectedProjectId, workingClipId, {
        frame,
        x: cropData.x,
        y: cropData.y,
        width: cropData.width,
        height: cropData.height,
        origin: 'user'
      }).catch(err => console.error('[FramingContainer] Failed to sync addCropKeyframe:', err));
    }
  }, [currentTime, framerate, duration, addOrUpdateKeyframe, onCropChange, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

  /**
   * Coordinated segment trim handler
   *
   * IMPORTANT: Always ensures permanent keyframes exist at trim boundaries.
   * When trimming, we:
   * 1. Find the crop data from the segment being trimmed (prioritize edge closest to boundary)
   * 2. Delete all keyframes in the trimmed range
   * 3. Reconstitute a permanent keyframe at the new boundary
   */
  const handleTrimSegment = useCallback((segmentIndex) => {
    if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

    clipHasUserEditsRef.current = true;

    const segment = segments[segmentIndex];
    const isCurrentlyTrimmed = segment.isTrimmed;

    console.log(`[FramingContainer] Trim segment ${segmentIndex}`, { segment, isCurrentlyTrimmed });

    if (!isCurrentlyTrimmed) {
      // We're about to trim this segment
      let boundaryTime;

      if (segment.isLast) {
        boundaryTime = segment.start;
      } else if (segment.isFirst) {
        boundaryTime = segment.end;
      }

      // Tolerance for floating point comparisons (1 frame at 30fps = ~0.033s)
      const TOLERANCE = 1 / framerate + 0.001;

      // Find crop data to preserve - use tolerance for boundary checks
      // Prioritize the edge that will become the new boundary
      let cropDataToPreserve = null;

      // First, try to get data from the boundary time itself (interpolated)
      // This ensures we get the crop state at the exact new boundary
      const edgeTime = segment.isLast ? segment.end : segment.start;
      cropDataToPreserve = getCropDataAtTime(boundaryTime);

      // If that fails, try the opposite edge (for cases where keyframe is at far end)
      if (!cropDataToPreserve) {
        cropDataToPreserve = getCropDataAtTime(edgeTime);
      }

      // Fallback: search for any keyframe within the trimmed range (with tolerance)
      if (!cropDataToPreserve) {
        for (let i = keyframes.length - 1; i >= 0; i--) {
          const kfTime = keyframes[i].frame / framerate;
          // Use tolerance for boundary checks to handle floating point precision
          if (kfTime >= segment.start - TOLERANCE && kfTime <= segment.end + TOLERANCE) {
            cropDataToPreserve = getCropDataAtTime(kfTime);
            console.log(`[FramingContainer] Found keyframe in trimmed range at time ${kfTime}`);
            break;
          }
        }
      }

      console.log(`[FramingContainer] Crop data to preserve:`, cropDataToPreserve, `boundaryTime:`, boundaryTime);

      // Delete crop keyframes in trimmed range
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Reconstitute permanent keyframe at boundary
      // This ensures there's always a keyframe at the new end/start of the visible timeline
      if (cropDataToPreserve && boundaryTime !== undefined) {
        console.log(`[FramingContainer] Reconstituting permanent keyframe at ${boundaryTime}`);
        addOrUpdateKeyframe(boundaryTime, cropDataToPreserve, duration, 'permanent');
      } else if (boundaryTime !== undefined) {
        // Emergency fallback: if we couldn't preserve any data, get current interpolated crop
        // This shouldn't happen in normal use, but ensures we always have boundary keyframes
        console.warn(`[FramingContainer] No crop data found, using current interpolated state`);
        const fallbackData = getCropDataAtTime(boundaryTime);
        if (fallbackData) {
          addOrUpdateKeyframe(boundaryTime, fallbackData, duration, 'permanent');
        }
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
    setFramingChangedSinceExport?.(true);

    // Dispatch trim action to backend (fire-and-forget)
    // Compute the new trim range after this toggle
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      // Calculate new trim boundaries based on which segment was toggled
      let newTrimStart = trimRange?.start ?? null;
      let newTrimEnd = trimRange?.end ?? null;

      if (!isCurrentlyTrimmed) {
        // We just trimmed this segment
        if (segment.isFirst) {
          newTrimStart = segment.end;
        } else if (segment.isLast) {
          newTrimEnd = segment.start;
        }
      } else {
        // We just untrimmed this segment - handled by detrim handlers
      }

      if (newTrimStart !== null || newTrimEnd !== null) {
        framingActions.setTrimRange(selectedProjectId, workingClipId, newTrimStart ?? 0, newTrimEnd ?? duration)
          .catch(err => console.error('[FramingContainer] Failed to sync setTrimRange:', err));
      }
    }
  }, [duration, segments, keyframes, framerate, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, toggleTrimSegment, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, trimRange]);

  /**
   * Coordinated de-trim handler for start
   * Restores the start of the timeline and ensures permanent keyframe at frame 0
   */
  const handleDetrimStart = useCallback(() => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const FRAME_TOLERANCE = 1;

    // Handle crop keyframes
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    if (boundaryFrame > 0) {
      // Find keyframe at boundary using tolerance
      const cropKfAtBoundary = keyframes.find(kf =>
        Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
      );
      if (cropKfAtBoundary) {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Always ensure permanent keyframe at start (frame 0)
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(0, cropDataAtBoundary, duration, 'permanent');
    } else {
      // Fallback: use interpolated data at frame 0
      const fallbackData = getCropDataAtTime(0);
      if (fallbackData) {
        addOrUpdateKeyframe(0, fallbackData, duration, 'permanent');
      }
    }

    // Handle highlight keyframes if available
    if (highlightHook) {
      const highlightDataAtBoundary = highlightHook.getHighlightDataAtTime?.(boundaryTime);
      if (boundaryFrame > 0) {
        // Use tolerance for highlight keyframe matching too
        const highlightKfAtBoundary = highlightHook.keyframes?.find(kf =>
          Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
        );
        if (highlightKfAtBoundary) {
          highlightHook.deleteKeyframesInRange?.(boundaryTime - 0.001, boundaryTime + 0.001, duration);
        }
      }
      // Always ensure permanent keyframe at start
      if (highlightDataAtBoundary) {
        highlightHook.addOrUpdateKeyframe?.(0, highlightDataAtBoundary, duration, 'permanent');
      }
    }

    detrimStart();
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch trim action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      // After detrimStart, trim start is cleared (0), trim end remains
      const newTrimEnd = trimRange.end;
      if (newTrimEnd && newTrimEnd < duration) {
        framingActions.setTrimRange(selectedProjectId, workingClipId, 0, newTrimEnd)
          .catch(err => console.error('[FramingContainer] Failed to sync setTrimRange (detrimStart):', err));
      } else {
        // No more trim, clear it
        framingActions.clearTrimRange(selectedProjectId, workingClipId)
          .catch(err => console.error('[FramingContainer] Failed to sync clearTrimRange:', err));
      }
    }
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, detrimStart, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

  /**
   * Coordinated de-trim handler for end
   * Restores the end of the timeline and ensures permanent keyframe at duration
   */
  const handleDetrimEnd = useCallback(() => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);
    const FRAME_TOLERANCE = 1;

    // Handle crop keyframes
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);

    if (boundaryFrame < endFrame) {
      // Find keyframe at boundary using tolerance
      const cropKfAtBoundary = keyframes.find(kf =>
        Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
      );
      if (cropKfAtBoundary) {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Always ensure permanent keyframe at end (duration)
    if (cropDataAtBoundary) {
      addOrUpdateKeyframe(duration, cropDataAtBoundary, duration, 'permanent');
    } else {
      // Fallback: use interpolated data at duration
      const fallbackData = getCropDataAtTime(duration);
      if (fallbackData) {
        addOrUpdateKeyframe(duration, fallbackData, duration, 'permanent');
      }
    }

    // Handle highlight keyframes if available
    if (highlightHook) {
      const highlightDataAtBoundary = highlightHook.getHighlightDataAtTime?.(boundaryTime);
      const highlightDuration = highlightHook.duration || duration;
      const highlightEndFrame = Math.round(highlightDuration * (highlightHook.framerate || 30));

      if (boundaryFrame < highlightEndFrame) {
        // Use tolerance for highlight keyframe matching too
        const highlightKfAtBoundary = highlightHook.keyframes?.find(kf =>
          Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
        );
        if (highlightKfAtBoundary) {
          highlightHook.deleteKeyframesInRange?.(boundaryTime - 0.001, boundaryTime + 0.001, duration);
        }
      }
      // Always ensure permanent keyframe at end
      if (highlightDataAtBoundary) {
        highlightHook.addOrUpdateKeyframe?.(highlightDuration, highlightDataAtBoundary, duration, 'permanent');
      }
    }

    detrimEnd();
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch trim action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      // After detrimEnd, trim end is cleared (duration), trim start remains
      const newTrimStart = trimRange.start;
      if (newTrimStart && newTrimStart > 0) {
        framingActions.setTrimRange(selectedProjectId, workingClipId, newTrimStart, duration)
          .catch(err => console.error('[FramingContainer] Failed to sync setTrimRange (detrimEnd):', err));
      } else {
        // No more trim, clear it
        framingActions.clearTrimRange(selectedProjectId, workingClipId)
          .catch(err => console.error('[FramingContainer] Failed to sync clearTrimRange:', err));
      }
    }
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, detrimEnd, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

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
    const frame = Math.round(time * framerate);
    clipHasUserEditsRef.current = true;
    removeKeyframe(time, duration);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      framingActions.deleteCropKeyframe(selectedProjectId, workingClipId, frame)
        .catch(err => console.error('[FramingContainer] Failed to sync deleteCropKeyframe:', err));
    }
  }, [duration, framerate, removeKeyframe, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

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
      setFramingChangedSinceExport?.(true);

      // Dispatch action to backend (fire-and-forget)
      const workingClipId = selectedClip?.workingClipId;
      if (selectedProjectId && workingClipId) {
        const frame = Math.round(time * framerate);
        framingActions.addCropKeyframe(selectedProjectId, workingClipId, {
          frame,
          x: copiedCrop.x,
          y: copiedCrop.y,
          width: copiedCrop.width,
          height: copiedCrop.height,
          origin: 'user'
        }).catch(err => console.error('[FramingContainer] Failed to sync addCropKeyframe (paste):', err));
      }
    }
  }, [videoUrl, currentTime, copiedCrop, duration, framerate, pasteCropKeyframe, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

  /**
   * Handle segment boundary add (split)
   */
  const handleAddSplit = useCallback((time) => {
    clipHasUserEditsRef.current = true;
    addSegmentBoundary(time);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      framingActions.splitSegment(selectedProjectId, workingClipId, time)
        .catch(err => console.error('[FramingContainer] Failed to sync splitSegment:', err));
    }
  }, [addSegmentBoundary, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

  /**
   * Handle segment boundary remove
   */
  const handleRemoveSplit = useCallback((time) => {
    clipHasUserEditsRef.current = true;
    removeSegmentBoundary(time);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      framingActions.removeSegmentSplit(selectedProjectId, workingClipId, time)
        .catch(err => console.error('[FramingContainer] Failed to sync removeSegmentSplit:', err));
    }
  }, [removeSegmentBoundary, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

  /**
   * Handle segment speed change
   */
  const handleSegmentSpeedChange = useCallback((segmentIndex, speed) => {
    clipHasUserEditsRef.current = true;
    setSegmentSpeed(segmentIndex, speed);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Dispatch action to backend (fire-and-forget)
    const workingClipId = selectedClip?.workingClipId;
    if (selectedProjectId && workingClipId) {
      framingActions.setSegmentSpeed(selectedProjectId, workingClipId, segmentIndex, speed)
        .catch(err => console.error('[FramingContainer] Failed to sync setSegmentSpeed:', err));
    }
  }, [setSegmentSpeed, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip]);

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

  // Ref to hold the latest save function (avoids stale closures and infinite loops)
  const saveCurrentClipStateRef = useRef(saveCurrentClipState);
  useEffect(() => {
    saveCurrentClipStateRef.current = saveCurrentClipState;
  }, [saveCurrentClipState]);

  // Effect: Auto-save framing data when keyframes/segments change
  // IMPORTANT: Only trigger on actual data changes, not on function/clips reference changes
  useEffect(() => {
    if (editorMode !== 'framing' || !selectedClipId || !selectedProjectId) return;
    if (!clipHasUserEditsRef.current) return;

    // Debounce save - clear any pending timeout
    if (pendingFramingSaveRef.current) {
      clearTimeout(pendingFramingSaveRef.current);
    }

    pendingFramingSaveRef.current = setTimeout(async () => {
      // Use ref to get latest function without it being in deps
      await saveCurrentClipStateRef.current();
    }, 100); // Near-immediate save (small debounce prevents rapid-fire during drag)

    // Cleanup on unmount or when deps change
    return () => {
      if (pendingFramingSaveRef.current) {
        clearTimeout(pendingFramingSaveRef.current);
      }
    };
  }, [keyframes, segmentBoundaries, segmentSpeeds, trimRange, editorMode, selectedClipId, selectedProjectId]);

  return {
    // Derived state
    currentCropState,
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
    handleAddSplit,
    handleRemoveSplit,
    handleSegmentSpeedChange,

    // Persistence
    saveCurrentClipState,
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
