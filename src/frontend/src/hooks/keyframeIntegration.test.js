import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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
        useKeyframeController({
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
        result.current.addOrUpdateKeyframe(0.5, { x: 120, y: 120, width: 200, height: 300 }, 90, 'user'); // frame 15
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'user'); // frame 60
      });

      // Flat-list init seeds no keyframes; 3 added = 3 keyframes (15, 30, 60).
      expect(result.current.keyframes.length).toBe(3);

      // Simulate trim: remove first 1 second (frames 0-30)
      act(() => {
        result.current.deleteKeyframesInRange(0, 1.0);
      });

      // All keyframes in range [0, 30] are deleted (inclusive)
      const remainingFrames = result.current.keyframes.map(kf => kf.frame);
      expect(remainingFrames).not.toContain(0); // None seeded at frame 0
      expect(remainingFrames).not.toContain(15); // Deleted
      expect(remainingFrames).not.toContain(30); // Deleted (was at end of range)
      expect(remainingFrames).toEqual([60]); // Only the frame outside the range remains
    });

    it('simulates full trim workflow: trim end of video', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      // Setup
      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Init seeds no keyframes; add a frame-0 keyframe plus three more.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90, 'user');   // frame 0
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'user'); // frame 60
        result.current.addOrUpdateKeyframe(2.5, { x: 190, y: 190, width: 200, height: 300 }, 90, 'user'); // frame 75
      });

      // 4 explicitly added keyframes (0, 30, 60, 75).
      expect(result.current.keyframes.length).toBe(4);

      // Simulate trim: remove last 1 second (frames 60-90)
      act(() => {
        result.current.deleteKeyframesInRange(2.0, 3.0);
      });

      // All keyframes in range [60, 90] are deleted (inclusive)
      const remainingFrames = result.current.keyframes.map(kf => kf.frame);
      expect(remainingFrames).toContain(0);
      expect(remainingFrames).toContain(30);
      expect(remainingFrames).not.toContain(60); // Deleted (was at start of range)
      expect(remainingFrames).not.toContain(75); // Deleted
    });

    it('simulates trim with boundary keyframe creation', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
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

    it('keeps user origin on edits and added keyframes (no permanent promotion)', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Update the start keyframe — origin stays 'user' (no 'permanent' in this model).
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes[0].origin).toBe('user');

      // Add an end keyframe — also 'user'.
      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes[1].origin).toBe('user');
    });
  });

  // ============================================================================
  // DETRIM (UNDO TRIM) SCENARIOS
  // ============================================================================

  describe('detrim scenarios', () => {
    it('cleanup trim keyframes restores to clean state', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Init seeds no keyframes; add a frame-0 user keyframe plus a mix.
      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 100, y: 100, width: 200, height: 300 }, 90, 'user');   // frame 0
        result.current.addOrUpdateKeyframe(0.5, { x: 110, y: 110, width: 200, height: 300 }, 90, 'trim'); // frame 15
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user'); // frame 30
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180, width: 200, height: 300 }, 90, 'trim'); // frame 60
        result.current.addOrUpdateKeyframe(2.5, { x: 195, y: 195, width: 200, height: 300 }, 90, 'trim'); // frame 75
      });

      // 2 user (frames 0, 30) + 3 trim = 5 keyframes.
      expect(result.current.keyframes.length).toBe(5);

      // Detrim: cleanup all trim keyframes
      act(() => {
        result.current.cleanupTrimKeyframes();
      });

      // Only the two user keyframes (frames 0 and 30) survive.
      expect(result.current.keyframes.map(kf => kf.frame)).toEqual([0, 30]);
      expect(result.current.keyframes.every(kf => kf.origin !== 'trim')).toBe(true);
      expect(result.current.keyframes.map(kf => kf.origin)).toEqual(['user', 'user']);
    });
  });

  // ============================================================================
  // MULTI-OPERATION SEQUENCES
  // ============================================================================

  describe('multi-operation sequences', () => {
    it('handles add -> update -> remove sequence', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add (init seeds none + new frame 30 = 1)
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes.length).toBe(1);

      // Update (snap-update keeps count at 1)
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 175, y: 175, width: 200, height: 300 }, 90, 'user');
      });
      expect(result.current.keyframes.length).toBe(1);
      expect(result.current.keyframes[0].x).toBe(175);

      // Remove (back to an empty list)
      act(() => {
        result.current.removeKeyframe(1.0);
      });
      expect(result.current.keyframes.length).toBe(0);
    });

    it('handles copy from start -> paste at middle -> delete middle sequence', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
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

      // Copy from start
      act(() => {
        result.current.copyKeyframe(0, ['x', 'y', 'width', 'height']);
      });

      // Paste at middle
      act(() => {
        result.current.pasteKeyframe(1.5, 90);
      });

      // frame 0 + pasted frame 45 = 2 keyframes.
      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[1].x).toBe(100); // Copied value

      // Delete the pasted keyframe
      act(() => {
        result.current.removeKeyframe(1.5);
      });

      expect(result.current.keyframes.length).toBe(1);
    });

    it('handles multiple adds maintaining sort order', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
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
      // Init seeds no keyframes; added frames 60, 15, 45, 30 -> sorted.
      expect(frames).toEqual([15, 30, 45, 60]);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles keyframe at exact frame boundaries', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
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
        useKeyframeController({
          interpolateFn: mockCropInterpolate,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      // Add keyframes 12 frames apart (outside MIN_KEYFRAME_SPACING of 10)
      // Frame 30 = 1.0s, Frame 42 = 1.4s
      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150, width: 200, height: 300 }, 90, 'user');
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.4, { x: 151, y: 151, width: 200, height: 300 }, 90, 'user');
      });

      // Init seeds no keyframes; frames 30 and 42 (12 apart, > MIN_KEYFRAME_SPACING) = 2.
      expect(result.current.keyframes.length).toBe(2);
      const frames = result.current.keyframes.map(kf => kf.frame);
      expect(frames).toContain(30);
      expect(frames).toContain(42);
    });

    it('handles empty delete range', () => {
      const { result } = renderHook(() =>
        useKeyframeController({
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
        useKeyframeController({
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

});
