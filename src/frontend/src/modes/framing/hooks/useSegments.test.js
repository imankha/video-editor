/**
 * Tests for useSegments hook, specifically the restoreState function
 * which must handle multiple data formats from different save paths.
 *
 * Save paths that produce different formats:
 * 1. Gesture-based actions → internal format (trimRange, segmentSpeeds, boundaries)
 * 2. Auto-save via getExportData() → export format (trim_start, trim_end, segments array)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSegments } from './useSegments';

describe('useSegments', () => {
  describe('restoreState', () => {
    const VIDEO_DURATION = 10.0;

    // Helper to render hook and initialize with duration
    const setupHook = () => {
      const { result } = renderHook(() => useSegments());
      act(() => {
        result.current.initializeWithDuration(VIDEO_DURATION);
      });
      return result;
    };

    describe('internal format (from gesture-based actions)', () => {
      it('restores trimRange from internal format', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            trimRange: { start: 2.0, end: 8.0 }
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toEqual({ start: 2.0, end: 8.0 });
      });

      it('restores segmentSpeeds from internal format', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            segmentSpeeds: { 0: 0.5, 1: 2.0 }
          }, VIDEO_DURATION);
        });

        expect(result.current.segmentSpeeds).toEqual({ 0: 0.5, 1: 2.0 });
      });

      it('restores speeds from legacy "speeds" key', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            speeds: { 0: 0.25 }
          }, VIDEO_DURATION);
        });

        expect(result.current.segmentSpeeds).toEqual({ 0: 0.25 });
      });

      it('restores boundaries from internal format', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            boundaries: [0, 3.0, 7.0, VIDEO_DURATION]
          }, VIDEO_DURATION);
        });

        // Boundaries should be [0, 3.0, 7.0, 10.0]
        // userSplits are boundaries excluding 0 and duration
        expect(result.current.boundaries).toContain(3.0);
        expect(result.current.boundaries).toContain(7.0);
      });

      it('restores full internal state', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            boundaries: [0, 5.0, VIDEO_DURATION],
            segmentSpeeds: { 0: 0.5 },
            trimRange: { start: 1.0, end: 9.0 }
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toEqual({ start: 1.0, end: 9.0 });
        expect(result.current.segmentSpeeds).toEqual({ 0: 0.5 });
        expect(result.current.boundaries).toContain(5.0);
      });

      it('preserves segment indices with multiple segments and speed on later segment', () => {
        // This tests the case where segment 2 has speed 0.5
        // Internal format preserves the index correctly (unlike export format)
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            boundaries: [0, 3.0, 6.0, VIDEO_DURATION],
            segmentSpeeds: { 2: 0.5 },  // Speed on segment 2 (6-10)
            trimRange: { start: 3.0, end: VIDEO_DURATION }  // Segment 0 is trimmed
          }, VIDEO_DURATION);
        });

        // Segment 2 should have speed 0.5
        expect(result.current.segmentSpeeds[2]).toBe(0.5);
        // Segments 0 and 1 should have no explicit speed (default 1)
        expect(result.current.segmentSpeeds[0]).toBeUndefined();
        expect(result.current.segmentSpeeds[1]).toBeUndefined();
      });

      it('handles string keys from backend JSON (segment indices as strings)', () => {
        // Backend saves segment indices as string keys in JSON
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            segmentSpeeds: { "0": 0.5, "1": 2.0 }  // String keys from JSON
          }, VIDEO_DURATION);
        });

        // Should work with both string and number access
        expect(result.current.segmentSpeeds["0"]).toBe(0.5);
        expect(result.current.segmentSpeeds["1"]).toBe(2.0);
        expect(result.current.segmentSpeeds[0]).toBe(0.5);
        expect(result.current.segmentSpeeds[1]).toBe(2.0);
      });
    });

    describe('export format (from auto-save via getExportData)', () => {
      it('restores trim from export format WITHOUT segments array', () => {
        // This is the bug case - trim_start/trim_end without segments array
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            trim_start: 2.0,
            trim_end: 8.0
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toEqual({ start: 2.0, end: 8.0 });
      });

      it('restores trim from export format WITH segments array', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            trim_start: 1.0,
            trim_end: 9.0,
            segments: [
              { start: 1.0, end: 5.0, speed: 1 },
              { start: 5.0, end: 9.0, speed: 0.5 }
            ]
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toEqual({ start: 1.0, end: 9.0 });
      });

      it('restores speeds from segments array in export format', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            segments: [
              { start: 0, end: 5.0, speed: 0.5 },
              { start: 5.0, end: VIDEO_DURATION, speed: 2.0 }
            ]
          }, VIDEO_DURATION);
        });

        // Speeds should be extracted from segments
        expect(result.current.segmentSpeeds[0]).toBe(0.5);
        expect(result.current.segmentSpeeds[1]).toBe(2.0);
      });

      it('restores boundaries from segments array in export format', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            segments: [
              { start: 0, end: 3.0, speed: 1 },
              { start: 3.0, end: 7.0, speed: 1 },
              { start: 7.0, end: VIDEO_DURATION, speed: 1 }
            ]
          }, VIDEO_DURATION);
        });

        // Should extract boundaries from segments
        expect(result.current.boundaries).toContain(3.0);
        expect(result.current.boundaries).toContain(7.0);
      });

      it('handles trim_start only (trim from beginning)', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            trim_start: 3.0
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange.start).toBe(3.0);
        expect(result.current.trimRange.end).toBe(VIDEO_DURATION);
      });

      it('handles trim_end only (trim from end)', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState({
            trim_end: 7.0
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange.start).toBe(0);
        expect(result.current.trimRange.end).toBe(7.0);
      });
    });

    describe('edge cases', () => {
      it('handles null savedState', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState(null, VIDEO_DURATION);
        });

        // Should not crash, state should remain at defaults
        expect(result.current.trimRange).toBeNull();
      });

      it('handles undefined savedState', () => {
        const result = setupHook();

        act(() => {
          result.current.restoreState(undefined, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toBeNull();
      });

      it('handles empty object', () => {
        const result = setupHook();

        // First set some state
        act(() => {
          result.current.restoreState({
            trimRange: { start: 2.0, end: 8.0 }
          }, VIDEO_DURATION);
        });

        // Then restore empty object - should clear trim
        act(() => {
          result.current.restoreState({}, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toBeNull();
      });

      it('clears trim history on restore', () => {
        const result = setupHook();

        // Create some trim history
        act(() => {
          result.current.trimStart(2.0);
        });

        expect(result.current.trimHistory.length).toBeGreaterThan(0);

        // Restore should clear history
        act(() => {
          result.current.restoreState({
            trimRange: { start: 1.0, end: 9.0 }
          }, VIDEO_DURATION);
        });

        expect(result.current.trimHistory).toEqual([]);
      });
    });

    describe('format detection', () => {
      it('correctly identifies export format by segments array presence', () => {
        const result = setupHook();

        // Export format with segments array
        act(() => {
          result.current.restoreState({
            segments: [{ start: 0, end: 5, speed: 0.5 }],
            trim_start: 0,
            trim_end: 5
          }, VIDEO_DURATION);
        });

        // Should use export format parsing (trim_start/trim_end)
        expect(result.current.trimRange).toEqual({ start: 0, end: 5 });
        expect(result.current.segmentSpeeds[0]).toBe(0.5);
      });

      it('correctly identifies internal format by lack of segments array', () => {
        const result = setupHook();

        // Internal format without segments array
        act(() => {
          result.current.restoreState({
            trimRange: { start: 1, end: 9 },
            segmentSpeeds: { 0: 2.0 }
          }, VIDEO_DURATION);
        });

        expect(result.current.trimRange).toEqual({ start: 1, end: 9 });
        expect(result.current.segmentSpeeds[0]).toBe(2.0);
      });
    });
  });

  describe('getExportData', () => {
    const VIDEO_DURATION = 10.0;

    const setupHook = () => {
      const { result } = renderHook(() => useSegments());
      act(() => {
        result.current.initializeWithDuration(VIDEO_DURATION);
      });
      return result;
    };

    it('returns null when no changes', () => {
      const result = setupHook();

      const exportData = result.current.getExportData();

      expect(exportData).toBeNull();
    });

    it('returns trim_start and trim_end for trim-only changes', () => {
      const result = setupHook();

      act(() => {
        result.current.trimStart(2.0);
      });

      const exportData = result.current.getExportData();

      expect(exportData).toHaveProperty('trim_start', 2.0);
      expect(exportData).toHaveProperty('trim_end');
      // Should NOT have segments array when no speed changes
      expect(exportData.segments).toBeUndefined();
    });

    it('returns segments array for speed changes', () => {
      const result = setupHook();

      act(() => {
        result.current.setSegmentSpeed(0, 0.5);
      });

      const exportData = result.current.getExportData();

      expect(exportData).toHaveProperty('segments');
      expect(Array.isArray(exportData.segments)).toBe(true);
      expect(exportData.segments[0].speed).toBe(0.5);
    });

    it('returns both trim and segments for combined changes', () => {
      const result = setupHook();

      act(() => {
        result.current.trimStart(1.0);
        result.current.setSegmentSpeed(0, 2.0);
      });

      const exportData = result.current.getExportData();

      expect(exportData).toHaveProperty('trim_start');
      expect(exportData).toHaveProperty('trim_end');
      expect(exportData).toHaveProperty('segments');
    });
  });
});
