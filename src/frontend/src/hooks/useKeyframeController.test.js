import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useKeyframeController from './useKeyframeController';
import { KeyframeStates } from '../controllers/keyframeController';

describe('useKeyframeController hook', () => {
  // Mock interpolation function
  const mockInterpolateFn = vi.fn((keyframes, frame, time) => {
    if (keyframes.length === 0) return null;

    const before = keyframes.filter(kf => kf.frame <= frame).pop();
    const after = keyframes.find(kf => kf.frame > frame);

    if (!before) return keyframes[0];
    if (!after) return before;

    const t = (frame - before.frame) / (after.frame - before.frame);
    return {
      x: before.x + (after.x - before.x) * t,
      y: before.y + (after.y - before.y) * t,
      width: before.width,
      height: before.height
    };
  });

  beforeEach(() => {
    mockInterpolateFn.mockClear();
  });

  // ============================================================================
  // INITIALIZATION - from Architecture Plan Test Scenarios
  // ============================================================================

  describe('initialization', () => {
    it('starts with uninitialized state', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      expect(result.current.machineState).toBe(KeyframeStates.UNINITIALIZED);
      expect(result.current.keyframes).toEqual([]);
    });

    it('initializes with ZERO keyframes (flat-list model)', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      expect(result.current.machineState).toBe(KeyframeStates.INITIALIZED);
      // Flat-list model: opening a clip seeds NO keyframe. The editor shows a
      // computed default crop; the first keyframe appears only on a user edit.
      expect(result.current.keyframes).toEqual([]);
    });

    it('needsInitialization returns true for empty keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      expect(result.current.needsInitialization(90)).toBe(true);
    });

    it('needsInitialization returns false when last keyframe matches expected end', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      // Flat-list init seeds NO keyframes, so add one at frame 0 to make the
      // last keyframe frame 0. needsInitialization compares the last keyframe to
      // the expected end frame — so it's "already initialized" only when they
      // match (0 here).
      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
      });

      expect(result.current.needsInitialization(0)).toBe(false);
    });

    it('handles stale keyframes (end frame mismatch)', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
      });

      // Last keyframe is at frame 0; an expected end of 120 mismatches -> needs init.
      expect(result.current.needsInitialization(120)).toBe(true);
    });

    it('reset returns to uninitialized state', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.machineState).toBe(KeyframeStates.INITIALIZED);

      act(() => {
        result.current.reset();
      });

      expect(result.current.machineState).toBe(KeyframeStates.UNINITIALIZED);
      expect(result.current.keyframes).toEqual([]);
    });
  });

  // ============================================================================
  // KEYFRAME OPERATIONS - from Architecture Plan Test Scenarios
  // ============================================================================

  describe('keyframe operations', () => {
    it('adds keyframe at new position', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      // Init created 0 keyframes; adding at frame 30 -> the first keyframe.
      expect(result.current.keyframes.length).toBe(1);
      expect(result.current.keyframes[0]).toEqual({
        frame: 30,
        origin: 'user',
        x: 150,
        y: 150
      });
      expect(result.current.machineState).toBe(KeyframeStates.EDITING);
    });

    it('updates existing keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 175, y: 175 }, 90, 'user');
      });

      // First add creates frame 30, then a snap-update keeps the count at 1.
      expect(result.current.keyframes.length).toBe(1);
      expect(result.current.keyframes[0].x).toBe(175);
    });

    it('removes an added keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(1);

      act(() => {
        result.current.removeKeyframe(1.0);
      });

      expect(result.current.keyframes.length).toBe(0);
    });

    it('removes the frame-0 keyframe (no boundary protection)', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Explicitly create a frame-0 keyframe (init no longer seeds one).
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(2);

      act(() => {
        result.current.removeKeyframe(0); // Remove the start keyframe
      });

      // Flat-list model: the first keyframe is removable, leaving only frame 30.
      expect(result.current.keyframes.length).toBe(1);
      expect(result.current.keyframes[0].frame).toBe(30);
    });

    it('does NOT mirror an edit at the start to any other keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Add an end keyframe at frame 90.
      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 100, y: 100 }, 90, 'user');
      });

      // Update the start keyframe.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.keyframes[0].x).toBe(200);
      expect(result.current.keyframes[1].x).toBe(100); // Untouched (no mirroring)
    });

    it('maintains sorted order when adding keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90, 'user'); // frame 90
      });

      act(() => {
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user'); // frame 60
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user'); // frame 30
      });

      const frames = result.current.keyframes.map(kf => kf.frame);
      // Init seeds no keyframes; the three adds sort to 30, 60, 90.
      expect(frames).toEqual([30, 60, 90]);
    });
  });

  // ============================================================================
  // TRIM OPERATIONS - from Architecture Plan Test Scenarios
  // ============================================================================

  describe('trim operations', () => {
    it('deletes keyframes in trim range', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user'); // frame 60
      });

      // Init seeds no keyframes; 2 added = 2 keyframes.
      expect(result.current.keyframes.length).toBe(2);

      act(() => {
        result.current.deleteKeyframesInRange(0.8, 2.2); // frames [24, 66]
      });

      // Frames 30 and 60 deleted; no keyframes remain.
      expect(result.current.keyframes.map(kf => kf.frame)).toEqual([]);
      expect(result.current.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('deletes all keyframes in range inclusive of boundaries', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user'); // frame 60
      });

      act(() => {
        // Delete range [30, 75] (1.0s to 2.5s at 30fps)
        result.current.deleteKeyframesInRange(1.0, 2.5);
      });

      // Both keyframes (frames 30 and 60) fall in the range and are deleted
      // inclusive of boundaries; init seeded none, so the list is empty.
      expect(result.current.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
      expect(result.current.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
      expect(result.current.keyframes).toEqual([]);
    });

    it('deletes the last keyframe when it falls in the range', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user'); // frame 60
      });

      act(() => {
        result.current.deleteKeyframesInRange(0.5, 2.0); // frames [15, 60]
      });

      // Frame 60 (the last keyframe) is removable like any other.
      expect(result.current.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
      // Frames 30 and 60 both fall in [15, 60]; init seeded none, so empty.
      expect(result.current.keyframes.map(kf => kf.frame)).toEqual([]);
    });

    it('supports trim-origin keyframes at boundaries', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Add trim-origin keyframe (simulating what happens during trim)
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'trim');
      });

      // Init seeded no keyframes; this is the first (index 0).
      expect(result.current.keyframes[0].origin).toBe('trim');
    });

    it('cleans up trim keyframes when trim cleared', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0.5, { x: 120, y: 120 }, 90, 'trim'); // frame 15
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.5, { x: 190, y: 190 }, 90, 'trim'); // frame 75
      });

      // Init seeds no keyframes; 3 added = 3 keyframes.
      expect(result.current.keyframes.length).toBe(3);

      act(() => {
        result.current.cleanupTrimKeyframes();
      });

      // Both trim keyframes removed; only the user keyframe (frame 30) remains.
      expect(result.current.keyframes.map(kf => kf.frame)).toEqual([30]);
      expect(result.current.keyframes.every(kf => kf.origin !== 'trim')).toBe(true);
    });
  });

  // ============================================================================
  // SELECTION (DERIVED STATE) - from Architecture Plan Test Scenarios
  // ============================================================================

  describe('selection derived state', () => {
    it('getSelectedKeyframeIndex returns index when playhead is at keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Add a start keyframe (frame 0) and an end keyframe (frame 90, time 3.0).
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90, 'user');
      });

      // At frame 0 (time 0)
      expect(result.current.getSelectedKeyframeIndex(0)).toBe(0);

      // At frame 90 (time 3.0)
      expect(result.current.getSelectedKeyframeIndex(3.0)).toBe(1);
    });

    it('getSelectedKeyframeIndex returns -1 when no keyframe in tolerance', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // At time 1.5 (frame 45), no keyframe nearby
      expect(result.current.getSelectedKeyframeIndex(1.5)).toBe(-1);
    });

    it('getSelectedKeyframeIndex uses tolerance for nearby keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      // Init seeded no keyframes, so frame 30 is the only one (index 0).
      // Slightly before frame 30 (within 2 frame tolerance)
      const timeSlightlyBefore = (30 - 1) / 30; // frame 29
      expect(result.current.getSelectedKeyframeIndex(timeSlightlyBefore)).toBe(0);

      // Slightly after frame 30 (within 2 frame tolerance)
      const timeSlightlyAfter = (30 + 1) / 30; // frame 31
      expect(result.current.getSelectedKeyframeIndex(timeSlightlyAfter)).toBe(0);
    });

    it('selection updates when keyframes change', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Initially no keyframe at 1.0s
      expect(result.current.getSelectedKeyframeIndex(1.0)).toBe(-1);

      // Add keyframe at 1.0s
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      // Now there should be a keyframe (the first one, index 0).
      expect(result.current.getSelectedKeyframeIndex(1.0)).toBe(0);
    });
  });

  // ============================================================================
  // COPY/PASTE
  // ============================================================================

  describe('copy/paste operations', () => {
    it('copies keyframe data at exact frame', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Init seeds no keyframes; create the frame-0 keyframe to copy from.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90, 'user');
      });

      let success;
      act(() => {
        success = result.current.copyKeyframe(0, ['x', 'y', 'width', 'height']);
      });

      expect(success).toBe(true);
      expect(result.current.copiedData).toEqual({ x: 100, y: 100, width: 200, height: 300 });
    });

    it('copies interpolated data when no exact keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Init seeds no keyframes; create start (frame 0) and end (frame 90)
      // keyframes with different values so frame 45 interpolates between them.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90);
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200, width: 200, height: 300 }, 90);
      });

      let success;
      act(() => {
        // 1.5 seconds = frame 45, halfway between 0 and 90
        success = result.current.copyKeyframe(1.5, ['x', 'y']);
      });

      expect(success).toBe(true);
      expect(result.current.copiedData).toBeDefined();
      // Interpolated value should be between 100 and 200
      expect(result.current.copiedData.x).toBeGreaterThan(100);
      expect(result.current.copiedData.x).toBeLessThan(200);
    });

    it('pastes copied data at specified time', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Init seeds no keyframes; create the frame-0 keyframe to copy from.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
      });

      act(() => {
        result.current.copyKeyframe(0, ['x', 'y']);
      });

      let success;
      act(() => {
        success = result.current.pasteKeyframe(1.0, 90);
      });

      expect(success).toBe(true);
      // frame 0 (added) + paste at frame 30 = 2 keyframes.
      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[1]).toEqual({
        frame: 30,
        origin: 'user',
        x: 100,
        y: 100
      });
    });

    it('returns false when no copied data to paste', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      let success;
      act(() => {
        success = result.current.pasteKeyframe(1.0, 90);
      });

      expect(success).toBe(false);
      // Init seeds no keyframes and the paste was a no-op.
      expect(result.current.keyframes.length).toBe(0);
    });
  });

  // ============================================================================
  // INTERPOLATION
  // ============================================================================

  describe('interpolation', () => {
    it('interpolates values between keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90);
      });

      const interpolated = result.current.interpolate(1.5);

      expect(mockInterpolateFn).toHaveBeenCalled();
      expect(interpolated).toBeDefined();
    });

    it('returns null when no interpolation function provided', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          framerate: 30
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      const interpolated = result.current.interpolate(1.5);
      expect(interpolated).toBeNull();
    });
  });

  // ============================================================================
  // EXPORT FORMAT
  // ============================================================================

  describe('export format', () => {
    it('converts frame numbers to time for export', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Init seeds no keyframes; add frame 0 and frame 30 explicitly.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90);
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90);
      });

      const exported = result.current.getKeyframesForExport(['x', 'y', 'width', 'height']);

      expect(exported.length).toBe(2);
      expect(exported[0]).toEqual({ time: 0, x: 100, y: 100, width: 200, height: 300 });
      expect(exported[1]).toEqual({ time: 1, x: 150, y: 150, width: 200, height: 300 });
    });

    it('exports only specified data keys', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300, extra: 'ignored' }, 90);
      });

      // Init seeds no keyframes; create a frame-0 keyframe to export.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300, extra: 'ignored' }, 90, 'user');
      });

      const exported = result.current.getKeyframesForExport(['x', 'y']);

      expect(exported[0]).toEqual({ time: 0, x: 100, y: 100 });
      expect(exported[0].width).toBeUndefined();
      expect(exported[0].extra).toBeUndefined();
    });

    it('handles different framerates correctly', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 60, // 60fps
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 180); // seeds no keyframes
      });

      // Add a frame-0 keyframe and one at 3.0s (frame 180 at 60fps).
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 180, 'user');
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 180, 'user');
      });

      const exported = result.current.getKeyframesForExport(['x', 'y']);

      expect(exported[0].time).toBe(0);
      expect(exported[1].time).toBe(3); // 180 frames / 60fps = 3 seconds
    });
  });

  // ============================================================================
  // QUERIES
  // ============================================================================

  describe('query operations', () => {
    it('hasKeyframeAt returns true for existing keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Init seeds no keyframes; create one at frame 0.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
      });
      expect(result.current.hasKeyframeAt(0)).toBe(true);

      // Add one at frame 90 (time 3.0).
      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90, 'user');
      });
      expect(result.current.hasKeyframeAt(3.0)).toBe(true);
    });

    it('hasKeyframeAt returns false for non-existing keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.hasKeyframeAt(1.5)).toBe(false);
    });

    it('getKeyframeAt returns keyframe at exact time', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Init seeds no keyframes; create the frame-0 keyframe.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');
      });

      const kf = result.current.getKeyframeAt(0);
      expect(kf).toEqual({
        frame: 0,
        origin: 'user',
        x: 100,
        y: 100
      });
    });

    it('getKeyframeAt returns undefined for non-existing keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.getKeyframeAt(1.5)).toBeUndefined();
    });

    it('getDataAtTime returns interpolated data with specified keys', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // With zero keyframes, the hook-level interpolate returns null, so
      // getDataAtTime returns null (the default-crop fallback lives in useCrop).
      expect(result.current.getDataAtTime(0, ['x', 'width'])).toBeNull();

      // After creating a frame-0 keyframe, the data is interpolated from it.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90, 'user');
      });

      const data = result.current.getDataAtTime(0, ['x', 'width']);
      expect(data).toEqual({ x: 100, width: 200 });
    });
  });

  // ============================================================================
  // UPDATE ALL KEYFRAMES
  // ============================================================================

  describe('updateAllKeyframes', () => {
    it('applies update function to all keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Init seeds no keyframes; add two so the map covers more than one.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');   // frame 0
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90, 'user'); // frame 90
      });

      act(() => {
        result.current.updateAllKeyframes(kf => ({ ...kf, x: kf.x + 50 }));
      });

      expect(result.current.keyframes[0].x).toBe(150);
      expect(result.current.keyframes[1].x).toBe(250);
    });

    it('can filter out keyframes by returning null', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Init seeds no keyframes; add a user keyframe plus two trim keyframes.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100 }, 90, 'user');   // frame 0
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'trim'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'trim'); // frame 60
      });

      // 1 user keyframe + 2 trim keyframes.
      expect(result.current.keyframes.length).toBe(3);

      // Remove trim keyframes by returning null for them.
      act(() => {
        result.current.updateAllKeyframes(kf => kf.origin === 'trim' ? null : kf);
      });

      expect(result.current.keyframes.length).toBe(1);
      expect(result.current.keyframes.every(kf => kf.origin === 'user')).toBe(true);
    });
  });
});
