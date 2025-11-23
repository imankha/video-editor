import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useKeyframes from './useKeyframes';
import useKeyframeController from './useKeyframeController';

/**
 * Integration tests for keyframe management
 * Tests complex scenarios involving trim operations, selection, and export
 */

// Mock interpolation functions
const mockCropInterpolate = vi.fn((keyframes, frame, time) => {
  if (keyframes.length === 0) return null;
  const before = keyframes.filter(kf => kf.frame <= frame).pop();
  const after = keyframes.find(kf => kf.frame > frame);
  if (!before) return keyframes[0];
  if (!after) return before;
  const t = (frame - before.frame) / (after.frame - before.frame);
  return {
    x: Math.round(before.x + (after.x - before.x) * t),
    y: Math.round(before.y + (after.y - before.y) * t),
    width: before.width,
    height: before.height
  };
});

describe('Keyframe Integration Tests', () => {
  // ============================================================================
  // TRIM + KEYFRAME INTERACTION TESTS
  // ============================================================================

  describe('trim and keyframe interaction', () => {
    it('simulates full trim workflow: trim start of video', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      // Setup: Initialize with default keyframes and add some user keyframes
      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0.5, { x: 120, y: 120, width: 200, height: 300 }, 90, 'user');
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(5);

      // Simulate trim: remove first 1 second (frames 0-30)
      act(() => {
        result.current.deleteKeyframesInRange(0, 1.0);
      });

      // Keyframe at frame 0 should be preserved (at boundary)
      // Keyframes at frame 15 and 30 should be deleted
      const remainingFrames = result.current.keyframes.map(kf => kf.frame);
      expect(remainingFrames).toContain(0); // Preserved at boundary
      expect(remainingFrames).not.toContain(15); // Deleted
      expect(remainingFrames).toContain(60); // Outside range
      expect(remainingFrames).toContain(90); // Outside range
    });

    it('simulates full trim workflow: trim end of video', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      // Setup
      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.5, { x: 190, y: 190, width: 200, height: 300 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(5);

      // Simulate trim: remove last 1 second (frames 60-90)
      act(() => {
        result.current.deleteKeyframesInRange(2.0, 3.0);
      });

      // Keyframe at frame 60 should be preserved (at boundary)
      // Keyframes at frame 75 and 90 should be deleted
      const remainingFrames = result.current.keyframes.map(kf => kf.frame);
      expect(remainingFrames).toContain(0);
      expect(remainingFrames).toContain(30);
      expect(remainingFrames).toContain(60); // Preserved at boundary
      expect(remainingFrames).not.toContain(75); // Deleted
    });

    it('simulates trim with boundary keyframe creation', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      // Setup
      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Delete a middle section
      act(() => {
        result.current.deleteKeyframesInRange(1.0, 2.0);
      });

      // Now add a trim-origin keyframe at the new boundary
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 140, y: 140, width: 200, height: 300 }, 90, 'trim');
      });

      const trimKeyframe = result.current.keyframes.find(kf => kf.origin === 'trim');
      expect(trimKeyframe).toBeDefined();
      expect(trimKeyframe.frame).toBe(30);
    });

    it('preserves permanent keyframes origin after operations', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Update the start keyframe
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });

      // Origin should still be permanent
      expect(result.current.keyframes[0].origin).toBe('permanent');

      // Update the end keyframe
      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200, width: 200, height: 300 }, 90, 'user');
      });

      // Origin should still be permanent
      expect(result.current.keyframes[1].origin).toBe('permanent');
    });
  });

  // ============================================================================
  // DETRIM (UNDO TRIM) SCENARIOS
  // ============================================================================

  describe('detrim scenarios', () => {
    it('cleanup trim keyframes restores to clean state', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add mix of user and trim keyframes
      act(() => {
        result.current.addOrUpdateKeyframe(0.5, { x: 110, y: 110, width: 200, height: 300 }, 90, 'trim');
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'trim');
        result.current.addOrUpdateKeyframe(2.5, { x: 195, y: 195, width: 200, height: 300 }, 90, 'trim');
      });

      expect(result.current.keyframes.length).toBe(6);

      // Detrim: cleanup all trim keyframes
      act(() => {
        result.current.cleanupTrimKeyframes();
      });

      expect(result.current.keyframes.length).toBe(3);
      expect(result.current.keyframes.every(kf => kf.origin !== 'trim')).toBe(true);
      expect(result.current.keyframes.map(kf => kf.origin)).toEqual(['permanent', 'user', 'permanent']);
    });
  });

  // ============================================================================
  // MULTI-OPERATION SEQUENCES
  // ============================================================================

  describe('multi-operation sequences', () => {
    it('handles add -> update -> remove sequence', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes.length).toBe(3);

      // Update
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 175, y: 175, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes.length).toBe(3);
      expect(result.current.keyframes[1].x).toBe(175);

      // Remove
      act(() => {
        result.current.removeKeyframe(1.0, 90);
      });
      expect(result.current.keyframes.length).toBe(2);
    });

    it('handles copy from start -> paste at middle -> delete middle sequence', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Copy from start
      act(() => {
        result.current.copyKeyframe(0, ['x', 'y', 'width', 'height']);
      });

      // Paste at middle
      act(() => {
        result.current.pasteKeyframe(1.5, 90);
      });

      expect(result.current.keyframes.length).toBe(3);
      expect(result.current.keyframes[1].x).toBe(100); // Copied value

      // Delete middle
      act(() => {
        result.current.removeKeyframe(1.5, 90);
      });

      expect(result.current.keyframes.length).toBe(2);
    });

    it('handles multiple adds maintaining sort order', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add in non-sequential order
      act(() => {
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0.5, { x: 120, y: 120, width: 200, height: 300 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.5, { x: 160, y: 160, width: 200, height: 300 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 140, y: 140, width: 200, height: 300 }, 90, 'user');
      });

      const frames = result.current.keyframes.map(kf => kf.frame);
      expect(frames).toEqual([0, 15, 30, 45, 60, 90]);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles keyframe at exact frame boundaries', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add keyframe at exact 1-second boundary
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });

      const kf = result.current.keyframes.find(k => k.frame === 30);
      expect(kf).toBeDefined();
      expect(kf.x).toBe(150);
    });

    it('handles very close keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add keyframes 1 frame apart
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0 + 1 / 30, { x: 151, y: 151, width: 200, height: 300 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(4);
      const frames = result.current.keyframes.map(kf => kf.frame);
      expect(frames).toContain(30);
      expect(frames).toContain(31);
    });

    it('handles empty delete range', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      const keyframesBefore = result.current.keyframes.length;

      // Delete range with no keyframes
      act(() => {
        result.current.deleteKeyframesInRange(1.0, 2.0);
      });

      expect(result.current.keyframes.length).toBe(keyframesBefore);
    });

    it('preserves data integrity after multiple operations', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Perform many operations
      for (let i = 1; i <= 10; i++) {
        act(() => {
          const time = i * 0.2;
          result.current.addOrUpdateKeyframe(time, { x: 100 + i * 10, y: 100 + i * 10, width: 200, height: 300 }, 90, 'user');
        });
      }

      // Delete some
      act(() => {
        result.current.deleteKeyframesInRange(0.3, 0.7);
      });

      // All remaining keyframes should have valid data
      result.current.keyframes.forEach(kf => {
        expect(typeof kf.frame).toBe('number');
        expect(['permanent', 'user', 'trim']).toContain(kf.origin);
        expect(typeof kf.x).toBe('number');
        expect(typeof kf.y).toBe('number');
      });

      // Should still be sorted
      const frames = result.current.keyframes.map(kf => kf.frame);
      const sortedFrames = [...frames].sort((a, b) => a - b);
      expect(frames).toEqual(sortedFrames);
    });
  });

  // ============================================================================
  // COMPARISON: useKeyframes vs useKeyframeController
  // ============================================================================

  describe('useKeyframes and useKeyframeController parity', () => {
    it('both hooks produce same keyframes after initialization', () => {
      const { result: oldHook } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      const { result: newHook } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        oldHook.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        newHook.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(oldHook.current.keyframes).toEqual(newHook.current.keyframes);
    });

    it('both hooks produce same result after add operation', () => {
      const { result: oldHook } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      const { result: newHook } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        oldHook.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        newHook.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        oldHook.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        newHook.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      expect(oldHook.current.keyframes).toEqual(newHook.current.keyframes);
    });

    it('both hooks produce same export format', () => {
      const { result: oldHook } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      const { result: newHook } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        oldHook.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
        newHook.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      act(() => {
        oldHook.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
        newHook.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });

      const oldExport = oldHook.current.getKeyframesForExport(['x', 'y', 'width', 'height']);
      const newExport = newHook.current.getKeyframesForExport(['x', 'y', 'width', 'height']);

      expect(oldExport).toEqual(newExport);
    });
  });
});
