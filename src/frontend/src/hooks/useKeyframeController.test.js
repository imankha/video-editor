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

    it('initializes with default keyframes at frame 0 and end frame', () => {
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
      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[0]).toEqual({
        frame: 0,
        origin: 'permanent',
        x: 100,
        y: 100,
        width: 200,
        height: 300
      });
      expect(result.current.keyframes[1]).toEqual({
        frame: 90,
        origin: 'permanent',
        x: 100,
        y: 100,
        width: 200,
        height: 300
      });
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

    it('needsInitialization returns false when end frame matches', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockInterpolateFn,
          framerate: 30
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.needsInitialization(90)).toBe(false);
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

      // Video duration changed, end frame is now 120
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

      expect(result.current.keyframes.length).toBe(3);
      expect(result.current.keyframes[1]).toEqual({
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

      expect(result.current.keyframes.length).toBe(3);
      expect(result.current.keyframes[1].x).toBe(175);
    });

    it('removes non-permanent keyframe', () => {
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

      expect(result.current.keyframes.length).toBe(3);

      act(() => {
        result.current.removeKeyframe(1.0);
      });

      expect(result.current.keyframes.length).toBe(2);
    });

    it('rejects removal of permanent keyframe', () => {
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
        result.current.removeKeyframe(0); // Try to remove start keyframe
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[0].frame).toBe(0);
    });

    it('mirrors start to end when end not explicit', () => {
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

      expect(result.current.isEndKeyframeExplicit).toBe(false);

      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.keyframes[0].x).toBe(200);
      expect(result.current.keyframes[1].x).toBe(200); // Mirrored
    });

    it('does not mirror when end keyframe is explicit', () => {
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

      // Explicitly set end keyframe
      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 300, y: 300 }, 90, 'user');
      });

      expect(result.current.isEndKeyframeExplicit).toBe(true);

      // Now update start
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.keyframes[0].x).toBe(200);
      expect(result.current.keyframes[1].x).toBe(300); // Not mirrored
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
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      const frames = result.current.keyframes.map(kf => kf.frame);
      expect(frames).toEqual([0, 30, 60, 90]);
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
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(4);

      act(() => {
        result.current.deleteKeyframesInRange(0.8, 2.2);
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.machineState).toBe(KeyframeStates.TRIMMING);
    });

    it('preserves keyframes at start boundary', () => {
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
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      act(() => {
        // Start boundary exactly at frame 30 (1.0s)
        result.current.deleteKeyframesInRange(1.0, 2.5);
      });

      // Frame 30 should be preserved (at boundary)
      expect(result.current.keyframes.find(kf => kf.frame === 30)).toBeDefined();
    });

    it('deletes keyframes at end boundary (old end being removed)', () => {
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
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      act(() => {
        // End boundary at frame 60 (2.0s)
        result.current.deleteKeyframesInRange(0.5, 2.0);
      });

      // Frame 60 should be deleted (at end boundary)
      expect(result.current.keyframes.find(kf => kf.frame === 60)).toBeUndefined();
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

      expect(result.current.keyframes[1].origin).toBe('trim');
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
        result.current.addOrUpdateKeyframe(0.5, { x: 120, y: 120 }, 90, 'trim');
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.5, { x: 190, y: 190 }, 90, 'trim');
      });

      expect(result.current.keyframes.length).toBe(5);

      act(() => {
        result.current.cleanupTrimKeyframes();
      });

      expect(result.current.keyframes.length).toBe(3);
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

      // Slightly before frame 30 (within 2 frame tolerance)
      const timeSlightlyBefore = (30 - 1) / 30; // frame 29
      expect(result.current.getSelectedKeyframeIndex(timeSlightlyBefore)).toBe(1);

      // Slightly after frame 30 (within 2 frame tolerance)
      const timeSlightlyAfter = (30 + 1) / 30; // frame 31
      expect(result.current.getSelectedKeyframeIndex(timeSlightlyAfter)).toBe(1);
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

      // Now there should be a keyframe
      expect(result.current.getSelectedKeyframeIndex(1.0)).toBe(1);
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

      // Update end keyframe to different values
      act(() => {
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

      act(() => {
        result.current.copyKeyframe(0, ['x', 'y']);
      });

      let success;
      act(() => {
        success = result.current.pasteKeyframe(1.0, 90);
      });

      expect(success).toBe(true);
      expect(result.current.keyframes.length).toBe(3);
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
      expect(result.current.keyframes.length).toBe(2);
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

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90);
      });

      const exported = result.current.getKeyframesForExport(['x', 'y', 'width', 'height']);

      expect(exported.length).toBe(3);
      expect(exported[0]).toEqual({ time: 0, x: 100, y: 100, width: 200, height: 300 });
      expect(exported[1]).toEqual({ time: 1, x: 150, y: 150, width: 200, height: 300 });
      expect(exported[2]).toEqual({ time: 3, x: 100, y: 100, width: 200, height: 300 }); // 90/30 = 3s
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
        result.current.initializeKeyframes({ x: 100, y: 100 }, 180); // 180 frames at 60fps = 3s
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

      expect(result.current.hasKeyframeAt(0)).toBe(true);
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

      const kf = result.current.getKeyframeAt(0);
      expect(kf).toEqual({
        frame: 0,
        origin: 'permanent',
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

      act(() => {
        result.current.updateAllKeyframes(kf => ({ ...kf, x: kf.x + 50 }));
      });

      expect(result.current.keyframes[0].x).toBe(150);
      expect(result.current.keyframes[1].x).toBe(150);
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

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(4);

      // Remove user keyframes
      act(() => {
        result.current.updateAllKeyframes(kf => kf.origin === 'user' ? null : kf);
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes.every(kf => kf.origin === 'permanent')).toBe(true);
    });
  });
});
