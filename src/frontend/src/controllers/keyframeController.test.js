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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      expect(validateInvariants(state)).toEqual([]);
    });

    it('detects missing origin', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, x: 100 }, // Missing origin
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      const violations = validateInvariants(state);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations.some(v => v.includes('missing origin'))).toBe(true);
    });

    it('detects missing frame number', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { origin: 'user', x: 100 }, // Missing frame
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      const violations = validateInvariants(state);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('missing frame');
    });

    it('detects unsorted keyframes', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 90, origin: 'user', x: 200 },
          { frame: 0, origin: 'user', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      const violations = validateInvariants(state);
      expect(violations.some(v => v.includes('not sorted'))).toBe(true);
    });

    it('detects duplicate frames', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 30, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      const violations = validateInvariants(state);
      expect(violations.some(v => v.includes('Duplicate keyframe at frame 30'))).toBe(true);
    });

    it('flat-list model: a single keyframe is valid (no "at least 2" rule)', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };
      // The flat-list model removed the "at least 2 keyframes" invariant —
      // one keyframe fully defines the crop (interpolation clamps).
      expect(validateInvariants(state)).toEqual([]);
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
    it('initializes with exactly one keyframe at frame 0 (flat-list model)', () => {
      const state = createInitialState();
      const defaultData = { x: 100, y: 100, width: 200, height: 300 };

      const newState = keyframeReducer(state, actions.initialize(defaultData, 90, 30));

      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
      // Flat-list model: ONE keyframe at frame 0. No forced end boundary —
      // interpolation clamps to the last keyframe so the crop is defined everywhere.
      expect(newState.keyframes.length).toBe(1);
      expect(newState.keyframes[0]).toEqual({
        frame: 0,
        origin: 'user',
        ...defaultData
      });
      expect(newState.isEndKeyframeExplicit).toBe(false);
    });

    it('honors a non-zero startFrame for the single keyframe', () => {
      const state = createInitialState();
      const defaultData = { x: 10, y: 20, width: 100, height: 200 };

      const newState = keyframeReducer(state, {
        type: ActionTypes.INITIALIZE,
        payload: { defaultData, startFrame: 5 }
      });

      expect(newState.keyframes.length).toBe(1);
      expect(newState.keyframes[0]).toEqual({ frame: 5, origin: 'user', ...defaultData });
    });
  });

  describe('RESET action', () => {
    it('resets to initial state', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: true,
        copiedData: { x: 100 },
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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(30, { x: 175 }, 'user'));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1]).toEqual({ frame: 30, origin: 'user', x: 175 });
    });

    it('updating a keyframe applies the requested origin (no permanent promotion)', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(0, { x: 125 }, 'user'));

      // Snap-update of the frame-0 keyframe: data changes, origin is whatever was
      // requested ('user'). There is no 'permanent' origin in the flat-list model.
      expect(newState.keyframes[0].origin).toBe('user');
      expect(newState.keyframes[0].x).toBe(125);
      expect(newState.keyframes.length).toBe(2);
    });

    it('does NOT mirror an edit at the start to the end keyframe', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 100 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(0, { x: 150 }, 'user'));

      // Only the start keyframe changes — the flat-list model never mirrors
      // start->end, regardless of isEndKeyframeExplicit.
      expect(newState.keyframes[0].x).toBe(150);
      expect(newState.keyframes[1].x).toBe(100); // Untouched
    });

    it('add/update always resets isEndKeyframeExplicit to false', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 100 }
        ],
        isEndKeyframeExplicit: true,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(90, { x: 200 }, 'user'));

      // Editing the last keyframe is just a snap-update — there is no special
      // "end keyframe became explicit" tracking anymore.
      expect(newState.keyframes[1].x).toBe(200);
      expect(newState.isEndKeyframeExplicit).toBe(false);
    });

    it('preserves a requested non-user origin when adding', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(40, { x: 160 }, 'trim'));

      const added = newState.keyframes.find(kf => kf.frame === 40);
      expect(added.origin).toBe('trim');
    });

    it('maintains sorted order when adding keyframe', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.addKeyframe(30, { x: 140 }, 'user'));

      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 30, 60, 90]);
    });
  });

  describe('REMOVE_KEYFRAME action', () => {
    it('removes an interior keyframe', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(30));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
    });

    it('removes the first keyframe (no boundary protection in the flat-list model)', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(0));

      // Any keyframe is removable now — the first one is gone, the rest remain.
      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.find(kf => kf.frame === 0)).toBeUndefined();
      expect(newState.keyframes.map(kf => kf.frame)).toEqual([30, 90]);
    });

    it('removes the last keyframe', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(90));

      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 30]);
    });

    it('can remove down to a single keyframe', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.removeKeyframe(30));

      // No "at least 2 keyframes" floor — one keyframe is a valid result.
      expect(newState).not.toBe(state);
      expect(newState.keyframes).toEqual([{ frame: 0, origin: 'user', x: 100 }]);
    });

    it('returns the SAME state object if keyframe not found', () => {
      const state = {
        machineState: KeyframeStates.EDITING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(25, 65));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 90]);
      expect(newState.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('deletes all keyframes in range inclusive of boundaries', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Delete range includes both boundaries (caller reconstitutes as needed)
      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(30, 65));

      // Frame 30 is deleted (within range) - caller must reconstitute if needed
      expect(newState.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
      expect(newState.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
      // Frames outside range are kept
      expect(newState.keyframes.find(kf => kf.frame === 0)).toBeDefined();
      expect(newState.keyframes.find(kf => kf.frame === 90)).toBeDefined();
    });

    it('deletes keyframes at end of range', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 60, origin: 'user', x: 180 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Delete range 25-60, both 30 and 60 should be deleted
      const newState = keyframeReducer(state, actions.deleteKeyframesInRange(25, 60));

      expect(newState.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
      expect(newState.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
      // Frames outside range are kept
      expect(newState.keyframes.find(kf => kf.frame === 0)).toBeDefined();
      expect(newState.keyframes.find(kf => kf.frame === 90)).toBeDefined();
    });
  });

  describe('CLEANUP_TRIM_KEYFRAMES action', () => {
    it('removes all keyframes with origin=trim', () => {
      const state = {
        machineState: KeyframeStates.TRIMMING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 25, origin: 'trim', x: 140 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 65, origin: 'trim', x: 185 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
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
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.startTrim());
      expect(newState.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('END_TRIM transitions to INITIALIZED state', () => {
      const state = {
        machineState: KeyframeStates.TRIMMING,
        keyframes: [],
        isEndKeyframeExplicit: false,
        copiedData: null
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
          { frame: 0, origin: 'user', x: 100, y: 100 },
          { frame: 90, origin: 'user', x: 200, y: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'trim', x: 150 },
          { frame: 60, origin: 'trim', x: 180 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Remove keyframes with origin='trim' by returning null
      const updateFn = (kf) => kf.origin === 'trim' ? null : kf;
      const newState = keyframeReducer(state, actions.updateAllKeyframes(updateFn));

      expect(newState.keyframes.length).toBe(2);
      expect(newState.keyframes.every(kf => kf.origin === 'user')).toBe(true);
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
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: { x: 150, y: 175 },
      };

      const newState = keyframeReducer(state, actions.pasteKeyframe(45));

      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1]).toEqual({ frame: 45, origin: 'user', x: 150, y: 175 });
    });

    it('returns unchanged state if no copied data', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
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
        { frame: 0, origin: 'user', x: 100 },
        { frame: 30, origin: 'user', x: 150 },
        { frame: 90, origin: 'user', x: 200 }
      ],
      isEndKeyframeExplicit: true,
      copiedData: { x: 175 }
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
  // T340: KEYFRAME INTEGRITY GUARDS
  // ============================================================================

  describe('RESTORE_KEYFRAMES (flat-list model)', () => {
    it('restores keyframes exactly as saved, sorted, with no boundary scaffolding', () => {
      const state = createInitialState();
      // Saved keyframes that do NOT start at frame 0 — the flat-list model does
      // NOT reconstitute a frame-0 keyframe. They are restored as-is (sorted).
      // First keyframe is well clear of the edge-dedupe window (>= 30 frames).
      const saved = [
        { frame: 50, origin: 'user', x: 160, y: 5, width: 640, height: 360 },
        { frame: 35, origin: 'user', x: 120, y: 1, width: 640, height: 360 },
        { frame: 90, origin: 'user', x: 200, y: 9, width: 640, height: 360 }
      ];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
      expect(newState.keyframes.map(kf => kf.frame)).toEqual([35, 50, 90]);
      // No frame 0 was injected.
      expect(newState.keyframes.find(kf => kf.frame === 0)).toBeUndefined();
    });

    it('does NOT inject an end boundary — last keyframe is whatever was saved', () => {
      const state = createInitialState();
      const saved = [
        { frame: 0, origin: 'user', x: 100 },
        { frame: 60, origin: 'user', x: 180 }
      ];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      const last = newState.keyframes[newState.keyframes.length - 1];
      expect(last.frame).toBe(60);
      expect(last.origin).toBe('user');
      expect(newState.keyframes.length).toBe(2);
    });

    it('normalizes a legacy "permanent" origin to "user" but keeps "trim"', () => {
      const state = createInitialState();
      // Legacy data on disk may still carry origin: 'permanent'.
      const saved = [
        { frame: 0, origin: 'permanent', x: 100 },
        { frame: 45, origin: 'trim', x: 150 },
        { frame: 90, origin: 'permanent', x: 200 }
      ];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      expect(newState.keyframes[0].origin).toBe('user');
      expect(newState.keyframes[1].origin).toBe('trim');
      expect(newState.keyframes[2].origin).toBe('user');
    });

    it('cosmetically dedupes an edge keyframe with identical spatial data', () => {
      const state = createInitialState();
      // Frame 5 sits right next to frame 0 with identical spatial data, so the
      // cosmetic removeBoundaryDuplicates drops it (so two diamonds don't stack).
      const saved = [
        { frame: 0, origin: 'user', x: 100, y: 0, width: 640, height: 360 },
        { frame: 5, origin: 'user', x: 100, y: 0, width: 640, height: 360 },
        { frame: 90, origin: 'user', x: 200, y: 0, width: 640, height: 360 }
      ];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 90]);
    });

    it('returns the SAME state for an empty/invalid keyframes array', () => {
      const state = createInitialState();
      expect(keyframeReducer(state, actions.restoreKeyframes([]))).toBe(state);
      expect(keyframeReducer(state, actions.restoreKeyframes(null))).toBe(state);
    });
  });

  describe('CLEANUP_TRIM_KEYFRAMES (flat-list model)', () => {
    it('removes trim-origin keyframes and keeps the rest', () => {
      const state = {
        machineState: KeyframeStates.TRIMMING,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 25, origin: 'trim', x: 140 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      const newState = keyframeReducer(state, actions.cleanupTrimKeyframes());

      expect(newState.keyframes.map(kf => kf.frame)).toEqual([0, 90]);
      expect(newState.keyframes.every(kf => kf.origin !== 'trim')).toBe(true);
      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
    });
  });

  describe('minimum keyframe spacing', () => {
    it('rejects new keyframe within MIN_KEYFRAME_SPACING of existing', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Try to add at frame 33 (3 frames from 30, less than MIN_KEYFRAME_SPACING=5)
      // BUT within FRAME_TOLERANCE=5, so it snaps to frame 30 (update, not reject)
      const newState = keyframeReducer(state, actions.addKeyframe(33, { x: 155 }, 'user'));
      expect(newState.keyframes.length).toBe(3);
      expect(newState.keyframes[1].frame).toBe(30);
      expect(newState.keyframes[1].x).toBe(155);
    });

    it('allows keyframe at sufficient distance', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Frame 50 is well away from 30 and 90
      const newState = keyframeReducer(state, actions.addKeyframe(50, { x: 170 }, 'user'));
      expect(newState.keyframes.length).toBe(4);
      expect(newState.keyframes[2].frame).toBe(50);
    });

    it('rejects new keyframe just outside tolerance but within spacing', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 30, origin: 'user', x: 150 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // Frame 86 is 4 frames from 90 — within MIN_KEYFRAME_SPACING but also within FRAME_TOLERANCE
      // So it snaps to 90 (update). This tests the edge case.
      const newState = keyframeReducer(state, actions.addKeyframe(86, { x: 195 }, 'user'));
      // Should snap to frame 90 and update it
      expect(newState.keyframes[newState.keyframes.length - 1].frame).toBe(90);
    });
  });

  // ============================================================================
  // T2710: DEGENERATE DATA GUARDS
  // ============================================================================

  describe('single-keyframe restore (flat-list model)', () => {
    it('RESTORE_KEYFRAMES accepts a single keyframe and leaves it as the only one', () => {
      const state = createInitialState();
      const saved = [{ frame: 0, origin: 'user', x: 100, y: 0, width: 1920, height: 1080 }];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
      expect(newState.keyframes.length).toBe(1);
      expect(newState.keyframes[0].frame).toBe(0);
      expect(newState.keyframes[0].origin).toBe('user');
      expect(newState.isEndKeyframeExplicit).toBe(false);
    });

    it('RESTORE_KEYFRAMES with single keyframe at non-zero frame keeps it as-is', () => {
      const state = createInitialState();
      const saved = [{ frame: 50, origin: 'user', x: 100, y: 0, width: 1920, height: 1080 }];

      const newState = keyframeReducer(state, actions.restoreKeyframes(saved));

      expect(newState.machineState).toBe(KeyframeStates.INITIALIZED);
      // No frame-0 keyframe injected, no end boundary added.
      expect(newState.keyframes.length).toBe(1);
      expect(newState.keyframes[0].frame).toBe(50);
      expect(newState.keyframes[0].origin).toBe('user');
    });
  });

  // ============================================================================
  // SET_END_FRAME is a no-op in the flat-list model
  // ============================================================================

  describe('SET_END_FRAME (deprecated no-op)', () => {
    it('returns the SAME state object unchanged', () => {
      const state = {
        machineState: KeyframeStates.INITIALIZED,
        keyframes: [
          { frame: 0, origin: 'user', x: 100 },
          { frame: 90, origin: 'user', x: 200 }
        ],
        isEndKeyframeExplicit: false,
        copiedData: null
      };

      // The end is no longer a managed boundary (trim is virtual; interpolation
      // clamps at the last keyframe). SET_END_FRAME must not mutate anything.
      expect(keyframeReducer(state, actions.setEndFrame(300))).toBe(state);
      expect(keyframeReducer(state, actions.setEndFrame(0))).toBe(state);
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
