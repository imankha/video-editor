/**
 * Keyframe Controller - State Machine for Keyframe Management
 *
 * Pure functions for keyframe state transitions, enabling:
 * - Testable state logic without React dependencies
 * - Single source of truth for keyframe operations
 * - Clear separation of state logic from UI rendering
 *
 * ARCHITECTURE:
 * - All state transitions are pure functions
 * - State is immutable - each operation returns new state
 * - Designed to work with useReducer in React
 *
 * KEYFRAME STRUCTURE:
 * {
 *   frame: number,           // Frame number (not time)
 *   origin: 'permanent'|'user'|'trim',
 *   ...data                  // Type-specific data (crop: x,y,width,height; highlight: x,y,radiusX,radiusY,opacity,color)
 * }
 */

import {
  findKeyframeIndexAtFrame,
  findKeyframeIndexNearFrame,
  findKeyframeAtFrame,
  hasKeyframeAtFrame,
  FRAME_TOLERANCE,
  MIN_KEYFRAME_SPACING
} from '../utils/keyframeUtils';

// State machine states
export const KeyframeStates = {
  UNINITIALIZED: 'uninitialized',
  INITIALIZED: 'initialized',
  EDITING: 'editing',
  TRIMMING: 'trimming'
};

// Action types
export const ActionTypes = {
  // Lifecycle
  INITIALIZE: 'INITIALIZE',
  RESET: 'RESET',
  RESTORE_KEYFRAMES: 'RESTORE_KEYFRAMES',

  // Keyframe operations
  ADD_KEYFRAME: 'ADD_KEYFRAME',
  UPDATE_KEYFRAME: 'UPDATE_KEYFRAME',
  REMOVE_KEYFRAME: 'REMOVE_KEYFRAME',
  DELETE_KEYFRAMES_IN_RANGE: 'DELETE_KEYFRAMES_IN_RANGE',
  UPDATE_ALL_KEYFRAMES: 'UPDATE_ALL_KEYFRAMES',

  // Trim operations
  START_TRIM: 'START_TRIM',
  END_TRIM: 'END_TRIM',
  CLEANUP_TRIM_KEYFRAMES: 'CLEANUP_TRIM_KEYFRAMES',

  // Copy/paste
  COPY_KEYFRAME: 'COPY_KEYFRAME',
  PASTE_KEYFRAME: 'PASTE_KEYFRAME',
  CLEAR_COPIED: 'CLEAR_COPIED',

  // End keyframe tracking
  SET_END_EXPLICIT: 'SET_END_EXPLICIT'
};

/**
 * Initial state factory
 * @returns {Object} Fresh initial state
 */
export function createInitialState() {
  return {
    machineState: KeyframeStates.UNINITIALIZED,
    keyframes: [],
    isEndKeyframeExplicit: false,
    copiedData: null,
    endFrame: null,
    framerate: 30
  };
}

/**
 * Validate state invariants (development only)
 * @param {Object} state - Current state
 * @returns {Array<string>} Array of violation messages
 */
export function validateInvariants(state) {
  const violations = [];

  // All keyframes must have an origin
  const missingOrigin = state.keyframes.filter(kf => !kf.origin);
  if (missingOrigin.length > 0) {
    violations.push(`Keyframes missing origin: ${JSON.stringify(missingOrigin)}`);
  }

  // All keyframes must have a frame number
  const missingFrame = state.keyframes.filter(kf => typeof kf.frame !== 'number');
  if (missingFrame.length > 0) {
    violations.push(`Keyframes missing frame number: ${JSON.stringify(missingFrame)}`);
  }

  // Keyframes should be sorted by frame
  for (let i = 1; i < state.keyframes.length; i++) {
    if (state.keyframes[i].frame < state.keyframes[i - 1].frame) {
      violations.push(`Keyframes not sorted at index ${i}`);
      break;
    }
  }

  // If initialized, should have at least 2 keyframes (start and end)
  if (state.machineState !== KeyframeStates.UNINITIALIZED && state.keyframes.length < 2) {
    violations.push(`Initialized state should have at least 2 keyframes, has ${state.keyframes.length}`);
  }

  // If initialized, must have permanent keyframes at frame 0 and endFrame
  if (state.machineState !== KeyframeStates.UNINITIALIZED && state.keyframes.length >= 2) {
    const first = state.keyframes[0];
    if (first.frame !== 0 || first.origin !== 'permanent') {
      violations.push(`First keyframe must be permanent at frame 0, got frame=${first.frame} origin=${first.origin}`);
    }
    if (state.endFrame !== null) {
      const last = state.keyframes[state.keyframes.length - 1];
      if (last.frame !== state.endFrame || last.origin !== 'permanent') {
        violations.push(`Last keyframe must be permanent at endFrame=${state.endFrame}, got frame=${last.frame} origin=${last.origin}`);
      }
    }
  }

  return violations;
}

