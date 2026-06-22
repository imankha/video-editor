import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { timeToFrame } from '../../../utils/videoUtils';
import { interpolateCropSpline } from '../../../utils/splineInterpolation';
import useKeyframeController from '../../../hooks/useKeyframeController';
import { normalizeToFrameKeyframes, validateFrameKeyframes } from '../../../types/keyframes';
import { track } from '../../../utils/analytics';

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
 *
 * @param {Object} videoMetadata - Video metadata (width, height, duration)
 * @param {Object} trimRange - Optional trim range
 * @param {Array} savedKeyframes - Optional saved keyframes to restore (from clip data)
 */
export default function useCrop(videoMetadata, trimRange = null, savedKeyframes = null) {
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '16:9', '9:16'
  const framerate = videoMetadata?.framerate || 30;

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
    machineState,
    updateAllKeyframes,
    restoreKeyframes,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    setEndFrame,
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

  // Track the last savedKeyframes we processed to avoid re-processing
  const lastSavedKeyframesRef = useRef(null);

  /**
   * Restore saved keyframes when they change (new clip selected)
   * useLayoutEffect ensures keyframes are set before paint, so the crop
   * rectangle is visible on first render (avoids flash of no-crop state).
   *
   * Also re-restores when the controller is uninitialized (after a reset)
   * even if the dedupe key matches: resetKeyframes() wipes the hook, and
   * without this the crop would stay empty (no reticule) when returning to
   * a clip whose keyframes were already restored earlier in the session.
   */
  useLayoutEffect(() => {
    if (savedKeyframes && savedKeyframes.length > 0) {
      const keyframesKey = JSON.stringify(savedKeyframes.map(k => ({ frame: k.frame, x: k.x, y: k.y })));

      if (keyframesKey !== lastSavedKeyframesRef.current || machineState === 'uninitialized') {
        const frameKeyframes = normalizeToFrameKeyframes(savedKeyframes, framerate);

        if (validateFrameKeyframes(frameKeyframes)) {
          lastSavedKeyframesRef.current = keyframesKey;
          restoreKeyframes(frameKeyframes);
        }
      }
    }
  }, [savedKeyframes, framerate, restoreKeyframes, machineState]);

  // Flat-list model: there is no managed end boundary. Crop keyframes are a plain
  // list; interpolation clamps to the first/last keyframe, and trim is virtual
  // (handled by trimRange). No end-frame reconciliation effect is needed.

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=totalFrames)
   * End keyframe initially mirrors start until explicitly modified
   * Also reinitializes if keyframes are stale (end frame doesn't match current video duration)
   * or if the current crop dimensions don't match the expected aspect ratio
   * NOTE: Virtual trim — the end permanent is always at the FULL duration, never
   * at trimRange.end. Trimming is non-destructive and handled via trimRange only.
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration) {
      // Virtual trim: end boundary is always the full clip duration.
      const effectiveDuration = videoMetadata.duration;
      const totalFrames = timeToFrame(effectiveDuration, framerate);

      // Check if we need to initialize:
      // - Only if state is UNINITIALIZED (no keyframes, or after resetCrop)
      // - Skip if savedKeyframes were provided (use those instead)
      // NOTE: Uses machineState (in deps) instead of keyframesRef to properly
      // detect post-reset state. The clip-switch effect calls resetCrop() AFTER
      // this effect runs, so keyframesRef would still have stale previous-clip data.
      // NOTE: trimRange does NOT suppress initialization. A clip can have a trim
      // saved with no crop keyframes (trim/speed gestures persist surgically,
      // crop_data stays empty until a crop gesture) — it still needs default
      // keyframes or the crop reticule never renders. Live trim operations are
      // safe because the controller is not 'uninitialized' while editing.
      const isUninitialized = machineState === 'uninitialized';
      const hasSavedKeyframes = savedKeyframes && savedKeyframes.length > 0;

      let shouldInitialize = !hasSavedKeyframes && isUninitialized;

      // Additional check: if keyframes exist but have wrong orientation (portrait vs landscape),
      // force re-initialization. This handles aspect ratio changes.
      // BUT only if there are no savedKeyframes (respect saved data)
      const currentKeyframes = keyframesRef.current;
      if (!shouldInitialize && !trimRange && !hasSavedKeyframes && !isUninitialized && currentKeyframes.length > 0) {
        const firstKeyframe = currentKeyframes[0];
        if (firstKeyframe?.width && firstKeyframe?.height) {
          const keyframeRatio = firstKeyframe.width / firstKeyframe.height;
          const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
          const expectedRatio = ratioW / ratioH;

          const keyframeIsLandscape = keyframeRatio > 1;
          const expectedIsLandscape = expectedRatio > 1;

          if (keyframeIsLandscape !== expectedIsLandscape) {
            shouldInitialize = true;
          }
        }
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
  }, [videoMetadata, aspectRatio, initializeKeyframes, calculateDefaultCrop, framerate, trimRange, machineState]); // eslint-disable-line react-hooks/exhaustive-deps -- machineState replaces needsInitialization (only changes on init/reset/restore, not every keyframe edit)

  /**
   * Update aspect ratio and recalculate all keyframes to the new default crop.
   * Flat-list model: every keyframe gets the new aspect-ratio default (no special
   * start/end handling).
   */
  const updateAspectRatio = useCallback((newRatio) => {
    track('aspect_ratio_change', { from: aspectRatio, to: newRatio }, { debugOnly: true });
    setAspectRatio(newRatio);

    const currentKeyframes = keyframesRef.current;

    if (currentKeyframes.length > 0 && videoMetadata?.width && videoMetadata?.height) {
      const newCrop = calculateDefaultCrop(
        videoMetadata.width,
        videoMetadata.height,
        newRatio
      );

      updateAllKeyframes(kf => ({
        frame: kf.frame,
        origin: kf.origin || 'user',
        ...newCrop
      }));
    }
  }, [updateAllKeyframes, videoMetadata, calculateDefaultCrop]);

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
   * DEPRECATED: Prefer passing savedKeyframes prop to useCrop instead.
   * Kept for backward compatibility.
   *
   * @param {import('../../../types/keyframes').FrameKeyframe[]|import('../../../types/keyframes').TimeKeyframe[]} savedKeyframes
   * @param {number} endFrame
   */
  const restoreState = useCallback((savedKeyframes) => {
    if (!savedKeyframes || savedKeyframes.length === 0) {
      return;
    }

    const frameKeyframes = normalizeToFrameKeyframes(savedKeyframes, framerate);

    if (!validateFrameKeyframes(frameKeyframes)) {
      console.error('[useCrop] Failed to normalize keyframes to frame-based format:', savedKeyframes);
      return;
    }

    restoreKeyframes(frameKeyframes);
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
    setEndFrame,
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
