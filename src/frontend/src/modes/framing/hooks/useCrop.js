import { useState, useCallback, useEffect, useRef } from 'react';
import { timeToFrame } from '../../../utils/videoUtils';
import { interpolateCropSpline } from '../../../utils/splineInterpolation';
import useKeyframeController from '../../../hooks/useKeyframeController';
import { normalizeToFrameKeyframes, validateFrameKeyframes } from '../../../types/keyframes';

/**
 * Default crop sizes optimized for HD upscaling.
 * These dimensions maximize resolution quality when upscaling to standard HD formats.
 *
 * For aspect ratios not listed here, the crop will be calculated to fit the video.
 *
 * To add a new aspect ratio with fixed dimensions:
 *   'W:H': { width: X, height: Y }
 */
const DEFAULT_CROP_SIZES = {
  '9:16': { width: 205, height: 365 },
  '16:9': { width: 640, height: 360 },
};

/**
 * Calculate the default position for a crop rectangle.
 * Currently centers the crop in the video frame.
 *
 * Future enhancement: This function can be extended to accept segmentation
 * data and position the crop to center on detected subjects (ball, player clusters).
 *
 * @param {number} videoWidth - Video width in pixels
 * @param {number} videoHeight - Video height in pixels
 * @param {number} cropWidth - Crop rectangle width
 * @param {number} cropHeight - Crop rectangle height
 * @returns {{ x: number, y: number }} - Position of crop rectangle (top-left corner)
 */
const calculateDefaultPosition = (videoWidth, videoHeight, cropWidth, cropHeight) => {
  // Future: Accept segmentationData parameter to find ball/player positions
  // and calculate position to center on detected subjects

  // Center the crop in the video frame
  return {
    x: Math.round((videoWidth - cropWidth) / 2),
    y: Math.round((videoHeight - cropHeight) / 2)
  };
};

