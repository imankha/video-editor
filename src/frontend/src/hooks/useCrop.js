import { useState, useCallback, useEffect } from 'react';
import { timeToFrame } from '../utils/videoUtils';
import { interpolateCropSpline } from '../utils/splineInterpolation';
import useKeyframes from './useKeyframes';

/**
 * Custom hook for managing crop tool state and keyframes
 * Crop tool is ALWAYS active when video is loaded
 *
 * REFACTORED ARCHITECTURE:
 * - Uses shared useKeyframes hook for all keyframe management
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=totalFrames) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useCrop(videoMetadata) {
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '16:9', '9:16'
  const [framerate] = useState(30); // Default framerate - TODO: extract from video

  // Crop data keys for copy/paste operations
  const cropDataKeys = ['x', 'y', 'width', 'height'];

  // Initialize shared keyframe management
  const keyframeManager = useKeyframes({
    interpolateFn: interpolateCropSpline,
    framerate,
    getEndFrame: (duration) => duration ? timeToFrame(duration, framerate) : null
  });

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

      // Check if we need to initialize
      if (keyframeManager.needsInitialization(totalFrames)) {
        const defaultCrop = calculateDefaultCrop(
          videoMetadata.width,
          videoMetadata.height,
          aspectRatio
        );

        console.log('[useCrop] Auto-initializing permanent keyframes at frame=0 and frame=' + totalFrames, defaultCrop);
        console.log('[useCrop] End keyframe will mirror start until explicitly modified');

        keyframeManager.initializeKeyframes(defaultCrop, totalFrames);
      }
    }
  }, [videoMetadata, aspectRatio, keyframeManager, calculateDefaultCrop, framerate]);

  /**
   * Update aspect ratio and recalculate all keyframes
   * If end keyframe hasn't been explicitly set, both start and end get same values
   */
  const updateAspectRatio = useCallback((newRatio) => {
    console.log('[useCrop] Updating aspect ratio to:', newRatio);
    setAspectRatio(newRatio);

    // Recalculate all keyframes with new aspect ratio
    if (keyframeManager.keyframes.length > 0 && videoMetadata?.width && videoMetadata?.height) {
      // Get the new default crop for this aspect ratio
      const newCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        newRatio
      );

      const totalFrames = timeToFrame(videoMetadata.duration, framerate);

      keyframeManager.updateAllKeyframes(kf => {
        // Preserve origin
        const origin = kf.origin || 'user';

        // If end hasn't been explicitly set, use default for all keyframes
        if (!keyframeManager.isEndKeyframeExplicit) {
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

      console.log('[useCrop] Updated keyframes for new aspect ratio (isEndExplicit:', keyframeManager.isEndKeyframeExplicit, ')');
    }
  }, [keyframeManager, videoMetadata, calculateDefaultCrop, framerate]);

  /**
   * Copy the crop keyframe at the specified time
   */
  const copyCropKeyframe = useCallback((time) => {
    return keyframeManager.copyKeyframe(time, cropDataKeys);
  }, [keyframeManager]);

  /**
   * Paste the copied crop data at the specified time
   */
  const pasteCropKeyframe = useCallback((time, duration) => {
    return keyframeManager.pasteKeyframe(time, duration);
  }, [keyframeManager]);

  /**
   * Get the interpolated crop data at a specific time
   * Returns only the spatial properties (x, y, width, height)
   * Useful for copying crop state from one time to another
   */
  const getCropDataAtTime = useCallback((time) => {
    return keyframeManager.getDataAtTime(time, cropDataKeys);
  }, [keyframeManager]);

  /**
   * Get keyframes in time-based format for export
   * Converts frame numbers to time for backend compatibility
   */
  const getKeyframesForExport = useCallback(() => {
    return keyframeManager.getKeyframesForExport(cropDataKeys);
  }, [keyframeManager]);

  return {
    // State
    aspectRatio,
    keyframes: keyframeManager.keyframes,
    isEndKeyframeExplicit: keyframeManager.isEndKeyframeExplicit,
    copiedCrop: keyframeManager.copiedData,
    framerate,

    // Actions
    updateAspectRatio,
    addOrUpdateKeyframe: keyframeManager.addOrUpdateKeyframe,
    removeKeyframe: keyframeManager.removeKeyframe,
    deleteKeyframesInRange: keyframeManager.deleteKeyframesInRange,
    cleanupTrimKeyframes: keyframeManager.cleanupTrimKeyframes,
    copyCropKeyframe,
    pasteCropKeyframe,
    reset: keyframeManager.reset,

    // Queries
    interpolateCrop: keyframeManager.interpolate,
    hasKeyframeAt: keyframeManager.hasKeyframeAt,
    getKeyframeAt: keyframeManager.getKeyframeAt,
    getCropDataAtTime,
    calculateDefaultCrop,
    getKeyframesForExport
  };
}
