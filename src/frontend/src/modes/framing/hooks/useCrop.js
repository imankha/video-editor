import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { timeToFrame } from '../../../utils/videoUtils';
import { interpolateCropSpline } from '../../../utils/splineInterpolation';
import useKeyframeController from '../../../hooks/useKeyframeController';
import { normalizeToFrameKeyframes, validateFrameKeyframes } from '../../../types/keyframes';
import { track } from '../../../utils/analytics';
import { clampRotation } from '../../../utils/straighten';
import { clampCropToSafeArea } from '../../../utils/rotationSafeArea';

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
 * @param {number} savedRotation - Optional saved horizon-straighten angle (degrees) to seed
 */
export default function useCrop(videoMetadata, trimRange = null, savedKeyframes = null, savedRotation = 0) {
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '16:9', '9:16'
  const framerate = videoMetadata?.framerate || 30;

  // T5640: per-clip horizon-straighten angle (degrees, +CCW). Seeded from the
  // clip's saved rotation and re-seeded when a different clip is selected. This
  // is the ONE piece of rotation state; the container reads it for persistence
  // and the overlay reads it to CSS-rotate the video + draw the mask.
  const [rotation, setRotationState] = useState(() => clampRotation(savedRotation || 0));

  // Re-seed rotation when the saved value changes (clip switch / reload). Pure
  // memory sync of loaded data — NOT a persistence write-back (restore is
  // read-only per the T350 rule), so no gesture is implied and nothing is sent.
  const lastSavedRotationRef = useRef(savedRotation || 0);
  useEffect(() => {
    const next = savedRotation || 0;
    if (next !== lastSavedRotationRef.current) {
      lastSavedRotationRef.current = next;
      setRotationState(clampRotation(next));
    }
  }, [savedRotation]);

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
   * Update the active clip's aspect ratio (the reticule shape / crop constraint).
   *
   * This ONLY sets the local ratio state. It deliberately does NOT rewrite the crop
   * keyframes: aspect-ratio changes are a reel-level gesture (T3910) that re-fits every
   * clip's crop server-side (center-preserving), and the re-fit boxes flow back into this
   * hook via the refreshed `savedKeyframes` restore path. Rewriting keyframes here would
   * (a) discard the user's framing by snapping every box to the centered default, and
   * (b) fight the load-time `projectAspectRatio` sync, resetting framing on every open.
   */
  const updateAspectRatio = useCallback((newRatio) => {
    track('aspect_ratio_change', { from: aspectRatio, to: newRatio }, { debugOnly: true });
    setAspectRatio(newRatio);
  }, [aspectRatio]);

  // The reel aspect ratio (ratioW/ratioH) — the crop's fixed target shape. Kept
  // in a ref so the rotation callbacks stay identity-stable (they must not churn
  // on every aspect/metadata render, mirroring the crop drag handlers).
  const aspectValue = useMemo(() => {
    const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
    return ratioW / ratioH;
  }, [aspectRatio]);
  const aspectValueRef = useRef(aspectValue);
  aspectValueRef.current = aspectValue;
  const videoDimsRef = useRef({ width: videoMetadata?.width, height: videoMetadata?.height });
  videoDimsRef.current = { width: videoMetadata?.width, height: videoMetadata?.height };

  /**
   * Clamp a single crop to the inscribed safe area for the CURRENT rotation.
   * theta === 0 is a pure passthrough (clampCropToSafeArea short-circuits), so the
   * crop-drag path is byte-identical to today when the clip isn't rotated.
   * Used by the drag path (FramingContainer.handleCropComplete) when theta != 0.
   */
  const clampCropForCurrentRotation = useCallback((crop) => {
    const { width: W, height: H } = videoDimsRef.current;
    if (!W || !H) return crop;
    return clampCropToSafeArea(crop, W, H, rotation, aspectValueRef.current);
  }, [rotation]);

  /**
   * Set the horizon-straighten angle (degrees). Clamps to +/- MAX_ROT, updates
   * state, and re-clamps EVERY crop keyframe against the new theta (they all share
   * the reel aspect). Returns the list of keyframes that ACTUALLY moved so the
   * caller can persist only those (surgical update_crop_keyframe follow-ups).
   *
   * PURE state update: no useEffect, no API calls. Persistence is the container's
   * job (gesture handler), per the project-wide gesture-based rule.
   *
   * @param {number} deg - requested angle (unclamped)
   * @returns {{ rotation: number, movedKeyframes: Array<{frame, x, y, width, height, origin}> }}
   */
  const setRotation = useCallback((deg) => {
    const theta = clampRotation(deg);
    setRotationState(theta);

    const { width: W, height: H } = videoDimsRef.current;
    const r = aspectValueRef.current;
    const moved = [];
    if (W && H) {
      const current = keyframesRef.current || [];
      current.forEach((kf) => {
        const clamped = clampCropToSafeArea(
          { x: kf.x, y: kf.y, width: kf.width, height: kf.height },
          W, H, theta, r
        );
        const changed =
          clamped.x !== kf.x ||
          clamped.y !== kf.y ||
          clamped.width !== kf.width ||
          clamped.height !== kf.height;
        if (changed) {
          // Frame-based update in place (same frame, clamped box). Preserve origin.
          addOrUpdateKeyframe(kf.frame / framerate, clamped, undefined, kf.origin);
          moved.push({ frame: kf.frame, ...clamped, origin: kf.origin });
        }
      });
    }
    return { rotation: theta, movedKeyframes: moved };
  }, [addOrUpdateKeyframe, framerate]);

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
  // The default centered crop for the current aspect ratio. Shown when there are
  // NO keyframes (a fresh, untouched clip) so the reticule still renders. This is
  // the SAME default the GPU export applies for an empty crop (backend
  // default_crop.py mirrors calculateDefaultCrop), so preview matches export.
  const defaultCropData = useMemo(() => {
    if (!videoMetadata?.width || !videoMetadata?.height) return null;
    return calculateDefaultCrop(videoMetadata.width, videoMetadata.height, aspectRatio);
  }, [videoMetadata?.width, videoMetadata?.height, aspectRatio, calculateDefaultCrop]);

  const getCropDataAtTime = useCallback((time) => {
    // Falls back to the default crop when there are no keyframes yet.
    return getDataAtTime(time, cropDataKeys) ?? defaultCropData;
  }, [getDataAtTime, defaultCropData]);

  // Interpolate the crop at a time, falling back to the default crop when the
  // clip has no keyframes (so the reticule renders before the first edit).
  const interpolateCrop = useCallback((time) => {
    return interpolate(time) ?? defaultCropData;
  }, [interpolate, defaultCropData]);

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
    rotation,

    // Actions
    updateAspectRatio,
    setRotation,
    clampCropForCurrentRotation,
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
    interpolateCrop,
    hasKeyframeAt,
    getKeyframeAt,
    getCropDataAtTime,
    calculateDefaultCrop,
    getKeyframesForExport
  };
}
