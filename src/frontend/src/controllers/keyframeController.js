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
  FRAME_TOLERANCE
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

      // Validate keyframes array
      if (!keyframes || !Array.isArray(keyframes) || keyframes.length < 2) {
        console.warn('[keyframeController] Cannot restore - invalid keyframes array');
        return state;
      }

      // Sort and ensure proper structure
      const sortedKeyframes = sortKeyframes(keyframes.map(kf => ({
        ...kf,
        origin: kf.origin || 'user'
      })));

      // Determine if end keyframe was explicitly set (not same as start)
      const startKf = sortedKeyframes[0];
      const endKf = sortedKeyframes[sortedKeyframes.length - 1];
      const isEndExplicit = JSON.stringify({ x: startKf.x, y: startKf.y, width: startKf.width, height: startKf.height }) !==
                           JSON.stringify({ x: endKf.x, y: endKf.y, width: endKf.width, height: endKf.height });

      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED,
        keyframes: sortedKeyframes,
        isEndKeyframeExplicit: isEndExplicit,
        endFrame: endFrame || sortedKeyframes[sortedKeyframes.length - 1].frame,
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

      // Don't allow removing permanent keyframes
      if (keyframeToRemove.origin === 'permanent') return state;

      // Don't allow removing if it would leave less than 2 keyframes
      if (keyframes.length <= 2) return state;

      return {
        ...state,
        keyframes: keyframes.filter(kf => kf.frame !== frame)
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

      return {
        ...state,
        keyframes: keyframes.filter(kf => kf.origin !== 'trim'),
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
