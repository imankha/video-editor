import { describe, it, expect } from 'vitest';
import {
  keyframeReducer,
  createInitialState,
  actions,
  selectors,
  validateInvariants,
  KeyframeStates,
  ActionTypes
} from './keyframeController';

describe('keyframeController', () => {
  // ============================================================================
  // INITIAL STATE
  // ============================================================================

  describe('createInitialState', () => {
    it('creates uninitialized state with empty keyframes', () => {
      const state = createInitialState();
      expect(state.machineState).toBe(KeyframeStates.UNINITIALIZED);
      expect(state.keyframes).toEqual([]);
      expect(state.isEndKeyframeExplicit).toBe(false);
      expect(state.copiedData).toBeNull();
      expect(state.endFrame).toBeNull();
      expect(state.framerate).toBe(30);
    });
  });

  // ============================================================================
  // INVARIANT VALIDATION
  // ============================================================================

  describe('validateInvariants', () => {
    it('returns no violations for valid initialized state', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };
      expect(validateInvariants(state)).toEqual([]);
    });

    it('detects missing origin', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, x: 100 }, // Missing origin
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };
      const violations = validateInvariants(state);
      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('missing origin');
    });

    it('detects missing frame number', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { origin: 'permanent', x: 100 }, // Missing frame
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };
      const violations = validateInvariants(state);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('missing frame');
    });

    it('detects unsorted keyframes', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 90, origin: 'permanent', x: 200 },
          { frame: 0, origin: 'permanent', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };
      const violations = validateInvariants(state);
      expect(violations.some(v => v.includes('not sorted'))).toBe(true);
    });

    it('detects insufficient keyframes for initialized state', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };
      const violations = validateInvariants(state);
      expect(violations.some(v => v.includes('at least 2 keyframes'))).toBe(true);
    });

    it('allows empty keyframes for uninitialized state', () => {
      const state = createInitialState();
      expect(validateInvariants(state)).toEqual([]);
    });
  });

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('INITIALIZE action', () => {
    it('initializes with default keyframes at frame 0 and end frame', () => {
      const state = createInitialState();
      const defaultData = { x: 100, y: 100, width: 200, height: 300 };

      const newState = keyframeReducer(state, actions.initialize(defaultData, 90, 30));

      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes[0]).toEqual({
        frame: 0,
        origin: 'permanent',
        ...defaultData
      });
      expect(newState.keyframes[1]).toEqual({
        frame: 90,
        origin: 'permanent',
        ...defaultData
      });
      expect(newState.endFrame).toBe(90);
      expect(newState.isEndKeyframeExplicit).toBe(false);
    });

    it('sets framerate from payload', () => {
      const state = createInitialState();
      const newState = keyframeReducer(state, actions.initialize({}, 90, 60));
      expect(newState.framerate).toBe(60);
    });
  });

  describe('RESET action', () => {
    it('resets to initial state', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: true,
        copiedData: { x: 100 },
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.reset());
      expect(newState).toEqual(createInitialState());
    });
  });

  // ============================================================================
  // KEYFRAME OPERATIONS
  // ============================================================================

  describe('ADD_KEYFRAME action', () => {
    it('adds keyframe at new position', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(30, { x: 150 }, 'user'));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1]).toEqual({ frame: 30, origin: 'user', x: 150 });
      expect(newState.machineState).toBe(KeyframeStates.EDITING);
    });

    it('updates existing keyframe', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(30, { x: 175 }, 'user'));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1]).toEqual({ frame: 30, origin: 'user', x: 175 });
    });

    it('preserves permanent origin when updating boundary keyframes', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(0, { x: 125 }, 'user'));

      expect(newState.keyframes[0].origin).toBe('permanent');
      expect(newState.keyframes[0].x).toBe(125);
    });

    it('mirrors start to end when end not explicit', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(0, { x: 150 }, 'user'));

      expect(newState.keyframes[0].x).toBe(150);
      expect(newState.keyframes[1].x).toBe(150);
      expect(newState.keyframes[1].origin).toBe('permanent');
    });

    it('does not mirror start to end when end is explicit', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: true,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(0, { x: 150 }, 'user'));

      expect(newState.keyframes[0].x).toBe(150);
      expect(newState.keyframes[1].x).toBe(200); // Unchanged
    });

    it('sets isEndKeyframeExplicit when updating end keyframe', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(90, { x: 200 }, 'user'));

      expect(newState.isEndKeyframeExplicit).toBe(true);
    });

    it('maintains sorted order when adding keyframe', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.addKeyframe(30, { x: 140 }, 'user'));

      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 30, 60, 90]);
    });
  });

  describe('REMOVE_KEYFRAME action', () => {
    it('removes non-permanent keyframe', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(30));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
    });

    it('rejects removal of permanent keyframe', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(0));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[0].frame).toBe(0);
    });

    it('rejects removal if would leave less than 2 keyframes', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(0));

      expect(newState.keyframes.length).toBe(2);
    });

    it('returns unchanged state if keyframe not found', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(45));

      expect(newState).toBe(state);
    });
  });

  // ============================================================================
  // TRIM OPERATIONS
  // ============================================================================

  describe('DELETE_KEYFRAMES_IN_RANGE action', () => {
    it('deletes keyframes in trim range', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(25, 65));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 90]);
      expect(newState.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('preserves keyframes at start boundary', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      // Start boundary at 30, should preserve frame 30
      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(30, 65));

      expect(newState.keyframes.find(kf => kf.frame === 30)).toBeDefined();
    });

    it('deletes keyframes at end boundary (old end being removed)', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      // End boundary at 60, should delete frame 60
      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(25, 60));

      expect(newState.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
    });
  });

  describe('CLEANUP_TRIM_KEYFRAMES action', () => {
    it('removes all keyframes with origin=trim', () => {
      const state = {
        machineState: KeyframeStates.TRIMMING,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 25, origin: 'trim', x: 140 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 65, origin: 'trim', x: 185 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.cleanupTrimKeyframes());

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes.every(kf => kf.origin !== 'trim')).toBe(true);
      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
    });
  });

  describe('START_TRIM and END_TRIM actions', () => {
    it('START_TRIM transitions to TRIMMING state', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: null,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.startTrim());
      expect(newState.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('END_TRIM transitions to INITIALIZED state', () => {
      const state = {
        machineState: KeyframeStates.TRIMMING,
        keyframes: [],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: null,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.endTrim());
      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
    });
  });

  // ============================================================================
  // UPDATE ALL KEYFRAMES
  // ============================================================================

  describe('UPDATE_ALL_KEYFRAMES action', () => {
    it('applies update function to all keyframes', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100, y: 100 },
          { frame: 90, origin: 'permanent', x: 200, y: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const updateFn = (kf) => ({ ...kf, x: kf.x + 50 });
      const newState = keyframeReducer(state, actions.updateAllKeyframes(updateFn));

      expect(newState.keyframes[0].x).toBe(150);
      expect(newState.keyframes[1].x).toBe(250);
    });

    it('filters out null results from update function', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      // Remove keyframes with origin='user' by returning null
      const updateFn = (kf) => kf.origin === 'user' ? null : kf;
      const newState = keyframeReducer(state, actions.updateAllKeyframes(updateFn));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.every(kf => kf.origin === 'permanent')).toBe(true);
    });
  });

  // ============================================================================
  // COPY/PASTE
  // ============================================================================

  describe('COPY_KEYFRAME action', () => {
    it('stores copied data', () => {
      const state = createInitialState();
      const data = { x: 100, y: 150, width: 200, height: 300 };

      const newState = keyframeReducer(state, actions.copyKeyframe(data));

      expect(newState.copiedData).toEqual(data);
    });
  });

  describe('PASTE_KEYFRAME action', () => {
    it('creates keyframe from copied data', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: { x: 150, y: 175 },
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.pasteKeyframe(45));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1]).toEqual({ frame: 45, origin: 'user', x: 150, y: 175 });
    });

    it('returns unchanged state if no copied data', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'permanent', x: 100 },
          { frame: 90, origin: 'permanent', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null,
        endFrame: 90,
        framerate: 30
      };

      const newState = keyframeReducer(state, actions.pasteKeyframe(45));

      expect(newState).toBe(state);
    });
  });

  describe('CLEAR_COPIED action', () => {
    it('clears copied data', () => {
      const state = {
        ...createInitialState(),
        copiedData: { x: 100 }
      };

      const newState = keyframeReducer(state, actions.clearCopied());

      expect(newState.copiedData).toBeNull();
    });
  });

  // ============================================================================
  // SET_END_EXPLICIT
  // ============================================================================

  describe('SET_END_EXPLICIT action', () => {
    it('sets isEndKeyframeExplicit to true', () => {
      const state = {
        ...createInitialState(),
        isEndKeyframeExplicit: false
      };

      const newState = keyframeReducer(state, actions.setEndExplicit(true));

      expect(newState.isEndKeyframeExplicit).toBe(true);
    });

    it('sets isEndKeyframeExplicit to false', () => {
      const state = {
        ...createInitialState(),
        isEndKeyframeExplicit: true
      };

      const newState = keyframeReducer(state, actions.setEndExplicit(false));

      expect(newState.isEndKeyframeExplicit).toBe(false);
    });
  });

  // ============================================================================
  // SELECTORS
  // ============================================================================

  describe('selectors', () => {
    const sampleState = {
      machineState: KeyframeStates.INITIALIZED,
      keyframes: [
        { frame: 0, origin: 'permanent', x: 100 },
        { frame: 30, origin: 'user', x: 150 },
        { frame: 90, origin: 'permanent', x: 200 }
      ],
      isEndKeyframeExplicit: true,
      copiedData: { x: 175 },
      endFrame: 90,
      framerate: 30
    };

    describe('needsInitialization', () => {
      it('returns true for empty keyframes', () => {
        const state = createInitialState();
        expect(selectors.needsInitialization(state, 90)).toBe(true);
      });

      it('returns true when end frame mismatches', () => {
        expect(selectors.needsInitialization(sampleState, 120)).toBe(true);
      });

      it('returns false when end frame matches', () => {
        expect(selectors.needsInitialization(sampleState, 90)).toBe(false);
      });
    });

    describe('getKeyframeAtFrame', () => {
      it('returns keyframe at exact frame', () => {
        const kf = selectors.getKeyframeAtFrame(sampleState, 30);
        expect(kf).toEqual({ frame: 30, origin: 'user', x: 150 });
      });

      it('returns undefined for non-existent frame', () => {
        expect(selectors.getKeyframeAtFrame(sampleState, 45)).toBeUndefined();
      });
    });

    describe('hasKeyframeAtFrame', () => {
      it('returns true for existing frame', () => {
        expect(selectors.hasKeyframeAtFrame(sampleState, 0)).toBe(true);
      });

      it('returns false for non-existing frame', () => {
        expect(selectors.hasKeyframeAtFrame(sampleState, 45)).toBe(false);
      });
    });

    describe('isInitialized', () => {
      it('returns true for initialized state', () => {
        expect(selectors.isInitialized(sampleState)).toBe(true);
      });

      it('returns false for uninitialized state', () => {
        expect(selectors.isInitialized(createInitialState())).toBe(false);
      });
    });

    describe('isTrimming', () => {
      it('returns true when trimming', () => {
        const state = { ...sampleState, machineState: KeyframeStates.TRIMMING };
        expect(selectors.isTrimming(state)).toBe(true);
      });

      it('returns false when not trimming', () => {
        expect(selectors.isTrimming(sampleState)).toBe(false);
      });
    });

    describe('getKeyframes', () => {
      it('returns keyframes array', () => {
        expect(selectors.getKeyframes(sampleState)).toBe(sampleState.keyframes);
      });
    });

    describe('getCopiedData', () => {
      it('returns copied data', () => {
        expect(selectors.getCopiedData(sampleState)).toEqual({ x: 175 });
      });
    });

    describe('isEndExplicit', () => {
      it('returns isEndKeyframeExplicit value', () => {
        expect(selectors.isEndExplicit(sampleState)).toBe(true);
      });
    });
  });

  // ============================================================================
  // UNKNOWN ACTION
  // ============================================================================

  describe('unknown action', () => {
    it('returns unchanged state', () => {
      const state = createInitialState();
      const newState = keyframeReducer(state, { type: 'UNKNOWN_ACTION' });
      expect(newState).toBe(state);
    });
  });
});
