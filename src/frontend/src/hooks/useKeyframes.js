import { useState, useCallback, useRef } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';

/**
 * Shared keyframe management hook
 * Provides common functionality for both crop and highlight keyframes
 *
 * ARCHITECTURE:
 * - Keyframes are tied to FRAME NUMBERS, not time
 * - Each keyframe has an 'origin' field: 'permanent', 'user', or 'trim'
 * - This enables proper lifecycle management and cleanup
 *
 * ORIGIN TYPES:
 * - 'permanent': Start (frame=0) and end keyframes
 * - 'user': User-created keyframes via drag/edit operations
 * - 'trim': Auto-created keyframes when trimming segments
 *
 * @param {Object} config - Configuration object
 * @param {Function} config.interpolateFn - Interpolation function for the keyframe type
 * @param {number} config.framerate - Video framerate
 * @param {Function} config.getEndFrame - Function to calculate the end frame
 */
export default function useKeyframes({ interpolateFn, framerate = 30, getEndFrame }) {
  const [keyframes, setKeyframes] = useState([]);
  const [isEndKeyframeExplicit, setIsEndKeyframeExplicit] = useState(false);
  const [copiedData, setCopiedData] = useState(null);

  /**
   * Initialize keyframes with start and end
   * @param {Object} defaultData - Default keyframe data
   * @param {number} endFrame - End frame number
   */
  const initializeKeyframes = useCallback((defaultData, endFrame) => {
    console.log('[useKeyframes] Initializing keyframes at frame=0 and frame=' + endFrame, defaultData);
    setIsEndKeyframeExplicit(false);
    setKeyframes([
      {
        frame: 0,
        origin: 'permanent',
        ...defaultData
      },
      {
        frame: endFrame,
        origin: 'permanent',
        ...defaultData
      }
    ]);
  }, []);

  /**
   * Check if keyframes need initialization or are stale
   * @param {number} expectedEndFrame - Expected end frame
   * @returns {boolean} - True if initialization is needed
   */
  const needsInitialization = useCallback((expectedEndFrame) => {
    if (keyframes.length === 0) return true;

    // Check if keyframes are stale (last keyframe doesn't match expected end)
    const lastKeyframe = keyframes[keyframes.length - 1];
    return lastKeyframe.frame !== expectedEndFrame;
  }, [keyframes]);

  /**
   * Add or update a keyframe at the specified time
   * @param {number} time - Time in seconds
   * @param {Object} data - Keyframe data
   * @param {number} totalFrames - Total frames in video (optional, for mirroring logic)
   * @param {string} origin - Keyframe origin: 'user', 'trim', or 'permanent'
   */
  const addOrUpdateKeyframe = useCallback((time, data, totalFrames = null, origin = 'user') => {
    const frame = timeToFrame(time, framerate);
    const endFrame = getEndFrame ? getEndFrame(totalFrames) : totalFrames;

    console.log('[useKeyframes] Adding/updating keyframe at time', time, '(frame', frame + '), origin:', origin);

    // Determine if this is a boundary keyframe
    const isEndKeyframe = endFrame !== null && frame === endFrame;
    const isStartKeyframe = frame === 0;

    // Permanent keyframes always have origin='permanent'
    const actualOrigin = (isStartKeyframe || isEndKeyframe) ? 'permanent' : origin;

    if (isEndKeyframe) {
      console.log('[useKeyframes] End keyframe explicitly set by user');
      setIsEndKeyframeExplicit(true);
    }

    setKeyframes(prev => {
      // Check if keyframe exists at this frame
      const existingIndex = prev.findIndex(kf => kf.frame === frame);

      let updated;
      if (existingIndex >= 0) {
        // Update existing keyframe - preserve origin if updating permanent keyframe
        const preservedOrigin = prev[existingIndex].origin === 'permanent' ? 'permanent' : actualOrigin;
        console.log('[useKeyframes] UPDATING existing keyframe at frame', frame, 'origin:', prev[existingIndex].origin, '->', preservedOrigin);
        updated = [...prev];
        updated[existingIndex] = { ...data, frame, origin: preservedOrigin };
      } else {
        // Add new keyframe and sort by frame
        console.log('[useKeyframes] CREATING new keyframe at frame', frame, 'origin:', actualOrigin);
        const newKeyframes = [...prev, { ...data, frame, origin: actualOrigin }];
        updated = newKeyframes.sort((a, b) => a.frame - b.frame);
      }

      // If updating start keyframe and end hasn't been explicitly set, mirror to end
      if (isStartKeyframe && !isEndKeyframeExplicit && endFrame !== null) {
        console.log('[useKeyframes] Mirroring start keyframe to end (end not yet explicit)');
        const endKeyframeIndex = updated.findIndex(kf => kf.frame === endFrame);
        if (endKeyframeIndex >= 0) {
          updated[endKeyframeIndex] = {
            ...data,
            frame: endFrame,
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
  }, [isEndKeyframeExplicit, framerate, getEndFrame]);

  /**
   * Remove a keyframe at the specified time
   * Cannot remove permanent keyframes (origin='permanent')
   */
  const removeKeyframe = useCallback((time, totalFrames = null) => {
    const frame = timeToFrame(time, framerate);
    const endFrame = getEndFrame ? getEndFrame(totalFrames) : totalFrames;

    console.log('[useKeyframes] Attempting to remove keyframe at time:', time, '(frame', frame + ')');

    setKeyframes(prev => {
      // Find the keyframe at this frame
      const keyframeToRemove = prev.find(kf => kf.frame === frame);

      if (!keyframeToRemove) {
        console.log('[useKeyframes] No keyframe found at frame', frame);
        return prev;
      }

      // Don't allow removing permanent keyframes
      if (keyframeToRemove.origin === 'permanent') {
        console.log('[useKeyframes] Cannot remove permanent keyframe at frame', frame);
        return prev;
      }

      // Don't allow removing if it would leave less than 2 keyframes
      if (prev.length <= 2) {
        console.log('[useKeyframes] Cannot remove - must have at least 2 keyframes');
        return prev;
      }

      console.log('[useKeyframes] Removing keyframe at frame', frame, 'origin:', keyframeToRemove.origin);
      return prev.filter(kf => kf.frame !== frame);
    });
  }, [framerate, getEndFrame]);

  /**
   * Interpolate keyframe values for a given time
   */
  const interpolate = useCallback((time) => {
    if (!interpolateFn) return null;
    const frame = timeToFrame(time, framerate);
    return interpolateFn(keyframes, frame, time);
  }, [keyframes, framerate, interpolateFn]);

  /**
   * Check if a keyframe exists at the specified time
   */
  const hasKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.some(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Get keyframe at specific time (if exists)
   */
  const getKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return keyframes.find(kf => kf.frame === frame);
  }, [keyframes, framerate]);

  /**
   * Copy the keyframe or interpolated data at the specified time
   * @param {Array<string>} dataKeys - Keys to copy from the keyframe data
   */
  const copyKeyframe = useCallback((time, dataKeys) => {
    const keyframe = getKeyframeAt(time);
    if (!keyframe) {
      // If no keyframe at this exact time, interpolate
      const interpolated = interpolate(time);
      if (interpolated) {
        const data = {};
        dataKeys.forEach(key => {
          if (interpolated[key] !== undefined) {
            data[key] = interpolated[key];
          }
        });
        setCopiedData(data);
        console.log('[useKeyframes] Copied interpolated data at time', time);
        return true;
      }
      console.log('[useKeyframes] No data to copy at time', time);
      return false;
    }

    // Copy only the specified properties
    const data = {};
    dataKeys.forEach(key => {
      if (keyframe[key] !== undefined) {
        data[key] = keyframe[key];
      }
    });
    setCopiedData(data);
    console.log('[useKeyframes] Copied keyframe at time', time);
    return true;
  }, [getKeyframeAt, interpolate]);

  /**
   * Paste the copied data at the specified time
   */
  const pasteKeyframe = useCallback((time, totalFrames) => {
    if (!copiedData) {
      console.log('[useKeyframes] No data to paste');
      return false;
    }

    console.log('[useKeyframes] Pasting data at time', time);
    addOrUpdateKeyframe(time, copiedData, totalFrames);
    return true;
  }, [copiedData, addOrUpdateKeyframe]);

  /**
   * Delete all keyframes within a time range
   * Used when trimming segments - removes keyframes that will be cut from the video
   * IMPORTANT: This DOES delete permanent keyframes in the trimmed range.
   * They will reconstitute at the trim boundary with origin='permanent'.
   */
  const deleteKeyframesInRange = useCallback((startTime, endTime, totalFrames = null) => {
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);
    const endKeyframeValue = getEndFrame ? getEndFrame(totalFrames) : totalFrames;

    console.log('[useKeyframes] Deleting keyframes in range:', startTime, '-', endTime, '(frames', startFrame, '-', endFrame + ')');

    setKeyframes(prev => {
      const filtered = prev.filter(kf => {
        // Keep keyframes outside the range
        if (kf.frame < startFrame || kf.frame > endFrame) {
          return true;
        }

        // DELETE all keyframes in the trimmed range, including permanent ones
        // Permanent keyframes will reconstitute at the trim boundary
        console.log('[useKeyframes] Deleting keyframe at frame', kf.frame, 'origin:', kf.origin);
        return false;
      });

      const deletedCount = prev.length - filtered.length;
      console.log('[useKeyframes] Deleted', deletedCount, 'keyframe(s), kept', filtered.length, 'keyframe(s)');

      return filtered;
    });
  }, [framerate, getEndFrame]);

  /**
   * Get the interpolated data at a specific time
   * @param {Array<string>} dataKeys - Keys to extract from interpolated data
   */
  const getDataAtTime = useCallback((time, dataKeys) => {
    const interpolated = interpolate(time);
    if (!interpolated) return null;

    const data = {};
    dataKeys.forEach(key => {
      if (interpolated[key] !== undefined) {
        data[key] = interpolated[key];
      }
    });
    return data;
  }, [interpolate]);

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
        console.log('[useKeyframes] Cleaned up', removedCount, 'trim-related keyframe(s)');
      }

      return filtered;
    });
  }, []);

  /**
   * Get keyframes in time-based format for export
   * @param {Array<string>} dataKeys - Keys to include in export
   */
  const getKeyframesForExport = useCallback((dataKeys) => {
    return keyframes.map(kf => {
      const exported = {
        time: frameToTime(kf.frame, framerate)
      };
      dataKeys.forEach(key => {
        if (kf[key] !== undefined) {
          exported[key] = kf[key];
        }
      });
      return exported;
    });
  }, [keyframes, framerate]);

  /**
   * Update all keyframes (useful for aspect ratio changes, etc.)
   */
  const updateAllKeyframes = useCallback((updateFn) => {
    setKeyframes(prev => prev.map(updateFn));
  }, []);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    console.log('[useKeyframes] Resetting state');
    setKeyframes([]);
    setIsEndKeyframeExplicit(false);
    setCopiedData(null);
  }, []);

  return {
    // State
    keyframes,
    isEndKeyframeExplicit,
    copiedData,
    setIsEndKeyframeExplicit,

    // Initialization
    initializeKeyframes,
    needsInitialization,

    // Keyframe operations
    addOrUpdateKeyframe,
    removeKeyframe,
    deleteKeyframesInRange,
    cleanupTrimKeyframes,
    updateAllKeyframes,

    // Copy/paste
    copyKeyframe,
    pasteKeyframe,

    // Queries
    interpolate,
    hasKeyframeAt,
    getKeyframeAt,
    getDataAtTime,
    getKeyframesForExport,

    // Reset
    reset
  };
}
