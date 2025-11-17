import { useState, useCallback, useEffect } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';
import { interpolateHighlightSpline } from '../utils/splineInterpolation';

/**
 * Custom hook for managing highlight ellipse state and keyframes
 * Highlight ellipses help viewers identify which player is being highlighted
 *
 * ARCHITECTURE:
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 * - Keyframes store: x, y (center position), radiusX, radiusY (ellipse radii), opacity, color
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=highlightDuration) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useHighlight(videoMetadata) {
  const [keyframes, setKeyframes] = useState([]);
  const [isEndKeyframeExplicit, setIsEndKeyframeExplicit] = useState(false);
  const [copiedHighlight, setCopiedHighlight] = useState(null);
  const [framerate] = useState(30);
  const [isEnabled, setIsEnabled] = useState(false); // Highlight layer is disabled by default
  const [highlightDuration, setHighlightDuration] = useState(3); // Default 3 seconds

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

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=highlightDurationFrames)
   * Default highlight duration is 3 seconds, not entire video
   */
  useEffect(() => {
    if (videoMetadata?.width && videoMetadata?.height && videoMetadata?.duration) {
      const highlightEndTime = Math.min(highlightDuration, videoMetadata.duration);
      const highlightEndFrame = timeToFrame(highlightEndTime, framerate);

      // Check if we need to initialize:
      // 1. No keyframes exist, OR
      // 2. Keyframes are stale
      const needsInit = keyframes.length === 0;

      if (needsInit) {
        const defaultHighlight = calculateDefaultHighlight(
          videoMetadata.width,
          videoMetadata.height
        );

        console.log('[useHighlight] Auto-initializing permanent keyframes at frame=0 and frame=' + highlightEndFrame, defaultHighlight);

        setIsEndKeyframeExplicit(false);

        setKeyframes([
          {
            frame: 0,
            origin: 'permanent',
            ...defaultHighlight
          },
          {
            frame: highlightEndFrame,
            origin: 'permanent',
            ...defaultHighlight
          }
        ]);
      }
    }
  }, [videoMetadata, calculateDefaultHighlight, framerate, highlightDuration]);

  /**
   * Update highlight duration (adjusts the end keyframe)
   */
  const updateHighlightDuration = useCallback((newDuration, videoDuration) => {
    if (!videoDuration) return;

    const clampedDuration = Math.max(0.1, Math.min(newDuration, videoDuration));
    setHighlightDuration(clampedDuration);

    const newEndFrame = timeToFrame(clampedDuration, framerate);

    setKeyframes(prev => {
      if (prev.length < 2) return prev;

      // Find current end keyframe (last one)
      const endKeyframe = prev[prev.length - 1];
      const otherKeyframes = prev.slice(0, -1);

      // Update end keyframe to new frame position
      const updatedEndKeyframe = {
        ...endKeyframe,
        frame: newEndFrame
      };

      // Remove any keyframes that are now past the end
      const filteredKeyframes = otherKeyframes.filter(kf => kf.frame < newEndFrame);

      return [...filteredKeyframes, updatedEndKeyframe].sort((a, b) => a.frame - b.frame);
    });

    console.log('[useHighlight] Updated highlight duration to', clampedDuration, 'seconds');
  }, [framerate]);

  /**
   * Enable or disable the highlight layer
   */
  const toggleEnabled = useCallback(() => {
    setIsEnabled(prev => {
      const newEnabled = !prev;
      // When enabling, ensure duration is at least 3s if it's currently 0 or very small
      if (newEnabled && highlightDuration < 0.5) {
        setHighlightDuration(3);
        console.log('[useHighlight] Reset highlight duration to 3s on enable');
      }
      console.log('[useHighlight] Highlight layer toggled:', newEnabled);
      return newEnabled;
    });
  }, [isEnabled, highlightDuration]);

  /**
   * Add or update a keyframe at the specified time
   * @param {number} time - Time in seconds
   * @param {Object} highlightData - Highlight properties {x, y, radiusX, radiusY, opacity, color}
   * @param {number} duration - Video duration in seconds
   * @param {string} origin - Keyframe origin: 'user', 'trim', or 'permanent'
   */
  const addOrUpdateKeyframe = useCallback((time, highlightData, duration, origin = 'user') => {
    const frame = timeToFrame(time, framerate);
    const highlightEndFrame = timeToFrame(Math.min(highlightDuration, duration || Infinity), framerate);

    console.log('[useHighlight] Adding/updating keyframe at time', time, '(frame', frame + '), origin:', origin, 'data:', highlightData);

    const isEndKeyframe = frame === highlightEndFrame;
    const isStartKeyframe = frame === 0;

    const actualOrigin = (isStartKeyframe || isEndKeyframe) ? 'permanent' : origin;

    if (isEndKeyframe) {
      console.log('[useHighlight] End keyframe explicitly set by user');
      setIsEndKeyframeExplicit(true);
    }

    setKeyframes(prev => {
      const existingIndex = prev.findIndex(kf => kf.frame === frame);

      let updated;
      if (existingIndex >= 0) {
        const preservedOrigin = prev[existingIndex].origin === 'permanent' ? 'permanent' : actualOrigin;
        updated = [...prev];
        updated[existingIndex] = { ...highlightData, frame, origin: preservedOrigin };
      } else {
        const newKeyframes = [...prev, { ...highlightData, frame, origin: actualOrigin }];
        updated = newKeyframes.sort((a, b) => a.frame - b.frame);
      }

      // Mirror to end if updating start and end isn't explicit
      if (isStartKeyframe && !isEndKeyframeExplicit) {
        console.log('[useHighlight] Mirroring start keyframe to end');
        const endKeyframeIndex = updated.findIndex(kf => kf.frame === highlightEndFrame);
        if (endKeyframeIndex >= 0) {
          updated[endKeyframeIndex] = {
            ...highlightData,
            frame: highlightEndFrame,
            origin: 'permanent'
          };
        }
      }

      return updated;
    });
  }, [isEndKeyframeExplicit, framerate, highlightDuration]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes at frame=0 or frame=highlightEndFrame
   */
  const removeKeyframe = useCallback((time, duration) => {
    const frame = timeToFrame(time, framerate);
    const highlightEndFrame = timeToFrame(Math.min(highlightDuration, duration || Infinity), framerate);

    console.log('[useHighlight] Attempting to remove keyframe at time:', time, '(frame', frame + ')');

    if (frame === 0) {
      console.log('[useHighlight] Cannot remove permanent start keyframe');
      return;
    }
    if (frame === highlightEndFrame) {
      console.log('[useHighlight] Cannot remove permanent end keyframe');
      return;
    }

    setKeyframes(prev => {
      if (prev.length <= 2) {
        console.log('[useHighlight] Cannot remove - must have at least 2 keyframes');
        return prev;
      }
      return prev.filter(kf => kf.frame !== frame);
    });
  }, [framerate, highlightDuration]);

  /**
   * Interpolate highlight values between keyframes for a given time
   * Uses cubic spline (Catmull-Rom) interpolation for smooth animations
   */
  const interpolateHighlight = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return interpolateHighlightSpline(keyframes, frame, time);
  }, [keyframes, framerate]);

  /**
   * Check if a keyframe exists at the specified time
   */
  const hasKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.some(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Get keyframe at specific time
   */
  const getKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.find(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Copy the highlight keyframe at the specified time
   */
  const copyHighlightKeyframe = useCallback((time) => {
    const keyframe = getKeyframeAt(time);
    if (!keyframe) {
      const interpolated = interpolateHighlight(time);
      if (interpolated) {
        const { x, y, radiusX, radiusY, opacity, color } = interpolated;
        setCopiedHighlight({ x, y, radiusX, radiusY, opacity, color });
        console.log('[useHighlight] Copied interpolated highlight at time', time);
        return true;
      }
      console.log('[useHighlight] No highlight data to copy at time', time);
      return false;
    }

    const { x, y, radiusX, radiusY, opacity, color } = keyframe;
    setCopiedHighlight({ x, y, radiusX, radiusY, opacity, color });
    console.log('[useHighlight] Copied highlight keyframe at time', time);
    return true;
  }, [getKeyframeAt, interpolateHighlight]);

  /**
   * Paste the copied highlight data at the specified time
   */
  const pasteHighlightKeyframe = useCallback((time, duration) => {
    if (!copiedHighlight) {
      console.log('[useHighlight] No highlight data to paste');
      return false;
    }

    console.log('[useHighlight] Pasting highlight at time', time);
    addOrUpdateKeyframe(time, copiedHighlight, duration);
    return true;
  }, [copiedHighlight, addOrUpdateKeyframe]);

  /**
   * Get keyframes in time-based format for export
   */
  const getKeyframesForExport = useCallback(() => {
    return keyframes.map(kf => ({
      time: frameToTime(kf.frame, framerate),
      x: kf.x,
      y: kf.y,
      radiusX: kf.radiusX,
      radiusY: kf.radiusY,
      opacity: kf.opacity,
      color: kf.color
    }));
  }, [keyframes, framerate]);

  /**
   * Delete all keyframes within a time range
   */
  const deleteKeyframesInRange = useCallback((startTime, endTime, videoDuration) => {
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);
    const totalFrames = videoDuration ? timeToFrame(videoDuration, framerate) : null;

    console.log('[useHighlight] Deleting keyframes in range:', startTime, '-', endTime);

    setKeyframes(prev => {
      const filtered = prev.filter(kf => {
        if (kf.frame < startFrame || kf.frame > endFrame) {
          return true;
        }

        if (kf.frame === 0) {
          return true;
        }

        if (totalFrames !== null && kf.frame === totalFrames) {
          return true;
        }

        return false;
      });

      return filtered;
    });
  }, [framerate]);

  /**
   * Get the interpolated highlight data at a specific time
   */
  const getHighlightDataAtTime = useCallback((time) => {
    const interpolated = interpolateHighlight(time);
    if (!interpolated) return null;

    const { x, y, radiusX, radiusY, opacity, color } = interpolated;
    return { x, y, radiusX, radiusY, opacity, color };
  }, [interpolateHighlight]);

  /**
   * Clean up trim-related keyframes
   */
  const cleanupTrimKeyframes = useCallback(() => {
    setKeyframes(prev => {
      const filtered = prev.filter(kf => kf.origin !== 'trim');
      const removedCount = prev.length - filtered.length;

      if (removedCount > 0) {
        console.log('[useHighlight] Cleaned up', removedCount, 'trim-related keyframe(s)');
      }

      return filtered;
    });
  }, []);

  /**
   * Reset all highlight state
   */
  const reset = useCallback(() => {
    console.log('[useHighlight] Resetting highlight state');
    setKeyframes([]);
    setIsEndKeyframeExplicit(false);
    setCopiedHighlight(null);
    setIsEnabled(false);
    setHighlightDuration(3);
  }, []);

  return {
    // State
    keyframes,
    isEndKeyframeExplicit,
    copiedHighlight,
    framerate,
    isEnabled,
    highlightDuration,

    // Actions
    toggleEnabled,
    updateHighlightDuration,
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    copyHighlightKeyframe,
    pasteHighlightKeyframe,
    reset,

    // Queries
    interpolateHighlight,
    hasKeyframeAt,
    getKeyframeAt,
    getHighlightDataAtTime,
    calculateDefaultHighlight,
    getKeyframesForExport
  };
}
