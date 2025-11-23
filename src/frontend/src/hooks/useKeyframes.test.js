import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useKeyframes from './useKeyframes';

describe('useKeyframes hook', () => {
  // Mock interpolation function
  const mockInterpolateFn = vi.fn((keyframes, frame, time) => {
    if (keyframes.length === 0) return null;

    // Simple linear interpolation mock
    const before = keyframes.filter(kf => kf.frame <= frame).pop();
    const after = keyframes.find(kf => kf.frame > frame);

    if (!before) return keyframes[0];
    if (!after) return before;

    const t = (frame - before.frame) / (after.frame - before.frame);
    return {
      x: before.x + (after.x - before.x) * t,
      y: before.y + (after.y - before.y) * t
    };
  });

  beforeEach(() => {
    mockInterpolateFn.mockClear();
  });

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('starts with empty keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({ interpolateFn: mockInterpolateFn, framerate: 30 })
      );

      expect(result.current.keyframes).toEqual([]);
      expect(result.current.isEndKeyframeExplicit).toBe(false);
      expect(result.current.copiedData).toBeNull();
    });

    it('initializeKeyframes creates start and end permanent keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({ interpolateFn: mockInterpolateFn, framerate: 30 })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[0]).toEqual({
        frame: 0,
        origin: 'permanent',
        x: 100,
        y: 100
      });
      expect(result.current.keyframes[1]).toEqual({
        frame: 90,
        origin: 'permanent',
        x: 100,
        y: 100
      });
    });

    it('needsInitialization returns true for empty keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({ interpolateFn: mockInterpolateFn, framerate: 30 })
      );

      expect(result.current.needsInitialization(90)).toBe(true);
    });

    it('needsInitialization returns false when end frame matches', () => {
      const { result } = renderHook(() =>
        useKeyframes({ interpolateFn: mockInterpolateFn, framerate: 30 })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.needsInitialization(90)).toBe(false);
    });

    it('needsInitialization returns true when end frame mismatches (stale keyframes)', () => {
      const { result } = renderHook(() =>
        useKeyframes({ interpolateFn: mockInterpolateFn, framerate: 30 })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      expect(result.current.needsInitialization(120)).toBe(true);
    });
  });

  // ============================================================================
  // KEYFRAME OPERATIONS
  // ============================================================================

  describe('addOrUpdateKeyframe', () => {
    it('adds keyframe at new position with user origin', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
        frame: 30, // 1.0 second at 30fps = frame 30
        origin: 'user',
        x: 150,
        y: 150
      });
    });

    it('updates existing keyframe while preserving permanent origin', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.keyframes[0].origin).toBe('permanent');
      expect(result.current.keyframes[0].x).toBe(200);
    });

    it('mirrors start to end when end not explicit', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.keyframes[0].x).toBe(200);
      expect(result.current.keyframes[1].x).toBe(200); // Mirrored
      expect(result.current.isEndKeyframeExplicit).toBe(false);
    });

    it('sets isEndKeyframeExplicit when updating end keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90, 'user');
      });

      expect(result.current.isEndKeyframeExplicit).toBe(true);
    });

    it('supports trim origin for trim-created keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'trim');
      });

      expect(result.current.keyframes[1].origin).toBe('trim');
    });
  });

  describe('removeKeyframe', () => {
    it('removes non-permanent keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
      });

      act(() => {
        result.current.removeKeyframe(1.0, 90);
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes.find(kf => kf.frame === 30)).toBeUndefined();
    });

    it('rejects removal of permanent keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      act(() => {
        result.current.removeKeyframe(0, 90);
      });

      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes[0].frame).toBe(0);
    });

    it('rejects removal if would leave less than 2 keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Try to remove, should fail (both are permanent anyway)
      act(() => {
        result.current.removeKeyframe(0, 90);
      });

      expect(result.current.keyframes.length).toBe(2);
    });
  });

  // ============================================================================
  // TRIM OPERATIONS
  // ============================================================================

  describe('deleteKeyframesInRange', () => {
    it('deletes keyframes in trim range', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      expect(result.current.keyframes.length).toBe(4);

      act(() => {
        result.current.deleteKeyframesInRange(0.8, 2.2, 90);
      });

      // Should keep frame 0 and frame 90, delete frame 30 and 60
      expect(result.current.keyframes.length).toBe(2);
      expect(result.current.keyframes.map(kf => kf.frame)).toEqual([0, 90]);
    });

    it('preserves keyframes at start boundary', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        result.current.addOrUpdateKeyframe(1.0, { x: 150, y: 150 }, 90, 'user');
        result.current.addOrUpdateKeyframe(2.0, { x: 180, y: 180 }, 90, 'user');
      });

      act(() => {
        // Range starts exactly at frame 30 (1.0s)
        result.current.deleteKeyframesInRange(1.0, 2.2, 90);
      });

      // Frame 30 should be preserved (at boundary)
      expect(result.current.keyframes.find(kf => kf.frame === 30)).toBeDefined();
    });
  });

  describe('cleanupTrimKeyframes', () => {
    it('removes all keyframes with trim origin', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
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
  // COPY/PASTE
  // ============================================================================

  describe('copyKeyframe', () => {
    it('copies keyframe data at exact frame', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
        success = result.current.copyKeyframe(0, ['x', 'y']);
      });

      expect(success).toBe(true);
      expect(result.current.copiedData).toEqual({ x: 100, y: 100 });
    });

    it('copies interpolated data when no exact keyframe', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        result.current.addOrUpdateKeyframe(3.0, { x: 200, y: 200 }, 90);
      });

      let success;
      act(() => {
        // 1.5 seconds = frame 45, between frame 0 and frame 90
        success = result.current.copyKeyframe(1.5, ['x', 'y']);
      });

      expect(success).toBe(true);
      expect(result.current.copiedData).toBeDefined();
    });

    it('copies only specified data keys', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100, width: 200, height: 300 }, 90);
      });

      act(() => {
        result.current.copyKeyframe(0, ['x', 'width']);
      });

      expect(result.current.copiedData).toEqual({ x: 100, width: 200 });
      expect(result.current.copiedData.y).toBeUndefined();
    });
  });

  describe('pasteKeyframe', () => {
    it('pastes copied data at specified time', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      // Copy must be in separate act block after keyframes are initialized
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

    it('returns false when no copied data', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
    });
  });

  // ============================================================================
  // QUERIES
  // ============================================================================

  describe('interpolate', () => {
    it('calls interpolation function with keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      const interpolated = result.current.interpolate(1.5);

      expect(mockInterpolateFn).toHaveBeenCalled();
      expect(interpolated).toBeDefined();
    });

    it('returns null when no interpolation function', () => {
      const { result } = renderHook(() =>
        useKeyframes({ framerate: 30 })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      const interpolated = result.current.interpolate(1.5);
      expect(interpolated).toBeNull();
    });
  });

  describe('hasKeyframeAt', () => {
    it('returns true when keyframe exists at time', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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

    it('returns false when no keyframe at time', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
  });

  describe('getKeyframeAt', () => {
    it('returns keyframe at exact time', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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

    it('returns undefined when no keyframe at time', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
  });

  describe('getDataAtTime', () => {
    it('returns interpolated data with specified keys', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      const data = result.current.getDataAtTime(0, ['x']);
      expect(data).toEqual({ x: 100 });
    });
  });

  describe('getKeyframesForExport', () => {
    it('converts frame numbers to time for export', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
      });

      const exported = result.current.getKeyframesForExport(['x', 'y']);

      expect(exported.length).toBe(2);
      expect(exported[0]).toEqual({ time: 0, x: 100, y: 100 });
      expect(exported[1]).toEqual({ time: 3, x: 100, y: 100 }); // 90 frames / 30fps = 3s
    });
  });

  // ============================================================================
  // RESET
  // ============================================================================

  describe('reset', () => {
    it('clears all state', () => {
      const { result } = renderHook(() =>
        useKeyframes({
          interpolateFn: mockInterpolateFn,
          framerate: 30,
          getEndFrame: (total) => total
        })
      );

      act(() => {
        result.current.initializeKeyframes({ x: 100, y: 100 }, 90);
        result.current.copyKeyframe(0, ['x', 'y']);
        result.current.setIsEndKeyframeExplicit(true);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.keyframes).toEqual([]);
      expect(result.current.copiedData).toBeNull();
      expect(result.current.isEndKeyframeExplicit).toBe(false);
    });
  });

  // ============================================================================
  // UPDATE ALL KEYFRAMES
  // ============================================================================

  describe('updateAllKeyframes', () => {
    it('applies update function to all keyframes', () => {
      const { result } = renderHook(() =>
        useKeyframes({
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
  });
});
