import { useReducer, useCallback, useMemo } from 'react';
import { timeToFrame, frameToTime } from '../utils/videoUtils';
import { findKeyframeIndexNearFrame, FRAME_TOLERANCE } from '../utils/keyframeUtils';
import {
  keyframeReducer,
  createInitialState,
  actions,
  selectors,
  validateInvariants
} from '../controllers/keyframeController';

/**
 * React hook wrapper for keyframe controller
 *
 * Provides a React-friendly interface to the keyframe state machine:
 * - Uses useReducer for predictable state updates
 * - Converts between time and frame numbers
 * - Provides interpolation via callback
 * - Validates invariants in development
 *
 * @param {Object} config - Configuration object
 * @param {Function} config.interpolateFn - Interpolation function for the keyframe type
 * @param {number} config.framerate - Video framerate (default: 30)
 * @param {Function} config.getEndFrame - Function to calculate the end frame from duration
 */
export default function useKeyframeController({
  interpolateFn,
  framerate = 30,
  getEndFrame
}) {
  const [state, dispatch] = useReducer(keyframeReducer, null, createInitialState);

  // Validate invariants in development
  if (process.env.NODE_ENV === 'development') {
    const violations = validateInvariants(state);
    if (violations.length > 0) {
      console.error('Keyframe invariant violations:', violations);
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize keyframes with start and end
   */
  const initializeKeyframes = useCallback((defaultData, endFrame) => {
    dispatch(actions.initialize(defaultData, endFrame, framerate));
  }, [framerate]);

  /**
   * Check if keyframes need initialization or are stale
   */
  const needsInitialization = useCallback((expectedEndFrame) => {
    return selectors.needsInitialization(state, expectedEndFrame);
  }, [state]);

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    dispatch(actions.reset());
  }, []);

  // ============================================================================
  // KEYFRAME OPERATIONS
  // ============================================================================

  /**
   * Add or update a keyframe at the specified time
   */
  const addOrUpdateKeyframe = useCallback((time, data, totalFrames = null, origin = 'user') => {
    const frame = timeToFrame(time, framerate);
    dispatch(actions.addKeyframe(frame, data, origin));
  }, [framerate]);

  /**
   * Remove a keyframe at the specified time
   */
  const removeKeyframe = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    dispatch(actions.removeKeyframe(frame));
  }, [framerate]);

  /**
   * Delete all keyframes within a time range
   */
  const deleteKeyframesInRange = useCallback((startTime, endTime) => {
    const startFrame = timeToFrame(startTime, framerate);
    const endFrame = timeToFrame(endTime, framerate);
    dispatch(actions.deleteKeyframesInRange(startFrame, endFrame));
  }, [framerate]);

  /**
   * Update all keyframes with a mapping function
   */
  const updateAllKeyframes = useCallback((updateFn) => {
    dispatch(actions.updateAllKeyframes(updateFn));
  }, []);

  /**
   * Clean up trim-related keyframes
   */
  const cleanupTrimKeyframes = useCallback(() => {
    dispatch(actions.cleanupTrimKeyframes());
  }, []);

  // ============================================================================
  // COPY/PASTE OPERATIONS
  // ============================================================================

  /**
   * Copy the keyframe or interpolated data at the specified time
   */
  const copyKeyframe = useCallback((time, dataKeys) => {
    const frame = timeToFrame(time, framerate);
    const keyframe = selectors.getKeyframeAtFrame(state, frame);

    let dataToCopy;

    if (keyframe) {
      // Copy from existing keyframe
      dataToCopy = {};
      dataKeys.forEach(key => {
        if (keyframe[key] !== undefined) {
          dataToCopy[key] = keyframe[key];
        }
      });
    } else if (interpolateFn) {
      // Interpolate if no exact keyframe
      const interpolated = interpolateFn(state.keyframes, frame, time);
      if (interpolated) {
        dataToCopy = {};
        dataKeys.forEach(key => {
          if (interpolated[key] !== undefined) {
            dataToCopy[key] = interpolated[key];
          }
        });
      }
    }

    if (dataToCopy && Object.keys(dataToCopy).length > 0) {
      dispatch(actions.copyKeyframe(dataToCopy));
      return true;
    }
    return false;
  }, [state, framerate, interpolateFn]);

  /**
   * Paste the copied data at the specified time
   */
  const pasteKeyframe = useCallback((time, totalFrames) => {
    if (!state.copiedData) return false;

    const frame = timeToFrame(time, framerate);
    dispatch(actions.addKeyframe(frame, state.copiedData, 'user'));
    return true;
  }, [state.copiedData, framerate]);

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Interpolate keyframe values for a given time
   */
  const interpolate = useCallback((time) => {
    if (!interpolateFn) return null;
    const frame = timeToFrame(time, framerate);
    return interpolateFn(state.keyframes, frame, time);
  }, [state.keyframes, framerate, interpolateFn]);

  /**
   * Check if a keyframe exists at the specified time
   */
  const hasKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return selectors.hasKeyframeAtFrame(state, frame);
  }, [state, framerate]);

  /**
   * Get keyframe at specific time (if exists)
   */
  const getKeyframeAt = useCallback((time) => {
    const frame = timeToFrame(time, framerate);
    return selectors.getKeyframeAtFrame(state, frame);
  }, [state, framerate]);

  /**
   * Get the interpolated data at a specific time
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
   * Get keyframes in time-based format for export
   */
  const getKeyframesForExport = useCallback((dataKeys) => {
    return state.keyframes.map(kf => {
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
  }, [state.keyframes, framerate]);

  /**
   * Find selected keyframe index based on current time
   * Uses tolerance-based matching for playhead proximity
   */
  const getSelectedKeyframeIndex = useCallback((currentTime) => {
    const currentFrame = timeToFrame(currentTime, framerate);
    return findKeyframeIndexNearFrame(state.keyframes, currentFrame, FRAME_TOLERANCE);
  }, [state.keyframes, framerate]);

  /**
   * Derive selected keyframe index (for useMemo in components)
   */
  const selectedKeyframeIndex = useMemo(() => {
    // This is a placeholder - components should call getSelectedKeyframeIndex with current time
    return -1;
  }, []);

  // ============================================================================
  // SETTERS (for backwards compatibility)
  // ============================================================================

  const setIsEndKeyframeExplicit = useCallback((isExplicit) => {
    dispatch(actions.setEndExplicit(isExplicit));
  }, []);

  return {
    // State
    keyframes: state.keyframes,
    isEndKeyframeExplicit: state.isEndKeyframeExplicit,
    copiedData: state.copiedData,
    machineState: state.machineState,
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
    getSelectedKeyframeIndex,

    // Reset
    reset,

    // Direct dispatch (for advanced use cases)
    dispatch
  };
}
