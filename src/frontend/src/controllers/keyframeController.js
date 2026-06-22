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
  resolveTargetFrame,
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

  // End frame management
  SET_END_FRAME: 'SET_END_FRAME',

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
    copiedData: null
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

  // No duplicate frames
  const seenFrames = new Set();
  for (const kf of state.keyframes) {
    if (seenFrames.has(kf.frame)) {
      violations.push(`Duplicate keyframe at frame ${kf.frame}`);
      break;
    }
    seenFrames.add(kf.frame);
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

function getEndFrame(keyframes) {
  return keyframes.length > 0 ? keyframes[keyframes.length - 1].frame : null;
}

/**
 * Normalize a keyframe list: sort by frame.
 *
 * Keyframes are a flat list with NO forced boundary keyframes. Interpolation
 * clamps to the first/last keyframe, so a crop value is defined at every frame
 * without explicit start/end "permanent" keyframes. The `endFrame` argument is
 * accepted for call-site compatibility but ignored.
 */
function ensurePermanentKeyframes(keyframes, endFrame) { // eslint-disable-line no-unused-vars
  return sortKeyframes(keyframes);
}

function hasSameSpatialData(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Cosmetic dedupe: drop a keyframe sitting right next to the first/last that
 * carries identical spatial data, so two diamonds don't visually stack at an edge.
 */
function removeBoundaryDuplicates(keyframes) {
  if (keyframes.length <= 2) return keyframes;

  const startKf = keyframes[0];
  const endKf = keyframes[keyframes.length - 1];
  const threshold = MIN_KEYFRAME_SPACING * 3;

  return keyframes.filter(kf => {
    if (kf.frame > 0 && kf.frame < threshold && hasSameSpatialData(kf, startKf)) return false;
    if (kf.frame < endKf.frame && endKf.frame - kf.frame < threshold && hasSameSpatialData(kf, endKf)) return false;
    return true;
  });
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
      // Flat-list model: opening a clip does NOT seed any keyframe. The editor
      // shows the computed default crop (a keyframe-less reticule), and the FIRST
      // keyframe is created only when the user moves/resizes the crop box. This
      // marks the controller ready (INITIALIZED) with an empty keyframe list.
      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [],
        isEndKeyframeExplicit: false
      };
    }

    case ActionTypes.RESET: {
      return createInitialState();
    }

    case ActionTypes.RESTORE_KEYFRAMES: {
      const { keyframes } = action.payload;

      if (!keyframes || !Array.isArray(keyframes) || keyframes.length === 0) {
        console.warn('[keyframeController] Cannot restore - empty or invalid keyframes array');
        return state;
      }

      // Flat-list model: sort, normalize origin, and cosmetically dedupe edges.
      // No boundary scaffolding — keyframes are restored exactly as saved.
      const sorted = sortKeyframes(keyframes.map(kf => ({
        ...kf,
        origin: kf.origin === 'trim' ? 'trim' : 'user'
      })));

      const guardedKeyframes = removeBoundaryDuplicates(sorted);

      if (guardedKeyframes.length === 0) {
        console.warn('[keyframeController] Restore produced 0 keyframes — skipping, will auto-init');
        return state;
      }

      return {
        ...state,
        machineState: KeyframeStates.INITIALIZED,
        keyframes: guardedKeyframes,
        isEndKeyframeExplicit: false
      };
    }

    case ActionTypes.ADD_KEYFRAME:
    case ActionTypes.UPDATE_KEYFRAME: {
      const { frame, data, origin: requestedOrigin = 'user' } = action.payload;
      const { keyframes } = state;

      // Check if a keyframe exists within tolerance range (snap to existing)
      // This prevents accidentally creating new keyframes when user intends to edit existing ones
      const nearbyIndex = findKeyframeIndexNearFrame(keyframes, frame, FRAME_TOLERANCE);
      // Single source of truth for keyframe identity — persistence paths resolve
      // the same way so display/store/backend never disagree on the target frame.
      const targetFrame = resolveTargetFrame(keyframes, frame);

      // Enforce minimum spacing: reject new keyframes too close to existing ones
      // (snapped updates are fine — this only blocks genuinely new keyframes)
      if (nearbyIndex < 0) {
        const tooClose = keyframes.some(kf => Math.abs(kf.frame - frame) < MIN_KEYFRAME_SPACING);
        if (tooClose) return state;
      }

      const actualOrigin = requestedOrigin || 'user';

      let updatedKeyframes;
      if (nearbyIndex >= 0) {
        // Update existing nearby keyframe (snap-to-update)
        updatedKeyframes = [...keyframes];
        updatedKeyframes[nearbyIndex] = { ...data, frame: targetFrame, origin: actualOrigin };
      } else {
        // Add new keyframe and sort (no nearby keyframe to snap to)
        updatedKeyframes = sortKeyframes([...keyframes, { ...data, frame: targetFrame, origin: actualOrigin }]);
      }

      return {
        ...state,
        machineState: KeyframeStates.EDITING,
        keyframes: updatedKeyframes,
        isEndKeyframeExplicit: false
      };
    }

    case ActionTypes.REMOVE_KEYFRAME: {
      const { frame } = action.payload;
      const { keyframes } = state;

      // Flat-list model: any keyframe is removable. There are no protected
      // boundary keyframes — interpolation clamps to whatever remains (and the
      // editor falls back to a default crop when none remain).
      const keyframeToRemove = findKeyframeAtFrame(keyframes, frame);
      if (!keyframeToRemove) return state;

      const filtered = keyframes.filter(kf => kf.frame !== frame);
      return {
        ...state,
        keyframes: ensurePermanentKeyframes(filtered, getEndFrame(keyframes))
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
      const sorted = sortKeyframes(updated);
      const endFrame = getEndFrame(sorted);

      return {
        ...state,
        keyframes: endFrame !== null
          ? ensurePermanentKeyframes(sorted, endFrame)
          : sorted
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
        keyframes: ensurePermanentKeyframes(filtered, getEndFrame(keyframes)),
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

    case ActionTypes.SET_END_FRAME: {
      // Deprecated in the flat-list model: the end is no longer a managed boundary
      // (trim is virtual; interpolation clamps at the last keyframe). Kept as a
      // no-op so any stale callers don't mutate keyframes. Returns state unchanged.
      return state;
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
  initialize: (defaultData, endFrame) => ({
    type: ActionTypes.INITIALIZE,
    payload: { defaultData, endFrame }
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
  restoreKeyframes: (keyframes) => ({
    type: ActionTypes.RESTORE_KEYFRAMES,
    payload: { keyframes }
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
   * Update the endFrame (e.g., when detrim expands the range)
   */
  setEndFrame: (endFrame) => ({
    type: ActionTypes.SET_END_FRAME,
    payload: { endFrame }
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
   * Get the end frame (derived from last keyframe)
   */
  getEndFrame: (state) => getEndFrame(state.keyframes),

  /**
   * Check if end keyframe was explicitly set
   */
  isEndExplicit: (state) => state.isEndKeyframeExplicit
};
