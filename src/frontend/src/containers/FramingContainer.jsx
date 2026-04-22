import { useEffect, useCallback, useMemo, useRef } from 'react';
import { FramingMode, CropOverlay } from '../modes/framing';
import { API_BASE } from '../config';
import * as framingActions from '../api/framingActions';
import { clipCropKeyframes } from '../utils/clipSelectors';
import { toast } from '../components/shared';

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
  setCropEndFrame,
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

  // Video metadata cache (keyed by clip ID)
  clipMetadataCache = {},

  // Project clips hook (for backend persistence)
  saveFramingEdits,

  // Callbacks
  onCropChange,
  onUserEdit,
  setFramingChangedSinceExport,
}) {
  // Ref to track if user has made edits (for clip switching save decision)
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
      // Ensure duration is always set from the metadata cache (raw clips from
      // backend don't include duration — it's extracted from the video file)
      const clipDuration = clipMetadataCache[clip.id]?.duration ?? clip.duration;

      if (clip.id === selectedClipId) {
        // Only override cropKeyframes when the hook has initialized.
        // Before useCrop auto-init, getKeyframesForExport() returns [] which
        // would erase the clip's existing crop_data.
        const merged = {
          ...clip,
          duration: clipDuration,
          segments: {
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: trimRange
          },
          trimRange: trimRange
        };
        if (currentClipExportKeyframes.length > 0) {
          merged.cropKeyframes = currentClipExportKeyframes;
        }
        return merged;
      }

      // T250: Raw clips store crop_data (JSON string), not cropKeyframes (array).
      // Parse crop_data first, then convert frame-based to time-based.
      const parsedKeyframes = clipCropKeyframes(clip);
      const meta = clipMetadataCache[clip.id];
      const clipFr = meta?.framerate || 30;
      let convertedKeyframes = convertKeyframesToTime(parsedKeyframes, clipFr);

      const sourceWidth = meta?.width;
      const sourceHeight = meta?.height;
      const metaDuration = meta?.duration;
      if (convertedKeyframes.length === 0 && sourceWidth && sourceHeight && metaDuration) {
        const defaultCrop = calculateDefaultCrop(sourceWidth, sourceHeight, globalAspectRatio);
        convertedKeyframes = [
          { time: 0, ...defaultCrop },
          { time: metaDuration, ...defaultCrop }
        ];
      }

      return {
        ...clip,
        cropKeyframes: convertedKeyframes,
        sourceWidth,
        sourceHeight,
        duration: clipDuration, // from metadata cache (set at top of map)
        framerate: clipFr,
      };
    });
  }, [clips, selectedClipId, getKeyframesForExport, segmentBoundaries, segmentSpeeds, trimRange, hasClips, globalAspectRatio, clipMetadataCache]);

  /**
   * Save current clip's framing state to backend
   */
  const saveCurrentClipState = useCallback(async () => {
    if (!selectedClipId || !selectedProjectId) return;

    const currentClip = clips.find(c => c.id === selectedClipId);
    if (!currentClip?.id) return;

    const segmentState = {
      boundaries: segmentBoundaries,
      segmentSpeeds: segmentSpeeds,
      trimRange: trimRange,
    };

    try {
      // Save to local clip manager state (raw backend JSON format)
      // T280: No timing_data — trimRange lives in segments_data only
      updateClipData(selectedClipId, {
        segments_data: JSON.stringify(segmentState),
        crop_data: JSON.stringify(keyframes),
      });

      // Save to backend (use frame-based keyframes for storage - FFmpeg conversion happens at export)
      if (saveFramingEdits) {
        const result = await saveFramingEdits(currentClip.id, {
          cropKeyframes: keyframes,  // Frame-based - NOT time-based
          segments: segmentState,    // Internal format preserves segment indices
          trimRange: trimRange
        });

        // If backend created a new version, update local clip's id
        if (result?.newClipId) {
          updateClipData(selectedClipId, { id: result.newClipId });
        }
      }

    } catch (e) {
      console.error('[FramingContainer] Failed to save framing state:', e);
    }
  }, [selectedClipId, selectedProjectId, clips, keyframes, segmentBoundaries, segmentSpeeds, trimRange, updateClipData, saveFramingEdits, getKeyframesForExport]);

  /**
   * Handle crop changes during drag/resize (live preview)
   */
  const handleCropChange = useCallback((newCrop) => {
    onCropChange?.(newCrop);
  }, [onCropChange]);

  /**
   * Handle crop complete (create keyframe)
   */
  const handleCropComplete = useCallback(async (cropData) => {
    const frame = Math.round(currentTime * framerate);
    const callerClipId = selectedClipId;

    // Capture pre-existing keyframe for rollback (may be null if no keyframe at this frame)
    const previousKfData = getCropDataAtTime(currentTime);
    const previousKf = keyframes.find(kf => kf.frame === frame);
    const previousStoreKfs = clipCropKeyframes(selectedClip) || [];

    clipHasUserEditsRef.current = true;
    addOrUpdateKeyframe(currentTime, cropData, duration);
    onCropChange?.(null);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Optimistically update clip store so sidebar framing indicator reflects the change immediately.
    // (crop_data in the store is otherwise only written on export via saveCurrentClipState)
    const newKf = { frame, x: cropData.x, y: cropData.y, width: cropData.width, height: cropData.height, origin: 'user' };
    if (callerClipId) {
      const updatedKfs = [...previousStoreKfs.filter(kf => kf.frame !== frame), newKf];
      updateClipData(callerClipId, { crop_data: JSON.stringify(updatedKfs) });
    }

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      const result = await framingActions.addCropKeyframe(selectedProjectId, clipId, {
        frame,
        x: cropData.x,
        y: cropData.y,
        width: cropData.width,
        height: cropData.height,
        origin: 'user'
      });
      if (!result.success && selectedClipId === callerClipId) {
        // Rollback: restore previous keyframe or remove the new one
        if (previousKf && previousKfData) {
          addOrUpdateKeyframe(currentTime, previousKfData, duration, previousKf.origin);
        } else {
          removeKeyframe(currentTime, duration);
        }
        if (callerClipId) {
          updateClipData(callerClipId, { crop_data: JSON.stringify(previousStoreKfs) });
        }
        clipHasUserEditsRef.current = false;
        setFramingChangedSinceExport?.(false);
        toast.error('Failed to save crop keyframe', { message: result.error });
      }
    }
  }, [currentTime, framerate, duration, keyframes, getCropDataAtTime, addOrUpdateKeyframe, removeKeyframe, onCropChange, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, updateClipData]);

  /**
   * Coordinated segment trim handler
   *
   * IMPORTANT: Always ensures permanent keyframes exist at trim boundaries.
   * When trimming, we:
   * 1. Find the crop data from the segment being trimmed (prioritize edge closest to boundary)
   * 2. Delete all keyframes in the trimmed range
   * 3. Reconstitute a permanent keyframe at the new boundary
   */
  const handleTrimSegment = useCallback(async (segmentIndex) => {
    if (!duration || segmentIndex < 0 || segmentIndex >= segments.length) return;

    clipHasUserEditsRef.current = true;

    const segment = segments[segmentIndex];
    const isCurrentlyTrimmed = segment.isTrimmed;

    // Identify user keyframes in trim range for Phase 3 persistence
    let userKfsToDelete = [];
    let boundaryKfToAdd = null;

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

      // Capture user keyframes in range before deleting (for backend persistence)
      userKfsToDelete = keyframes.filter(kf => {
        const kfTime = kf.frame / framerate;
        return kfTime >= segment.start - TOLERANCE && kfTime <= segment.end + TOLERANCE && kf.origin === 'user';
      });

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
            break;
          }
        }
      }


      // Delete crop keyframes in trimmed range
      deleteKeyframesInRange(segment.start, segment.end, duration);

      // Update controller's endFrame when trimming the end, or re-enforce
      // boundaries when trimming the start (deleteKeyframesInRange removes
      // frame 0, and ensurePermanentKeyframes in SET_END_FRAME restores it)
      if (segment.isLast && boundaryTime !== undefined) {
        setCropEndFrame(Math.round(boundaryTime * framerate));
      } else if (segment.isFirst) {
        // endFrame unchanged but need ensurePermanentKeyframes to restore frame 0
        const currentEndFrame = Math.round((trimRange?.end ?? duration) * framerate);
        setCropEndFrame(currentEndFrame);
      }

      // Reconstitute permanent keyframe at boundary
      // This ensures there's always a keyframe at the new end/start of the visible timeline
      if (cropDataToPreserve && boundaryTime !== undefined) {
        addOrUpdateKeyframe(boundaryTime, cropDataToPreserve, duration, 'permanent');
        boundaryKfToAdd = {
          frame: Math.round(boundaryTime * framerate),
          x: cropDataToPreserve.x,
          y: cropDataToPreserve.y,
          width: cropDataToPreserve.width,
          height: cropDataToPreserve.height,
          origin: 'permanent'
        };
      } else if (boundaryTime !== undefined) {
        // Emergency fallback: if we couldn't preserve any data, get current interpolated crop
        // This shouldn't happen in normal use, but ensures we always have boundary keyframes
        const fallbackData = getCropDataAtTime(boundaryTime);
        if (fallbackData) {
          addOrUpdateKeyframe(boundaryTime, fallbackData, duration, 'permanent');
          boundaryKfToAdd = {
            frame: Math.round(boundaryTime * framerate),
            x: fallbackData.x,
            y: fallbackData.y,
            width: fallbackData.width,
            height: fallbackData.height,
            origin: 'permanent'
          };
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

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      let hasError = false;

      // Phase 3: Persist keyframe changes from trim operation
      if (!isCurrentlyTrimmed) {
        // Delete user keyframes that were in the trimmed range
        for (const kf of userKfsToDelete) {
          const result = await framingActions.deleteCropKeyframe(selectedProjectId, clipId, kf.frame);
          if (!result.success) hasError = true;
        }
        // Add boundary permanent keyframe
        if (boundaryKfToAdd) {
          const result = await framingActions.addCropKeyframe(selectedProjectId, clipId, boundaryKfToAdd);
          if (!result.success) hasError = true;
        }
      }

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
        const result = await framingActions.setTrimRange(selectedProjectId, clipId, newTrimStart ?? 0, newTrimEnd ?? duration);
        if (!result.success) hasError = true;
      }

      if (hasError) {
        toast.error('Failed to save trim changes');
      }

      // Update store so sidebar framing indicator reflects trim
      if (selectedClipId) {
        updateClipData(selectedClipId, {
          segments_data: JSON.stringify({
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: !isCurrentlyTrimmed
              ? { start: newTrimStart ?? 0, end: newTrimEnd ?? duration }
              : trimRange,
          })
        });
      }
    }
  }, [duration, segments, keyframes, framerate, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, setCropEndFrame, toggleTrimSegment, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, trimRange, segmentBoundaries, segmentSpeeds, updateClipData]);

  /**
   * Coordinated de-trim handler for start
   * Restores the start of the timeline and ensures permanent keyframe at frame 0
   */
  const handleDetrimStart = useCallback(async () => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.start;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const FRAME_TOLERANCE = 1;

    // Handle crop keyframes
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);
    let boundaryKfToAdd = null;

    if (boundaryFrame > 0) {
      // Find keyframe at boundary using tolerance
      const cropKfAtBoundary = keyframes.find(kf =>
        Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
      );
      if (cropKfAtBoundary) {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // If removing start trim clears all trimming, update endFrame to full duration
    const newTrimEnd = trimRange.end;
    if (!newTrimEnd || newTrimEnd >= duration) {
      const fullEndFrame = Math.round(duration * framerate);
      setCropEndFrame(fullEndFrame);
    }

    // Always ensure permanent keyframe at start (frame 0)
    const dataForStart = cropDataAtBoundary || getCropDataAtTime(0);
    if (dataForStart) {
      addOrUpdateKeyframe(0, dataForStart, duration, 'permanent');
      boundaryKfToAdd = {
        frame: 0,
        x: dataForStart.x,
        y: dataForStart.y,
        width: dataForStart.width,
        height: dataForStart.height,
        origin: 'permanent'
      };
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

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      let hasError = false;

      // Phase 3: Persist boundary keyframe change
      if (boundaryKfToAdd) {
        const result = await framingActions.addCropKeyframe(selectedProjectId, clipId, boundaryKfToAdd);
        if (!result.success) hasError = true;
      }

      // After detrimStart, trim start is cleared (0), trim end remains
      const newTrimEnd = trimRange.end;
      if (newTrimEnd && newTrimEnd < duration) {
        const result = await framingActions.setTrimRange(selectedProjectId, clipId, 0, newTrimEnd);
        if (!result.success) hasError = true;
      } else {
        // No more trim, clear it
        const result = await framingActions.clearTrimRange(selectedProjectId, clipId);
        if (!result.success) hasError = true;
      }

      if (hasError) {
        toast.error('Failed to save detrim changes');
      }

      // Sync segments to store so sidebar indicator updates
      if (selectedClipId) {
        updateClipData(selectedClipId, {
          segments_data: JSON.stringify({
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: newTrimEnd && newTrimEnd < duration
              ? { start: 0, end: newTrimEnd }
              : null,
          })
        });
      }
    }
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, setCropEndFrame, detrimStart, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, segmentBoundaries, segmentSpeeds, updateClipData]);

  /**
   * Coordinated de-trim handler for end
   * Restores the end of the timeline and ensures permanent keyframe at duration
   */
  const handleDetrimEnd = useCallback(async () => {
    if (!trimRange || !duration) return;

    clipHasUserEditsRef.current = true;

    const boundaryTime = trimRange.end;
    const boundaryFrame = Math.round(boundaryTime * framerate);
    const endFrame = Math.round(duration * framerate);
    const FRAME_TOLERANCE = 1;

    // Handle crop keyframes
    const cropDataAtBoundary = getCropDataAtTime(boundaryTime);
    let boundaryKfToAdd = null;

    if (boundaryFrame < endFrame) {
      // Find keyframe at boundary using tolerance
      const cropKfAtBoundary = keyframes.find(kf =>
        Math.abs(kf.frame - boundaryFrame) <= FRAME_TOLERANCE && kf.origin === 'permanent'
      );
      if (cropKfAtBoundary) {
        deleteKeyframesInRange(boundaryTime - 0.001, boundaryTime + 0.001, duration);
      }
    }

    // Update controller's endFrame to full video duration (trim end is being removed)
    setCropEndFrame(endFrame);

    // Always ensure permanent keyframe at end (duration)
    const dataForEnd = cropDataAtBoundary || getCropDataAtTime(duration);
    if (dataForEnd) {
      addOrUpdateKeyframe(duration, dataForEnd, duration, 'permanent');
      boundaryKfToAdd = {
        frame: endFrame,
        x: dataForEnd.x,
        y: dataForEnd.y,
        width: dataForEnd.width,
        height: dataForEnd.height,
        origin: 'permanent'
      };
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

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      let hasError = false;

      // Phase 3: Persist boundary keyframe change
      if (boundaryKfToAdd) {
        const result = await framingActions.addCropKeyframe(selectedProjectId, clipId, boundaryKfToAdd);
        if (!result.success) hasError = true;
      }

      // After detrimEnd, trim end is cleared (duration), trim start remains
      const newTrimStart = trimRange.start;
      if (newTrimStart && newTrimStart > 0) {
        const result = await framingActions.setTrimRange(selectedProjectId, clipId, newTrimStart, duration);
        if (!result.success) hasError = true;
      } else {
        // No more trim, clear it
        const result = await framingActions.clearTrimRange(selectedProjectId, clipId);
        if (!result.success) hasError = true;
      }

      if (hasError) {
        toast.error('Failed to save detrim changes');
      }

      // Sync segments to store so sidebar indicator updates
      if (selectedClipId) {
        updateClipData(selectedClipId, {
          segments_data: JSON.stringify({
            boundaries: segmentBoundaries,
            segmentSpeeds: segmentSpeeds,
            trimRange: newTrimStart && newTrimStart > 0
              ? { start: newTrimStart, end: duration }
              : null,
          })
        });
      }
    }
  }, [trimRange, duration, framerate, keyframes, getCropDataAtTime, deleteKeyframesInRange, addOrUpdateKeyframe, setCropEndFrame, detrimEnd, highlightHook, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, segmentBoundaries, segmentSpeeds, updateClipData]);

  /**
   * Handle keyframe click (seek to keyframe time)
   */
  const handleKeyframeClick = useCallback((time, index) => {
    seek(time);
  }, [seek]);

  /**
   * Handle keyframe delete
   */
  const handleKeyframeDelete = useCallback(async (time) => {
    const frame = Math.round(time * framerate);
    const callerClipId = selectedClipId;

    // Capture keyframe data for rollback
    const deletedKf = keyframes.find(kf => kf.frame === frame);
    const deletedCropData = getCropDataAtTime(time);
    const deletedOrigin = deletedKf?.origin || 'user';
    const previousStoreKfs = clipCropKeyframes(selectedClip) || [];

    clipHasUserEditsRef.current = true;
    removeKeyframe(time, duration);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Sync to clip store so sidebar indicator updates
    if (callerClipId) {
      const updatedKfs = previousStoreKfs.filter(kf => kf.frame !== frame);
      updateClipData(callerClipId, { crop_data: JSON.stringify(updatedKfs) });
    }

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      const result = await framingActions.deleteCropKeyframe(selectedProjectId, clipId, frame);
      if (!result.success && selectedClipId === callerClipId) {
        // Rollback: re-add the keyframe
        if (deletedCropData) {
          addOrUpdateKeyframe(time, deletedCropData, duration, deletedOrigin);
        }
        if (callerClipId) {
          updateClipData(callerClipId, { crop_data: JSON.stringify(previousStoreKfs) });
        }
        clipHasUserEditsRef.current = false;
        setFramingChangedSinceExport?.(false);
        toast.error('Failed to delete keyframe', { message: result.error });
      }
    }
  }, [duration, framerate, keyframes, getCropDataAtTime, removeKeyframe, addOrUpdateKeyframe, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, updateClipData]);

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
  const handlePasteCrop = useCallback(async (time = currentTime) => {
    if (videoUrl && copiedCrop) {
      const frame = Math.round(time * framerate);
      const callerClipId = selectedClipId;

      // Capture pre-existing keyframe for rollback
      const previousKfData = getCropDataAtTime(time);
      const previousKf = keyframes.find(kf => kf.frame === frame);
      const previousStoreKfs = clipCropKeyframes(selectedClip) || [];

      pasteCropKeyframe(time, duration);
      onUserEdit?.();
      setFramingChangedSinceExport?.(true);

      // Sync to clip store so sidebar indicator updates
      if (callerClipId) {
        const newKf = { frame, x: copiedCrop.x, y: copiedCrop.y, width: copiedCrop.width, height: copiedCrop.height, origin: 'user' };
        const updatedKfs = [...previousStoreKfs.filter(kf => kf.frame !== frame), newKf];
        updateClipData(callerClipId, { crop_data: JSON.stringify(updatedKfs) });
      }

      // Persist to backend with error recovery
      const clipId = selectedClip?.id;
      if (selectedProjectId && clipId) {
        const result = await framingActions.addCropKeyframe(selectedProjectId, clipId, {
          frame,
          x: copiedCrop.x,
          y: copiedCrop.y,
          width: copiedCrop.width,
          height: copiedCrop.height,
          origin: 'user'
        });
        if (!result.success && selectedClipId === callerClipId) {
          // Rollback: restore previous keyframe or remove the pasted one
          if (previousKf && previousKfData) {
            addOrUpdateKeyframe(time, previousKfData, duration, previousKf.origin);
          } else {
            removeKeyframe(time, duration);
          }
          if (callerClipId) {
            updateClipData(callerClipId, { crop_data: JSON.stringify(previousStoreKfs) });
          }
          clipHasUserEditsRef.current = false;
          setFramingChangedSinceExport?.(false);
          toast.error('Failed to paste crop keyframe', { message: result.error });
        }
      }
    }
  }, [videoUrl, currentTime, copiedCrop, duration, framerate, keyframes, getCropDataAtTime, pasteCropKeyframe, addOrUpdateKeyframe, removeKeyframe, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, updateClipData]);

  /**
   * Handle segment boundary add (split)
   */
  const handleAddSplit = useCallback(async (time) => {
    const callerClipId = selectedClipId;
    clipHasUserEditsRef.current = true;
    addSegmentBoundary(time);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Sync to clip store so sidebar indicator updates
    // Note: segmentBoundaries won't have the new value yet (React batching), so build manually
    if (callerClipId) {
      const updatedBoundaries = [...segmentBoundaries, time].sort((a, b) => a - b);
      updateClipData(callerClipId, {
        segments_data: JSON.stringify({
          boundaries: updatedBoundaries,
          segmentSpeeds: segmentSpeeds,
          trimRange: trimRange,
        })
      });
    }

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      const result = await framingActions.splitSegment(selectedProjectId, clipId, time);
      if (!result.success && selectedClipId === callerClipId) {
        removeSegmentBoundary(time);
        if (callerClipId) {
          updateClipData(callerClipId, {
            segments_data: JSON.stringify({
              boundaries: segmentBoundaries,
              segmentSpeeds: segmentSpeeds,
              trimRange: trimRange,
            })
          });
        }
        clipHasUserEditsRef.current = false;
        setFramingChangedSinceExport?.(false);
        toast.error('Failed to split segment', { message: result.error });
      }
    }
  }, [addSegmentBoundary, removeSegmentBoundary, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, updateClipData]);

  /**
   * Handle segment boundary remove
   */
  const handleRemoveSplit = useCallback(async (time) => {
    const callerClipId = selectedClipId;
    clipHasUserEditsRef.current = true;
    removeSegmentBoundary(time);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Sync to clip store so sidebar indicator updates
    if (callerClipId) {
      const updatedBoundaries = segmentBoundaries.filter(b => b !== time);
      updateClipData(callerClipId, {
        segments_data: JSON.stringify({
          boundaries: updatedBoundaries,
          segmentSpeeds: segmentSpeeds,
          trimRange: trimRange,
        })
      });
    }

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      const result = await framingActions.removeSegmentSplit(selectedProjectId, clipId, time);
      if (!result.success && selectedClipId === callerClipId) {
        addSegmentBoundary(time);
        if (callerClipId) {
          updateClipData(callerClipId, {
            segments_data: JSON.stringify({
              boundaries: segmentBoundaries,
              segmentSpeeds: segmentSpeeds,
              trimRange: trimRange,
            })
          });
        }
        clipHasUserEditsRef.current = false;
        setFramingChangedSinceExport?.(false);
        toast.error('Failed to remove split', { message: result.error });
      }
    }
  }, [removeSegmentBoundary, addSegmentBoundary, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, updateClipData]);

  // Helper: sync current segment state to clip store so sidebar indicator updates
  const syncSegmentsToStore = useCallback(() => {
    if (!selectedClipId) return;
    const segmentState = {
      boundaries: segmentBoundaries,
      segmentSpeeds: segmentSpeeds,
      trimRange: trimRange,
    };
    updateClipData(selectedClipId, { segments_data: JSON.stringify(segmentState) });
  }, [selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, updateClipData]);

  /**
   * Handle segment speed change
   */
  const handleSegmentSpeedChange = useCallback(async (segmentIndex, speed) => {
    const previousSpeed = segmentSpeeds[segmentIndex] ?? 1;
    const callerClipId = selectedClipId;

    clipHasUserEditsRef.current = true;
    setSegmentSpeed(segmentIndex, speed);
    onUserEdit?.();
    setFramingChangedSinceExport?.(true);

    // Optimistically update store so sidebar framing indicator reflects the change
    // Note: segmentSpeeds won't have the new value yet (React batching), so build it manually
    if (callerClipId) {
      const updatedSpeeds = { ...segmentSpeeds, [segmentIndex]: speed };
      updateClipData(callerClipId, {
        segments_data: JSON.stringify({
          boundaries: segmentBoundaries,
          segmentSpeeds: updatedSpeeds,
          trimRange: trimRange,
        })
      });
    }

    // Persist to backend with error recovery
    const clipId = selectedClip?.id;
    if (selectedProjectId && clipId) {
      const result = await framingActions.setSegmentSpeed(selectedProjectId, clipId, segmentIndex, speed);
      if (!result.success && selectedClipId === callerClipId) {
        setSegmentSpeed(segmentIndex, previousSpeed);
        if (callerClipId) {
          updateClipData(callerClipId, {
            segments_data: JSON.stringify({
              boundaries: segmentBoundaries,
              segmentSpeeds: segmentSpeeds,
              trimRange: trimRange,
            })
          });
        }
        clipHasUserEditsRef.current = false;
        setFramingChangedSinceExport?.(false);
        toast.error('Failed to set segment speed', { message: result.error });
      }
    }
  }, [setSegmentSpeed, onUserEdit, setFramingChangedSinceExport, selectedProjectId, selectedClip, selectedClipId, segmentBoundaries, segmentSpeeds, trimRange, updateClipData]);

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

  // NOTE: Auto-save effect removed - gesture-based actions save immediately on each user action
  // saveCurrentClipState is still available for explicit saves (export only)

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
