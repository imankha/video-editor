import { describe, it, expect } from 'vitest';
import {
  findKeyframeIndexAtFrame,
  findKeyframeAtFrame,
  findKeyframeIndexNearFrame,
  hasKeyframeAtFrame,
  FRAME_TOLERANCE
} from './keyframeUtils';

describe('keyframeUtils', () => {
  // Sample keyframes for testing
  const sampleKeyframes = [
    { frame: 0, x: 100, y: 100, origin: 'permanent' },
    { frame: 30, x: 150, y: 150, origin: 'user' },
    { frame: 60, x: 200, y: 200, origin: 'trim' },
    { frame: 90, x: 250, y: 250, origin: 'permanent' }
  ];

  describe('findKeyframeIndexAtFrame', () => {
    it('returns index when keyframe exists at exact frame', () => {
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 0)).toBe(0);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 30)).toBe(1);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 60)).toBe(2);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 90)).toBe(3);
    });

    it('returns -1 when no keyframe at frame', () => {
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 15)).toBe(-1);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 45)).toBe(-1);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 100)).toBe(-1);
    });

    it('returns -1 for empty keyframes array', () => {
      expect(findKeyframeIndexAtFrame([], 0)).toBe(-1);
    });

    it('does not use tolerance - exact match only', () => {
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 29)).toBe(-1);
      expect(findKeyframeIndexAtFrame(sampleKeyframes, 31)).toBe(-1);
    });
  });

  describe('findKeyframeAtFrame', () => {
    it('returns keyframe when exists at exact frame', () => {
      const result = findKeyframeAtFrame(sampleKeyframes, 30);
      expect(result).toEqual({ frame: 30, x: 150, y: 150, origin: 'user' });
    });

    it('returns undefined when no keyframe at frame', () => {
      expect(findKeyframeAtFrame(sampleKeyframes, 15)).toBeUndefined();
      expect(findKeyframeAtFrame(sampleKeyframes, 100)).toBeUndefined();
    });

    it('returns undefined for empty keyframes array', () => {
      expect(findKeyframeAtFrame([], 0)).toBeUndefined();
    });
  });

  describe('findKeyframeIndexNearFrame', () => {
    it('returns index when keyframe is within tolerance', () => {
      // Default tolerance is 2
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 28)).toBe(1); // 28 is within 2 of 30
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 32)).toBe(1); // 32 is within 2 of 30
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 30)).toBe(1); // Exact match
    });

    it('returns -1 when no keyframe within tolerance', () => {
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 15)).toBe(-1);
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 45)).toBe(-1);
    });

    it('respects custom tolerance', () => {
      // With tolerance of 5
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 25, 5)).toBe(1); // 25 is within 5 of 30
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 35, 5)).toBe(1); // 35 is within 5 of 30

      // With tolerance of 0 (exact match only)
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 30, 0)).toBe(1);
      expect(findKeyframeIndexNearFrame(sampleKeyframes, 29, 0)).toBe(-1);
    });

    it('returns first matching keyframe when multiple could match', () => {
      // Keyframes very close together
      const closeKeyframes = [
        { frame: 10 },
        { frame: 12 }
      ];
      // With tolerance of 3, frame 11 could match both, but should return first
      expect(findKeyframeIndexNearFrame(closeKeyframes, 11, 3)).toBe(0);
    });

    it('returns -1 for empty keyframes array', () => {
      expect(findKeyframeIndexNearFrame([], 30)).toBe(-1);
    });
  });

  describe('hasKeyframeAtFrame', () => {
    it('returns true when keyframe exists at frame', () => {
      expect(hasKeyframeAtFrame(sampleKeyframes, 0)).toBe(true);
      expect(hasKeyframeAtFrame(sampleKeyframes, 30)).toBe(true);
      expect(hasKeyframeAtFrame(sampleKeyframes, 90)).toBe(true);
    });

    it('returns false when no keyframe at frame', () => {
      expect(hasKeyframeAtFrame(sampleKeyframes, 15)).toBe(false);
      expect(hasKeyframeAtFrame(sampleKeyframes, 100)).toBe(false);
    });

    it('returns false for empty keyframes array', () => {
      expect(hasKeyframeAtFrame([], 0)).toBe(false);
    });
  });

  describe('FRAME_TOLERANCE', () => {
    it('should be 2 (for ~67ms tolerance at 30fps)', () => {
      expect(FRAME_TOLERANCE).toBe(2);
    });
  });
});