/**
 * Sort keyframes by frame number
 * @param {Array} keyframes - Array of keyframes
 * @returns {Array} Sorted keyframes
 */
function sortKeyframes(keyframes) {
  return [...keyframes].sort((a, b) => a.frame - b.frame);
}

/**
 * Ensure permanent keyframes exist at frame 0 and endFrame.
 * If missing, reconstitute from the nearest keyframe's data.
 * @param {Array} keyframes - Sorted array of keyframes
 * @param {number|null} endFrame - End frame number
 * @returns {Array} Keyframes with permanent boundaries guaranteed
 */
function ensurePermanentKeyframes(keyframes, endFrame) {
  if (keyframes.length === 0) return keyframes;

  let result = [...keyframes];

  // Ensure frame 0 exists — absorb nearby keyframe if within MIN_KEYFRAME_SPACING
  const startIndex = result.findIndex(kf => kf.frame === 0);
  if (startIndex >= 0) {
    result[startIndex] = { ...result[startIndex], origin: 'permanent' };
  } else {
    const nearbyStartIndex = result.findIndex(kf => kf.frame < MIN_KEYFRAME_SPACING);
    if (nearbyStartIndex >= 0) {
      // Absorb: move nearby keyframe to frame 0
      result[nearbyStartIndex] = { ...result[nearbyStartIndex], frame: 0, origin: 'permanent' };
    } else {
      // No nearby keyframe — reconstitute from first
      const { frame: _f, origin: _o, ...data } = result[0];
      result = [{ ...data, frame: 0, origin: 'permanent' }, ...result];
    }
  }

  // Ensure endFrame exists — absorb nearby keyframe if within MIN_KEYFRAME_SPACING
  if (endFrame !== null && endFrame !== undefined) {
    const endIndex = result.findIndex(kf => kf.frame === endFrame);
    if (endIndex >= 0) {
      result[endIndex] = { ...result[endIndex], origin: 'permanent' };
    } else {
      const nearbyEndIndex = result.findIndex(kf => kf.frame > endFrame - MIN_KEYFRAME_SPACING && kf.frame < endFrame);
      if (nearbyEndIndex >= 0) {
        // Absorb: move nearby keyframe to endFrame
        result[nearbyEndIndex] = { ...result[nearbyEndIndex], frame: endFrame, origin: 'permanent' };
      } else {
        // No nearby keyframe — reconstitute from last
        const { frame: _f, origin: _o, ...data } = result[result.length - 1];
        result = [...result, { ...data, frame: endFrame, origin: 'permanent' }];
      }
    }
  }

  return sortKeyframes(result);
}

/**
 * Determine the origin for a keyframe based on its position
 * @param {number} frame - Frame number
 * @param {number} endFrame - End frame number
 * @param {string} requestedOrigin - Requested origin
 * @returns {string} Actual origin to use
 */
function determineOrigin(frame, endFrame, requestedOrigin) {
  const isStartKeyframe = frame === 0;
  const isEndKeyframe = endFrame !== null && frame === endFrame;

  // Permanent keyframes always have origin='permanent'
  if (isStartKeyframe || isEndKeyframe) {
    return 'permanent';
  }

  return requestedOrigin || 'user';
}

// ============================================================================
// REDUCER - Main state transition function
// ============================================================================

/**
 * Keyframe state reducer
 * All state transitions go through this function
 *
 * @param {Object} state - Current state
 * @param {Object} action - Action with type and payload
 * @returns {Object} New state
 */
