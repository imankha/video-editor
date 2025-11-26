import { useState, useCallback, useEffect } from 'react';
import { timeToFrame } from '../utils/videoUtils';
import { interpolateHighlightSpline } from '../utils/splineInterpolation';
import useKeyframeController from './useKeyframeController';

/**
 * Custom hook for managing highlight ellipse state and keyframes
 * Highlight ellipses help viewers identify which player is being highlighted
 *
 * REFACTORED ARCHITECTURE:
 * - Uses useKeyframeController (state machine) for all keyframe management
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=highlightDuration) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useHighlight(videoMetadata, trimRange = null) {
  const [framerate] = useState(30);
  const [isEnabled, setIsEnabled] = useState(false); // Highlight layer is disabled by default
  const [highlightDuration, setHighlightDuration] = useState(3); // Default 3 seconds

  // Highlight data keys for copy/paste operations
  const highlightDataKeys = ['x', 'y', 'radiusX', 'radiusY', 'opacity', 'color'];

  // Initialize shared keyframe management
  const keyframeManager = useKeyframeController({
    interpolateFn: interpolateHighlightSpline,
    framerate,
    getEndFrame: (duration) => {
      if (!duration) return null;
      const highlightEndTime = Math.min(highlightDuration, duration);
      return timeToFrame(highlightEndTime, framerate);
    }
  });

  /**
   * Calculate the default highlight ellipse (centered in video)
   * Returns a vertical ellipse positioned at center (taller than wide for upright players)
   */
  const calculateDefaultHighlight = useCallback((videoWidth, videoHeight) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, radiusX: 30, radiusY: 50, opacity: 0.15, color: '#FFFF00' };
    }

    // Default: vertical ellipse centered in the video
    // radiusY is 1.5x radiusX for upright players
    const radiusX = Math.round(videoHeight * 0.06); // Smaller horizontal radius
    const radiusY = Math.round(videoHeight * 0.12); // Larger vertical radius (1.5-2x)
    const x = Math.round(videoWidth / 2);
    const y = Math.round(videoHeight / 2);

    return {
      x,
      y,
      radiusX,
      radiusY,
      opacity: 0.15, // More transparent
      color: '#FFFF00' // Yellow highlight
    };
  }, []);

  // Extract stable references from keyframeManager to avoid dependency array issues
  // Using the object directly would cause re-runs on every render
  const { needsInitialization, initializeKeyframes } = keyframeManager;

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=highlightDurationFrames)
   * Default highlight duration is 3 seconds, not entire video
   * NOTE: Skips initialization if trimRange is set - trim operations handle their own keyframe management
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration) {
      const highlightEndTime = Math.min(highlightDuration, videoMetadata.duration);
      const highlightEndFrame = timeToFrame(highlightEndTime, framerate);

      // Check if we need to initialize (only on first load, not after trim)
      // Skip initialization if trimRange is set - trim operations handle their own keyframe management
      if (!trimRange && needsInitialization(highlightEndFrame)) {
        const defaultHighlight = calculateDefaultHighlight(
          videoMetadata.width,
          videoMetadata.height
        );

        initializeKeyframes(defaultHighlight, highlightEndFrame);
      }
    }
  }, [videoMetadata, calculateDefaultHighlight, framerate, highlightDuration, needsInitialization, initializeKeyframes, trimRange]);

  /**
   * Update highlight duration (adjusts the end keyframe)
   */
  const updateHighlightDuration = useCallback((newDuration, videoDuration) => {
    if (!videoDuration) return;

    const clampedDuration = Math.max(0.1, Math.min(newDuration, videoDuration));
    setHighlightDuration(clampedDuration);

    const newEndFrame = timeToFrame(clampedDuration, framerate);

    keyframeManager.updateAllKeyframes((kf, index, arr) => {
      // If this is the last keyframe (end keyframe), update its frame
      if (index === arr.length - 1) {
        return {
          ...kf,
          frame: newEndFrame
        };
      }

      // Filter out keyframes that are now past the end
      return kf.frame < newEndFrame ? kf : null;
    });

    // Remove null entries (keyframes past the end)
    const filtered = keyframeManager.keyframes.filter(kf => kf !== null);
  }, [framerate, keyframeManager]);

  /**
   * Enable or disable the highlight layer
   */
  const toggleEnabled = useCallback(() => {
    setIsEnabled(prev => {
      const newEnabled = !prev;
      // When enabling, ensure duration is at least 3s if it's currently 0 or very small
      if (newEnabled && highlightDuration < 0.5) {
        setHighlightDuration(3);
      }
      return newEnabled;
    });
  }, [highlightDuration]);

  /**
   * Copy the highlight keyframe at the specified time
   */
  const copyHighlightKeyframe = useCallback((time) => {
    return keyframeManager.copyKeyframe(time, highlightDataKeys);
  }, [keyframeManager]);

  /**
   * Paste the copied highlight data at the specified time
   */
  const pasteHighlightKeyframe = useCallback((time, duration) => {
    return keyframeManager.pasteKeyframe(time, duration);
  }, [keyframeManager]);

  /**
   * Get the interpolated highlight data at a specific time
   */
  const getHighlightDataAtTime = useCallback((time) => {
    return keyframeManager.getDataAtTime(time, highlightDataKeys);
  }, [keyframeManager]);

  /**
   * Get keyframes in time-based format for export
   */
  const getKeyframesForExport = useCallback(() => {
    return keyframeManager.getKeyframesForExport(highlightDataKeys);
  }, [keyframeManager]);

  /**
   * Reset all highlight state
   */
  const reset = useCallback(() => {
    keyframeManager.reset();
    setIsEnabled(false);
    setHighlightDuration(3);
  }, [keyframeManager]);

  return {
    // State
    keyframes: keyframeManager.keyframes,
    isEndKeyframeExplicit: keyframeManager.isEndKeyframeExplicit,
    copiedHighlight: keyframeManager.copiedData,
    framerate,
    isEnabled,
    highlightDuration,

    // Actions
    toggleEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe: keyframeManager.addOrUpdateKeyframe,
    removeKeyframe: keyframeManager.removeKeyframe,
    deleteKeyframesInRange: keyframeManager.deleteKeyframesInRange,
    cleanupTrimKeyframes: keyframeManager.cleanupTrimKeyframes,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    reset,

    // Queries
    interpolateHighlight: keyframeManager.interpolate,
    hasKeyframeAt: keyframeManager.hasKeyframeAt,
    getKeyframeAt: keyframeManager.getKeyframeAt,
    getHighlightDataAtTime,
    calculateDefaultHighlight,
    getKeyframesForExport
  };
}
