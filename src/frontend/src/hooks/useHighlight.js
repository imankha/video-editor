import { useState, useCallback, useEffect } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';

/**
 * Custom hook for managing highlight circle state and keyframes
 * Highlight circles help viewers identify which player is being highlighted
 *
 * ARCHITECTURE:
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 * - Keyframes store: x, y (center position), radius, opacity, color
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end (frame=totalFrames) keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 */
export default function useHighlight(videoMetadata) {
  const [keyframes, setKeyframes] = useState([]);
  const [isEndKeyframeExplicit, setIsEndKeyframeExplicit] = useState(false);
  const [copiedHighlight, setCopiedHighlight] = useState(null);
  const [framerate] = useState(30);
  const [isEnabled, setIsEnabled] = useState(false); // Highlight layer is disabled by default

  /**
   * Calculate the default highlight circle (centered in video)
   * Returns a circle positioned at center with reasonable radius
   */
  const calculateDefaultHighlight = useCallback((videoWidth, videoHeight) => {
    if (!videoWidth || !videoHeight) {
      return { x: 0, y: 0, radius: 50, opacity: 0.3, color: '#FFFF00' };
    }

    // Default: circle centered in the video with radius 10% of video height
    const radius = Math.round(videoHeight * 0.1);
    const x = Math.round(videoWidth / 2);
    const y = Math.round(videoHeight / 2);

    return {
      x,
      y,
      radius,
      opacity: 0.3,
      color: '#FFFF00' // Yellow highlight
    };
  }, []);

  /**
   * Auto-initialize keyframes when metadata loads
   * Creates permanent keyframes at start (frame=0) and end (frame=totalFrames)
   * End keyframe initially mirrors start until explicitly modified
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
        const defaultHighlight = calculateDefaultHighlight(
          videoMetadata.width,
          videoMetadata.height
        );

        console.log('[useHighlight] Auto-initializing permanent keyframes at frame=0 and frame=' + totalFrames, defaultHighlight);

        setIsEndKeyframeExplicit(false);

        setKeyframes([
          {
            frame: 0,
            origin: 'permanent',
            ...defaultHighlight
          },
          {
            frame: totalFrames,
            origin: 'permanent',
            ...defaultHighlight
          }
        ]);
      }
    }
  }, [videoMetadata, keyframes, calculateDefaultHighlight, framerate]);

  /**
   * Enable or disable the highlight layer
   */
  const toggleEnabled = useCallback(() => {
    setIsEnabled(prev => !prev);
    console.log('[useHighlight] Highlight layer toggled:', !isEnabled);
  }, [isEnabled]);

  /**
   * Add or update a keyframe at the specified time
   * @param {number} time - Time in seconds
   * @param {Object} highlightData - Highlight properties {x, y, radius, opacity, color}
   * @param {number} duration - Video duration in seconds
   * @param {string} origin - Keyframe origin: 'user', 'trim', or 'permanent'
   */
  const addOrUpdateKeyframe = useCallback((time, highlightData, duration, origin = 'user') => {
    const frame = timeToFrame(time, framerate);
    const totalFrames = duration ? timeToFrame(duration, framerate) : null;

    console.log('[useHighlight] Adding/updating keyframe at time', time, '(frame', frame + '), origin:', origin, 'data:', highlightData);

    const isEndKeyframe = totalFrames !== null && frame === totalFrames;
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
      if (isStartKeyframe && !isEndKeyframeExplicit && totalFrames !== null) {
        console.log('[useHighlight] Mirroring start keyframe to end');
        const endKeyframeIndex = updated.findIndex(kf => kf.frame === totalFrames);
        if (endKeyframeIndex >= 0) {
          updated[endKeyframeIndex] = {
            ...highlightData,
            frame: totalFrames,
            origin: 'permanent'
          };
        }
      }

      return updated;
    });
  }, [isEndKeyframeExplicit, framerate]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes at frame=0 or frame=totalFrames
   */
  const removeKeyframe = useCallback((time, duration) => {
    const frame = timeToFrame(time, framerate);
    const totalFrames = duration ? timeToFrame(duration, framerate) : null;

    console.log('[useHighlight] Attempting to remove keyframe at time:', time, '(frame', frame + ')');

    if (frame === 0) {
      console.log('[useHighlight] Cannot remove permanent start keyframe');
      return;
    }
    if (totalFrames !== null && frame === totalFrames) {
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
  }, [framerate]);

  /**
   * Round to 3 decimal places
   */
  const round3 = (value) => Math.round(value * 1000) / 1000;

  /**
   * Interpolate highlight values between keyframes for a given time
   */
  const interpolateHighlight = useCallback((time) => {
    if (keyframes.length === 0) {
      return null;
    }

    const frame = timeToFrame(time, framerate);

    if (keyframes.length === 1) {
      return { ...keyframes[0], time };
    }

    // Find surrounding keyframes
    let beforeKf = null;
    let afterKf = null;

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].frame <= frame) {
        beforeKf = keyframes[i];
      }
      if (keyframes[i].frame > frame && !afterKf) {
        afterKf = keyframes[i];
        break;
      }
    }

    if (!beforeKf) {
      return { ...keyframes[0], time };
    }

    if (!afterKf) {
      return { ...beforeKf, time };
    }

    // Linear interpolation
    const frameDuration = afterKf.frame - beforeKf.frame;
    const progress = (frame - beforeKf.frame) / frameDuration;

    return {
      time,
      frame,
      x: round3(beforeKf.x + (afterKf.x - beforeKf.x) * progress),
      y: round3(beforeKf.y + (afterKf.y - beforeKf.y) * progress),
      radius: round3(beforeKf.radius + (afterKf.radius - beforeKf.radius) * progress),
      opacity: round3(beforeKf.opacity + (afterKf.opacity - beforeKf.opacity) * progress),
      // Color interpolation - for now just use the before color
      // Could implement HSL interpolation for smoother transitions
      color: beforeKf.color
    };
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
        const { x, y, radius, opacity, color } = interpolated;
        setCopiedHighlight({ x, y, radius, opacity, color });
        console.log('[useHighlight] Copied interpolated highlight at time', time);
        return true;
      }
      console.log('[useHighlight] No highlight data to copy at time', time);
      return false;
    }

    const { x, y, radius, opacity, color } = keyframe;
    setCopiedHighlight({ x, y, radius, opacity, color });
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
      radius: kf.radius,
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

    const { x, y, radius, opacity, color } = interpolated;
    return { x, y, radius, opacity, color };
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
  }, []);

  return {
    // State
    keyframes,
    isEndKeyframeExplicit,
    copiedHighlight,
    framerate,
    isEnabled,

    // Actions
    toggleEnabled,
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