export function keyframeReducer(state, action) {
  switch (action.type) {
    case ActionTypes.INITIALIZE: {
      const { defaultData, endFrame, framerate, startFrame = 0 } = action.payload;

      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: startFrame, origin: 'permanent', ...defaultData },
          { frame: endFrame, origin: 'permanent', ...defaultData }
        ],
        isEndKeyframeExplicit: false,
        endFrame,
        framerate: framerate || state.framerate
      };
    }

    case ActionTypes.RESET: {
      return createInitialState();
    }

    case ActionTypes.RESTORE_KEYFRAMES: {
      const { keyframes, endFrame, framerate } = action.payload;

      // Validate keyframes array (allow 1+ keyframes; ensurePermanentKeyframes adds boundaries)
      if (!keyframes || !Array.isArray(keyframes) || keyframes.length === 0) {
        console.warn('[keyframeController] Cannot restore - empty or invalid keyframes array');
        return state;
      }

      // Sort and ensure proper structure
      const sorted = sortKeyframes(keyframes.map(kf => ({
        ...kf,
        origin: kf.origin || 'user'
      })));

      // Enforce origin correctness: only first and last keyframes can be 'permanent'.
      // Middle keyframes that were incorrectly saved as 'permanent' get corrected to 'user'.
      const sortedKeyframes = sorted.map((kf, i) => {
        const isBoundary = i === 0 || i === sorted.length - 1;
        if (!isBoundary && kf.origin === 'permanent') {
          return { ...kf, origin: 'user' };
        }
        return kf;
      });

      // Enforce permanent keyframe invariant at boundaries
      // Use nullish coalescing — endFrame=0 is a valid value (|| treats 0 as falsy)
      const resolvedEndFrame = (endFrame != null && endFrame > 0) ? endFrame : sortedKeyframes[sortedKeyframes.length - 1].frame;
      const guardedKeyframes = ensurePermanentKeyframes(sortedKeyframes, resolvedEndFrame);

      // Determine if end keyframe was explicitly set (not same as start)
      const startKf = guardedKeyframes[0];
      const endKf = guardedKeyframes[guardedKeyframes.length - 1];
      const isEndExplicit = JSON.stringify({ x: startKf.x, y: startKf.y, width: startKf.width, height: startKf.height }) !==
                           JSON.stringify({ x: endKf.x, y: endKf.y, width: endKf.width, height: endKf.height });

      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED,
        keyframes: guardedKeyframes,
        isEndKeyframeExplicit: isEndExplicit,
        endFrame: resolvedEndFrame,
        framerate: framerate || state.framerate
      };
    }

    case ActionTypes.ADD_KEYFRAME:
    case ActionTypes.UPDATE_KEYFRAME: {
      const { frame, data, origin: requestedOrigin = 'user' } = action.payload;
      const { keyframes, endFrame, isEndKeyframeExplicit } = state;

      // Check if a keyframe exists within tolerance range (snap to existing)
      // This prevents accidentally creating new keyframes when user intends to edit existing ones
      const nearbyIndex = findKeyframeIndexNearFrame(keyframes, frame, FRAME_TOLERANCE);
      const targetFrame = nearbyIndex >= 0 ? keyframes[nearbyIndex].frame : frame;

      // Enforce minimum spacing: reject new keyframes too close to existing ones
      // (snapped updates are fine — this only blocks genuinely new keyframes)
      if (nearbyIndex < 0) {
        const tooClose = keyframes.some(kf => Math.abs(kf.frame - frame) < MIN_KEYFRAME_SPACING);
        if (tooClose) return state;
      }

      const isEndKeyframe = endFrame !== null && targetFrame === endFrame;
      const isStartKeyframe = targetFrame === 0;
      const actualOrigin = determineOrigin(targetFrame, endFrame, requestedOrigin);

      // Track if we're explicitly setting the end keyframe
      const newIsEndExplicit = isEndKeyframe ? true : isEndKeyframeExplicit;

      let updatedKeyframes;
      if (nearbyIndex >= 0) {
        // Update existing nearby keyframe - preserve origin if updating permanent keyframe
        const preservedOrigin = keyframes[nearbyIndex].origin === 'permanent' ? 'permanent' : actualOrigin;
        updatedKeyframes = [...keyframes];
        updatedKeyframes[nearbyIndex] = { ...data, frame: targetFrame, origin: preservedOrigin };
      } else {
        // Add new keyframe and sort (no nearby keyframe to snap to)
        updatedKeyframes = sortKeyframes([...keyframes, { ...data, frame: targetFrame, origin: actualOrigin }]);
      }

      // Mirror start to end if end hasn't been explicitly set
      if (isStartKeyframe && !isEndKeyframeExplicit && endFrame !== null) {
        const endKeyframeIndex = findKeyframeIndexAtFrame(updatedKeyframes, endFrame);
        if (endKeyframeIndex >= 0) {
          updatedKeyframes[endKeyframeIndex] = {
            ...data,
            frame: endFrame,
            origin: 'permanent'
          };
        }
      }

      return {
        ...state,
        machineState: KeyframeStates.EDITING,
        keyframes: updatedKeyframes,
        isEndKeyframeExplicit: newIsEndExplicit
      };
    }

    case ActionTypes.REMOVE_KEYFRAME: {
      const { frame } = action.payload;
      const { keyframes } = state;

      // Find the keyframe
      const keyframeToRemove = findKeyframeAtFrame(keyframes, frame);
      if (!keyframeToRemove) return state;

      // Don't allow removing boundary keyframes (frame 0 or endFrame)
      if (frame === 0 || (state.endFrame !== null && frame === state.endFrame)) {
        if (keyframeToRemove.origin !== 'permanent') {
          console.warn(`[keyframeController] Boundary keyframe at frame ${frame} has origin '${keyframeToRemove.origin}' instead of 'permanent' — blocked removal but origin should be fixed upstream`);
        }
        return state;
      }

      // Don't allow removing if it would leave less than 2 keyframes
      if (keyframes.length <= 2) return state;

      const filtered = keyframes.filter(kf => kf.frame !== frame);
      return {
        ...state,
        keyframes: ensurePermanentKeyframes(filtered, state.endFrame)
      };
    }

    case ActionTypes.DELETE_KEYFRAMES_IN_RANGE: {
      const { startFrame, endFrame: rangeEndFrame } = action.payload;
      const { keyframes } = state;

      // Filter keyframes: keep those OUTSIDE the range (exclusive on both ends)
      // Delete keyframes where: startFrame <= frame <= rangeEndFrame
      // This ensures both the start and end of the trimmed region are deleted
      // The caller is responsible for reconstituting permanent keyframes at new boundaries
      const filtered = keyframes.filter(kf => {
        return kf.frame < startFrame || kf.frame > rangeEndFrame;
      });

      return {
        ...state,
        machineState: KeyframeStates.TRIMMING,
        keyframes: filtered
      };
    }

    case ActionTypes.UPDATE_ALL_KEYFRAMES: {
      const { updateFn } = action.payload;
      const { keyframes } = state;

      const updated = keyframes.map(updateFn).filter(kf => kf !== null);

      return {
        ...state,
        keyframes: sortKeyframes(updated)
      };
    }

    case ActionTypes.START_TRIM: {
      return {
        ...state,
        machineState: KeyframeStates.TRIMMING
      };
    }

    case ActionTypes.END_TRIM: {
      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED
      };
    }

    case ActionTypes.CLEANUP_TRIM_KEYFRAMES: {
      const { keyframes } = state;
      const filtered = keyframes.filter(kf => kf.origin !== 'trim');

      return {
        ...state,
        keyframes: ensurePermanentKeyframes(filtered, state.endFrame),
        machineState: KeyframeStates.INITIALIZED
      };
    }

    case ActionTypes.COPY_KEYFRAME: {
      const { data } = action.payload;

      return {
        ...state,
        copiedData: data
      };
    }

    case ActionTypes.PASTE_KEYFRAME: {
      const { frame, copiedData } = state;

      if (!copiedData) return state;

      // Delegate to ADD_KEYFRAME
      return keyframeReducer(state, {
        type: ActionTypes.ADD_KEYFRAME,
        payload: { frame: action.payload.frame, data: copiedData, origin: 'user' }
      });
    }

    case ActionTypes.CLEAR_COPIED: {
      return {
        ...state,
        copiedData: null
      };
    }

    case ActionTypes.SET_END_EXPLICIT: {
      return {
        ...state,
        isEndKeyframeExplicit: action.payload.isExplicit
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// ACTION CREATORS - Helper functions to create actions
// ============================================================================

export const actions = {
  /**
   * Initialize keyframes with default data at start and end
   */
  initialize: (defaultData, endFrame, framerate) => ({
    type: ActionTypes.INITIALIZE,
    payload: { defaultData, endFrame, framerate }
  }),

  /**
   * Reset all state to initial
   */
  reset: () => ({
    type: ActionTypes.RESET
  }),

  /**
   * Restore keyframes from saved state (for clip switching)
   */
  restoreKeyframes: (keyframes, endFrame, framerate) => ({
    type: ActionTypes.RESTORE_KEYFRAMES,
    payload: { keyframes, endFrame, framerate }
  }),

  /**
   * Add or update a keyframe
   */
  addKeyframe: (frame, data, origin = 'user') => ({
    type: ActionTypes.ADD_KEYFRAME,
    payload: { frame, data, origin }
  }),

  /**
   * Remove a keyframe (non-permanent only)
   */
  removeKeyframe: (frame) => ({
    type: ActionTypes.REMOVE_KEYFRAME,
    payload: { frame }
  }),

  /**
   * Delete keyframes within a frame range
   */
  deleteKeyframesInRange: (startFrame, endFrame) => ({
    type: ActionTypes.DELETE_KEYFRAMES_IN_RANGE,
    payload: { startFrame, endFrame }
  }),

  /**
   * Update all keyframes with a mapping function
   */
  updateAllKeyframes: (updateFn) => ({
    type: ActionTypes.UPDATE_ALL_KEYFRAMES,
    payload: { updateFn }
  }),

  /**
   * Start trim operation
   */
  startTrim: () => ({
    type: ActionTypes.START_TRIM
  }),

  /**
   * End trim operation
   */
  endTrim: () => ({
    type: ActionTypes.END_TRIM
  }),

  /**
   * Cleanup trim-origin keyframes
   */
  cleanupTrimKeyframes: () => ({
    type: ActionTypes.CLEANUP_TRIM_KEYFRAMES
  }),

  /**
   * Copy keyframe data
   */
  copyKeyframe: (data) => ({
    type: ActionTypes.COPY_KEYFRAME,
    payload: { data }
  }),

  /**
   * Paste copied data at a frame
   */
  pasteKeyframe: (frame) => ({
    type: ActionTypes.PASTE_KEYFRAME,
    payload: { frame }
  }),

  /**
   * Clear copied data
   */
  clearCopied: () => ({
    type: ActionTypes.CLEAR_COPIED
  }),

  /**
   * Set whether end keyframe has been explicitly modified
   */
  setEndExplicit: (isExplicit) => ({
    type: ActionTypes.SET_END_EXPLICIT,
    payload: { isExplicit }
  })
};

// ============================================================================
// SELECTORS - Pure functions to derive data from state
// ============================================================================

export const selectors = {
  /**
   * Check if state needs initialization
   */
  needsInitialization: (state, expectedEndFrame) => {
    if (state.keyframes.length === 0) return true;
    const lastKeyframe = state.keyframes[state.keyframes.length - 1];
    return lastKeyframe.frame !== expectedEndFrame;
  },

  /**
   * Get keyframe at exact frame
   */
  getKeyframeAtFrame: (state, frame) => {
    return findKeyframeAtFrame(state.keyframes, frame);
  },

  /**
   * Check if keyframe exists at frame
   */
  hasKeyframeAtFrame: (state, frame) => {
    return hasKeyframeAtFrame(state.keyframes, frame);
  },

  /**
   * Get keyframe index at frame
   */
  getKeyframeIndexAtFrame: (state, frame) => {
    return findKeyframeIndexAtFrame(state.keyframes, frame);
  },

  /**
   * Check if state is initialized
   */
  isInitialized: (state) => {
    return state.machineState !== KeyframeStates.UNINITIALIZED;
  },

  /**
   * Check if currently trimming
   */
  isTrimming: (state) => {
    return state.machineState === KeyframeStates.TRIMMING;
  },

  /**
   * Get all keyframes
   */
  getKeyframes: (state) => state.keyframes,

  /**
   * Get copied data
   */
  getCopiedData: (state) => state.copiedData,

  /**
   * Check if end keyframe was explicitly set
   */
  isEndExplicit: (state) => state.isEndKeyframeExplicit
};
