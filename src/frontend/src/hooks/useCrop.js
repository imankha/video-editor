import { useState, useCallback, useEffect } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';
import { interpolateCropSpline } from '../utils/splineInterpolation';

/**
 * Custom hook for managing crop tool state and keyframes
 * Crop tool is ALWAYS active when video is loaded
 *
 * REFACTORED ARCHITECTURE:
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 * - This enables proper lifecycle management and cleanup
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=totalFrames) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useCrop(videoMetadata) {
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '16:9', '9:16'
  const [keyframes, setKeyframes] = useState([]);
  const [isEndKeyframeExplicit, setIsEndKeyframeExplicit] = useState(false);
  const [copiedCrop, setCopiedCrop] = useState(null); // Stores copied crop data (x, y, width, height)
  const [framerate] = useState(30); // Default framerate - TODO: extract from video

  /**
   * Calculate the default crop rectangle that fits within video bounds
   * Returns the largest rectangle with the selected aspect ratio
   */
  const calculateDefaultCrop = useCallback((videoWidth, videoHeight, targetAspectRatio) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    // Parse aspect ratio (e.g., "16:9" -> 16/9)
    const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
    const ratio = ratioW / ratioH;
    const videoRatio = videoWidth / videoHeight;

    let cropWidth, cropHeight;

    if (videoRatio > ratio) {
      // Video is wider - constrain by height
      cropHeight = videoHeight;
      cropWidth = cropHeight * ratio;
    } else {
      // Video is taller - constrain by width
      cropWidth = videoWidth;
      cropHeight = cropWidth / ratio;
    }

    // Center the crop rectangle
    const x = (videoWidth - cropWidth) / 2;
    const y = (videoHeight - cropHeight) / 2;

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  }, []);

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=totalFrames)
   * End keyframe initially mirrors start until explicitly modified
   * Also reinitializes if keyframes are stale (end frame doesn't match current video duration)
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration) {
      const totalFrames = timeToFrame(videoMetadata.duration, framerate);

      // Check if we need to initialize:
      // 1. No keyframes exist, OR
      // 2. Keyframes are stale (last keyframe's frame doesn't match current video's total frames)
      const needsInit = keyframes.length === 0 ||
                        (keyframes.length > 0 && keyframes[keyframes.length - 1].frame !== totalFrames);

      if (needsInit) {
        const defaultCrop = calculateDefaultCrop(
          videoMetadata.width,
          videoMetadata.height,
          aspectRatio
        );

        console.log('[useCrop] Auto-initializing permanent keyframes at frame=0 and frame=' + totalFrames, defaultCrop);
        console.log('[useCrop] End keyframe will mirror start until explicitly modified');

        // Reset the explicit flag for new video
        setIsEndKeyframeExplicit(false);

        setKeyframes([
          {
            frame: 0,
            origin: 'permanent',
            ...defaultCrop
          },
          {
            frame: totalFrames,
            origin: 'permanent',
            ...defaultCrop
          }
        ]);
      }
    }
  }, [videoMetadata, aspectRatio, keyframes, calculateDefaultCrop, framerate]);

  /**
   * Update aspect ratio and recalculate all keyframes
   * If end keyframe hasn't been explicitly set, both start and end get same values
   */
  const updateAspectRatio = useCallback((newRatio) => {
    console.log('[useCrop] Updating aspect ratio to:', newRatio);
    setAspectRatio(newRatio);

    // Recalculate all keyframes with new aspect ratio
    if (keyframes.length > 0 && videoMetadata?.width && videoMetadata?.height) {
      // Get the new default crop for this aspect ratio
      const newCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        newRatio
      );

      const totalFrames = timeToFrame(videoMetadata.duration, framerate);

      const updatedKeyframes = keyframes.map(kf => {
        // Preserve origin
        const origin = kf.origin || 'user';

        // If end hasn't been explicitly set, use default for all keyframes
        if (!isEndKeyframeExplicit) {
          return {
            frame: kf.frame,
            origin,
            ...newCrop
          };
        }

        // If end has been explicitly set, only update non-end keyframes with default
        // End keyframe keeps its custom position/size but updates to new aspect ratio
        const isEnd = kf.frame === totalFrames;
        if (isEnd) {
          // Preserve end keyframe's relative position but adjust to new aspect ratio
          // For now, just recalculate - could be smarter about preserving position
          return {
            frame: kf.frame,
            origin,
            ...newCrop
          };
        }

        return {
          frame: kf.frame,
          origin,
          ...newCrop
        };
      });

      console.log('[useCrop] Updated keyframes for new aspect ratio (isEndExplicit:', isEndKeyframeExplicit, '):', updatedKeyframes);
      setKeyframes(updatedKeyframes);
    }
  }, [keyframes, videoMetadata, calculateDefaultCrop, isEndKeyframeExplicit, framerate]);

  /**
   * Add or update a keyframe at the specified time
   * If updating start keyframe and end hasn't been explicitly set, end mirrors start
   * NOTE: This accepts time for API compatibility but converts to frames internally
   * @param {number} time - Time in seconds
   * @param {Object} cropData - Crop rectangle {x, y, width, height}
   * @param {number} duration - Video duration in seconds
   * @param {string} origin - Keyframe origin: 'user', 'trim', or 'permanent' (defaults to 'user')
   */
  const addOrUpdateKeyframe = useCallback((time, cropData, duration, origin = 'user') => {
    const frame = timeToFrame(time, framerate);
    const totalFrames = duration ? timeToFrame(duration, framerate) : null;

    console.log('[useCrop] Adding/updating keyframe at time', time, '(frame', frame + '), origin:', origin, 'data:', cropData);

    // Check if we're updating the end keyframe
    const isEndKeyframe = totalFrames !== null && frame === totalFrames;
    const isStartKeyframe = frame === 0;

    // Permanent keyframes always have origin='permanent'
    const actualOrigin = (isStartKeyframe || isEndKeyframe) ? 'permanent' : origin;

    if (isEndKeyframe) {
      console.log('[useCrop] End keyframe explicitly set by user');
      setIsEndKeyframeExplicit(true);
    }

    setKeyframes(prev => {
      // Check if keyframe exists at this frame
      const existingIndex = prev.findIndex(kf => kf.frame === frame);

      let updated;
      if (existingIndex >= 0) {
        // Update existing keyframe - preserve origin if updating permanent keyframe
        const preservedOrigin = prev[existingIndex].origin === 'permanent' ? 'permanent' : actualOrigin;
        updated = [...prev];
        updated[existingIndex] = { ...cropData, frame, origin: preservedOrigin };
      } else {
        // Add new keyframe and sort by frame
        const newKeyframes = [...prev, { ...cropData, frame, origin: actualOrigin }];
        updated = newKeyframes.sort((a, b) => a.frame - b.frame);
      }

      // If updating start keyframe and end hasn't been explicitly set, mirror to end
      if (isStartKeyframe && !isEndKeyframeExplicit && totalFrames !== null) {
        console.log('[useCrop] Mirroring start keyframe to end (end not yet explicit)');
        const endKeyframeIndex = updated.findIndex(kf => kf.frame === totalFrames);
        if (endKeyframeIndex >= 0) {
          // Set frame AFTER spreading cropData to preserve the totalFrames
          updated[endKeyframeIndex] = {
            ...cropData,
            frame: totalFrames,
            origin: 'permanent'
          };
        }
      }

      // INVARIANT: Check that all keyframes have an origin
      if (process.env.NODE_ENV === 'development') {
        const missingOrigin = updated.filter(kf => !kf.origin);
        if (missingOrigin.length > 0) {
          console.error('⚠️ INVARIANT VIOLATION: Keyframes missing origin:', missingOrigin);
        }
      }

      return updated;
    });
  }, [isEndKeyframeExplicit, framerate]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes at frame=0 or frame=totalFrames
   * NOTE: This accepts time for API compatibility but converts to frames internally
   */
  const removeKeyframe = useCallback((time, duration) => {
    const frame = timeToFrame(time, framerate);
    const totalFrames = duration ? timeToFrame(duration, framerate) : null;

    console.log('[useCrop] Attempting to remove keyframe at time:', time, '(frame', frame + ')');

    // Don't allow removing permanent start/end keyframes
    if (frame === 0) {
      console.log('[useCrop] Cannot remove permanent start keyframe (frame=0)');
      return;
    }
    if (totalFrames !== null && frame === totalFrames) {
      console.log('[useCrop] Cannot remove permanent end keyframe (frame=totalFrames)');
      return;
    }

    setKeyframes(prev => {
      // Don't allow removing if it would leave less than 2 keyframes
      if (prev.length <= 2) {
        console.log('[useCrop] Cannot remove - must have at least 2 keyframes');
        return prev;
      }
      return prev.filter(kf => kf.frame !== frame);
    });
  }, [framerate]);

  /**
   * Interpolate crop values between keyframes for a given time
   * Uses cubic spline (Catmull-Rom) interpolation for smooth animations
   * NOTE: This accepts time for API compatibility but converts to frames internally
   */
  const interpolateCrop = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return interpolateCropSpline(keyframes, frame, time);
  }, [keyframes, framerate]);

  /**
   * Check if a keyframe exists at the specified time
   * NOTE: This accepts time for API compatibility but converts to frames internally
   */
  const hasKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.some(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Get keyframe at specific time (if exists)
   * NOTE: This accepts time for API compatibility but converts to frames internally
   */
  const getKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.find(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Copy the crop keyframe at the specified time
   * Stores only spatial properties (x, y, width, height) - NOT time
   */
  const copyCropKeyframe = useCallback((time) => {
    const keyframe = getKeyframeAt(time);
    if (!keyframe) {
      // If no keyframe at this exact time, interpolate the crop at current time
      const interpolated = interpolateCrop(time);
      if (interpolated) {
        const { x, y, width, height } = interpolated;
        setCopiedCrop({ x, y, width, height });
        console.log('[useCrop] Copied interpolated crop at time', time, ':', { x, y, width, height });
        return true;
      }
      console.log('[useCrop] No crop data to copy at time', time);
      return false;
    }

    // Copy only spatial properties, not time
    const { x, y, width, height } = keyframe;
    setCopiedCrop({ x, y, width, height });
    console.log('[useCrop] Copied crop keyframe at time', time, ':', { x, y, width, height });
    return true;
  }, [getKeyframeAt, interpolateCrop]);

  /**
   * Paste the copied crop data at the specified time
   * Creates or updates a keyframe at the given time with the copied dimensions
   */
  const pasteCropKeyframe = useCallback((time, duration) => {
    if (!copiedCrop) {
      console.log('[useCrop] No crop data to paste');
      return false;
    }

    console.log('[useCrop] Pasting crop at time', time, ':', copiedCrop);
    addOrUpdateKeyframe(time, copiedCrop, duration);
    return true;
  }, [copiedCrop, addOrUpdateKeyframe]);

  /**
   * Get keyframes in time-based format for export
   * Converts frame numbers to time for backend compatibility
   */
  const getKeyframesForExport = useCallback(() => {
    return keyframes.map(kf => ({
      time: frameToTime(kf.frame, framerate),
      x: kf.x,
      y: kf.y,
      width: kf.width,
      height: kf.height
    }));
  }, [keyframes, framerate]);

  /**
   * Delete all keyframes within a time range
   * Used when trimming segments - removes keyframes that will be cut from the video
   * NOTE: Does not delete permanent start/end keyframes
   */
  const deleteKeyframesInRange = useCallback((startTime, endTime, videoDuration) => {
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);
    const totalFrames = videoDuration ? timeToFrame(videoDuration, framerate) : null;

    console.log('[useCrop] Deleting keyframes in range:', startTime, '-', endTime, '(frames', startFrame, '-', endFrame + ')');
    console.log('[useCrop] Video duration:', videoDuration, 'totalFrames:', totalFrames);

    setKeyframes(prev => {
      const filtered = prev.filter(kf => {
        // Keep keyframes outside the range
        if (kf.frame < startFrame || kf.frame > endFrame) {
          return true;
        }

        // Always keep permanent start keyframe
        if (kf.frame === 0) {
          console.log('[useCrop] Keeping permanent start keyframe (frame=0)');
          return true;
        }

        // Always keep permanent end keyframe
        if (totalFrames !== null && kf.frame === totalFrames) {
          console.log('[useCrop] Keeping permanent end keyframe (frame=' + totalFrames + ')');
          return true;
        }

        // Delete this keyframe (it's in the trimmed range and not permanent)
        return false;
      });

      const deletedCount = prev.length - filtered.length;
      console.log('[useCrop] Deleted', deletedCount, 'keyframe(s), kept', filtered.length, 'keyframe(s)');

      return filtered;
    });
  }, [framerate]);

  /**
   * Get the interpolated crop data at a specific time
   * Returns only the spatial properties (x, y, width, height)
   * Useful for copying crop state from one time to another
   */
  const getCropDataAtTime = useCallback((time) => {
    const interpolated = interpolateCrop(time);
    if (!interpolated) return null;

    const { x, y, width, height } = interpolated;
    return { x, y, width, height };
  }, [interpolateCrop]);

  /**
   * Clean up trim-related keyframes
   * Removes all keyframes with origin='trim'
   * Called when trim range is cleared
   */
  const cleanupTrimKeyframes = useCallback(() => {
    setKeyframes(prev => {
      const filtered = prev.filter(kf => kf.origin !== 'trim');
      const removedCount = prev.length - filtered.length;

      if (removedCount > 0) {
        console.log('[useCrop] Cleaned up', removedCount, 'trim-related keyframe(s)');
      }

      return filtered;
    });
  }, []);

  /**
   * Reset all crop state (for when loading a new video)
   */
  const reset = useCallback(() => {
    console.log('[useCrop] Resetting crop state');
    setKeyframes([]);
    setIsEndKeyframeExplicit(false);
    setCopiedCrop(null);
  }, []);

  return {
    // State
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop,
    framerate,

    // Actions
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,  // NEW: Clean up trim-related keyframes
    copyCropKeyframe,
    pasteCropKeyframe,
    reset,

    // Queries
    interpolateCrop,
    hasKeyframeAt,
    getKeyframeAt,
    getCropDataAtTime,
    calculateDefaultCrop,
    getKeyframesForExport
  };
}