/**
 * Custom hook for managing crop tool state and keyframes
 * Crop tool is ALWAYS active when video is loaded
 *
 * REFACTORED ARCHITECTURE:
 * - Uses useKeyframeController (state machine) for all keyframe management
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=totalFrames) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useCrop(videoMetadata, trimRange = null) {
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '16:9', '9:16'
  const [framerate] = useState(30); // Default framerate - TODO: extract from video

  // Crop data keys for copy/paste operations
  const cropDataKeys = ['x', 'y', 'width', 'height'];

  // Initialize shared keyframe management
  const keyframeManager = useKeyframeController({
    interpolateFn: interpolateCropSpline,
    framerate,
    getEndFrame: (duration) => duration ? timeToFrame(duration, framerate) : null
  });

  /**
   * Calculate the default crop rectangle for initial keyframes.
   * Uses fixed sizes from DEFAULT_CROP_SIZES when available (optimized for upscaling),
   * otherwise falls back to fitting the largest rectangle within video bounds.
   */
  const calculateDefaultCrop = useCallback((videoWidth, videoHeight, targetAspectRatio) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let cropWidth, cropHeight;

    // Check if we have a predefined size for this aspect ratio
    const predefinedSize = DEFAULT_CROP_SIZES[targetAspectRatio];

    if (predefinedSize) {
      // Use the predefined size (optimized for upscaling)
      cropWidth = predefinedSize.width;
      cropHeight = predefinedSize.height;
    } else {
      // Fallback: calculate the largest rectangle that fits the video
      const [ratioW, ratioH] = targetAspectRatio.split(':').map(Number);
      const ratio = ratioW / ratioH;
      const videoRatio = videoWidth / videoHeight;

      if (videoRatio > ratio) {
        // Video is wider - constrain by height
        cropHeight = videoHeight;
        cropWidth = cropHeight * ratio;
      } else {
        // Video is taller - constrain by width
        cropWidth = videoWidth;
        cropHeight = cropWidth / ratio;
      }

      cropWidth = Math.round(cropWidth);
      cropHeight = Math.round(cropHeight);
    }

    // Calculate centered position (future: can use segmentation data here)
    const position = calculateDefaultPosition(videoWidth, videoHeight, cropWidth, cropHeight);

    return {
      ...position,
      width: cropWidth,
      height: cropHeight
    };
  }, []);

  // Extract stable references from keyframeManager to avoid dependency array issues
  // Using the object directly would cause re-runs on every render
  const {
    needsInitialization,
    initializeKeyframes,
    keyframes,
    isEndKeyframeExplicit,
    updateAllKeyframes,
    restoreKeyframes,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    reset: resetKeyframes,
    interpolate,
    hasKeyframeAt,
    getKeyframeAt,
    copiedData,
    copyKeyframe,
    pasteKeyframe,
    getDataAtTime,
    getKeyframesForExport: getKeyframesForExportFn,
  } = keyframeManager;

  // Refs to track state for callbacks without causing infinite loops
  // These allow reading current values without adding to dependency arrays
  const keyframesRef = useRef(keyframes);
  keyframesRef.current = keyframes;

  const isEndKeyframeExplicitRef = useRef(isEndKeyframeExplicit);
  isEndKeyframeExplicitRef.current = isEndKeyframeExplicit;

  // Track when keyframes were just restored to skip orientation mismatch reinitialization
  const justRestoredRef = useRef(false);

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=totalFrames)
   * End keyframe initially mirrors start until explicitly modified
   * Also reinitializes if keyframes are stale (end frame doesn't match current video duration)
   * or if the current crop dimensions don't match the expected aspect ratio
   * NOTE: Uses trimRange.end if trimming is active, otherwise uses original duration
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration) {
      // Use trimmed end if available, otherwise use original duration
      const effectiveDuration = trimRange?.end ?? videoMetadata.duration;
      const totalFrames = timeToFrame(effectiveDuration, framerate);

      // Check if we need to initialize (only on first load, not after trim)
      // Skip initialization if trimRange is set - trim operations handle their own keyframe management
      let shouldInitialize = !trimRange && needsInitialization(totalFrames);

      // Additional check: if keyframes exist but have wrong orientation (portrait vs landscape),
      // force re-initialization. This handles aspect ratio changes when switching clips.
      // We compare orientation (ratio > 1 = landscape, ratio < 1 = portrait) rather than
      // exact dimensions to avoid breaking manual resize functionality.
      // Use ref to read keyframes without adding to dependency array (prevents infinite loop)
      // SKIP this check if keyframes were just restored from saved data
      const currentKeyframes = keyframesRef.current;
      if (!shouldInitialize && !trimRange && currentKeyframes.length > 0 && !justRestoredRef.current) {
        const firstKeyframe = currentKeyframes[0];
        if (firstKeyframe?.width && firstKeyframe?.height) {
          const keyframeRatio = firstKeyframe.width / firstKeyframe.height;
          const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
          const expectedRatio = ratioW / ratioH;

          // Check if orientation is fundamentally different (portrait vs landscape)
          const keyframeIsLandscape = keyframeRatio > 1;
          const expectedIsLandscape = expectedRatio > 1;

          if (keyframeIsLandscape !== expectedIsLandscape) {
            console.log('[useCrop] Orientation mismatch - reinitializing. Keyframe ratio:', keyframeRatio.toFixed(2), 'Expected:', expectedRatio.toFixed(2));
            shouldInitialize = true;
          }
        }
      }

      // Clear the justRestored flag after the check
      if (justRestoredRef.current) {
        justRestoredRef.current = false;
      }

      if (shouldInitialize) {
        const defaultCrop = calculateDefaultCrop(
          videoMetadata.width,
          videoMetadata.height,
          aspectRatio
        );

        initializeKeyframes(defaultCrop, totalFrames);
      }
    }
  }, [videoMetadata, aspectRatio, needsInitialization, initializeKeyframes, calculateDefaultCrop, framerate, trimRange]);

  /**
   * Update aspect ratio and recalculate all keyframes
   * If end keyframe hasn't been explicitly set, both start and end get same values
   * Uses refs to read keyframes/isEndKeyframeExplicit to keep callback stable
   */
  const updateAspectRatio = useCallback((newRatio) => {
    setAspectRatio(newRatio);

    // Use refs to read current values without adding to dependency array
    const currentKeyframes = keyframesRef.current;
    const currentIsEndExplicit = isEndKeyframeExplicitRef.current;

    // Recalculate all keyframes with new aspect ratio
    if (currentKeyframes.length > 0 && videoMetadata?.width && videoMetadata?.height) {
      // Get the new default crop for this aspect ratio
      const newCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        newRatio
      );

      const totalFrames = timeToFrame(videoMetadata.duration, framerate);

      updateAllKeyframes(kf => {
        // Preserve origin
        const origin = kf.origin || 'user';

        // If end hasn't been explicitly set, use default for all keyframes
        if (!currentIsEndExplicit) {
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

    }
  }, [updateAllKeyframes, videoMetadata, calculateDefaultCrop, framerate]);

  /**
   * Copy the crop keyframe at the specified time
   */
  const copyCropKeyframe = useCallback((time) => {
    return copyKeyframe(time, cropDataKeys);
  }, [copyKeyframe]);

  /**
   * Paste the copied crop data at the specified time
   */
  const pasteCropKeyframe = useCallback((time, duration) => {
    return pasteKeyframe(time, duration);
  }, [pasteKeyframe]);

  /**
   * Get the interpolated crop data at a specific time
   * Returns only the spatial properties (x, y, width, height)
   * Useful for copying crop state from one time to another
   */
  const getCropDataAtTime = useCallback((time) => {
    return getDataAtTime(time, cropDataKeys);
  }, [getDataAtTime]);

  /**
   * Get keyframes in time-based format for export
   * Converts frame numbers to time for backend compatibility
   */
  const getKeyframesForExport = useCallback(() => {
    return getKeyframesForExportFn(cropDataKeys);
  }, [getKeyframesForExportFn]);

  /**
   * Restore crop keyframes from saved state (for clip switching)
   * Sets justRestoredRef to prevent orientation mismatch reinitialization
   *
   * IMPORTANT: Internal state uses FRAME-BASED keyframes.
   * This function handles backwards compatibility with old time-based data.
   *
   * @param {import('../../../types/keyframes').FrameKeyframe[]|import('../../../types/keyframes').TimeKeyframe[]} savedKeyframes
   * @param {number} endFrame
   */
  const restoreState = useCallback((savedKeyframes, endFrame) => {
    if (!savedKeyframes || savedKeyframes.length === 0) {
      console.log('[useCrop] No keyframes to restore');
      return;
    }

    // Normalize to frame-based format (handles backwards compatibility with time-based data)
    const frameKeyframes = normalizeToFrameKeyframes(savedKeyframes, framerate);

    if (!validateFrameKeyframes(frameKeyframes)) {
      console.error('[useCrop] Failed to normalize keyframes to frame-based format:', savedKeyframes);
      return;
    }

    console.log('[useCrop] Restoring frame-based keyframes:', frameKeyframes.length, 'endFrame:', endFrame);
    // Set flag to prevent orientation mismatch reinitialization
    justRestoredRef.current = true;
    restoreKeyframes(frameKeyframes, endFrame);
  }, [restoreKeyframes, framerate]);

  return {
    // State
    aspectRatio,
    keyframes,
    isEndKeyframeExplicit,
    copiedCrop: copiedData,
    framerate,

    // Actions
    updateAspectRatio,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    copyCropKeyframe,
    pasteCropKeyframe,
    reset: resetKeyframes,
    restoreState,

    // Queries
    interpolateCrop: interpolate,
    hasKeyframeAt,
    getKeyframeAt,
    getCropDataAtTime,
    calculateDefaultCrop,
    getKeyframesForExport
  };
}
