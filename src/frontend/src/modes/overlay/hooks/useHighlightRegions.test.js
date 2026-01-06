import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';

/**
 * Tests for useHighlightRegions hook.
 *
 * This hook manages highlight regions for the overlay mode.
 * Each region is a time range with keyframes defining highlight ellipse positions.
 */

describe('useHighlightRegions', () => {
  const defaultVideoMetadata = {
    width: 1920,
    height: 1080,
    duration: 30
  };

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  describe('initialization', () => {
    it('starts with empty regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      expect(result.current.regions).toEqual([]);
      expect(result.current.keyframes).toEqual([]);
      expect(result.current.selectedRegionId).toBeNull();
      expect(result.current.duration).toBeNull();
    });

    it('initializeWithDuration sets duration', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      expect(result.current.duration).toBe(30);
    });

    it('reset clears all state', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      expect(result.current.regions.length).toBe(1);

      act(() => {
        result.current.reset();
      });

      expect(result.current.regions).toEqual([]);
      expect(result.current.duration).toBeNull();
      expect(result.current.selectedRegionId).toBeNull();
    });
  });

  // ============================================================================
  // REGION OPERATIONS
  // ============================================================================

  describe('addRegion', () => {
    it('creates 5-second region with start and end keyframes', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      expect(regionId).toBeDefined();
      expect(result.current.regions.length).toBe(1);

      const region = result.current.regions[0];
      expect(region.startTime).toBeCloseTo(5, 1);
      expect(region.endTime).toBeCloseTo(10, 1);
      expect(region.enabled).toBe(true);
      expect(region.keyframes).toHaveLength(2);
      expect(region.keyframes[0].origin).toBe('permanent');
      expect(region.keyframes[1].origin).toBe('permanent');
    });

    it('caps region at video duration', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(28);
      });

      const region = result.current.regions[0];
      expect(region.endTime).toBeLessThanOrEqual(30);
    });

    it('rejects region if duration not set', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      expect(regionId).toBeNull();
      expect(result.current.regions.length).toBe(0);
    });

    it('rejects overlapping regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      let secondId;
      act(() => {
        secondId = result.current.addRegion(7); // Overlaps with 5-10
      });

      expect(secondId).toBeNull();
      expect(result.current.regions.length).toBe(1);
    });

    it('allows non-overlapping regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(0);
      });

      act(() => {
        result.current.addRegion(10);
      });

      expect(result.current.regions.length).toBe(2);
    });

    it('selects newly created region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      expect(result.current.selectedRegionId).toBe(regionId);
    });
  });

  describe('deleteRegion', () => {
    it('removes region by ID', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      expect(result.current.regions.length).toBe(1);

      act(() => {
        result.current.deleteRegion(regionId);
      });

      expect(result.current.regions.length).toBe(0);
    });

    it('clears selection when selected region is deleted', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      expect(result.current.selectedRegionId).toBe(regionId);

      act(() => {
        result.current.deleteRegion(regionId);
      });

      expect(result.current.selectedRegionId).toBeNull();
    });

    it('deleteRegionByIndex removes region at index', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(0);
      });

      act(() => {
        result.current.addRegion(10);
      });

      expect(result.current.regions.length).toBe(2);

      act(() => {
        result.current.deleteRegionByIndex(0);
      });

      expect(result.current.regions.length).toBe(1);
      expect(result.current.regions[0].startTime).toBeCloseTo(10, 1);
    });
  });

  describe('moveRegionStart', () => {
    it('moves region start boundary', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      const originalStart = result.current.regions[0].startTime;

      act(() => {
        result.current.moveRegionStart(regionId, 3);
      });

      expect(result.current.regions[0].startTime).toBeLessThan(originalStart);
      expect(result.current.regions[0].startTime).toBeGreaterThanOrEqual(0);
    });

    it('maintains minimum region duration', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      const endTime = result.current.regions[0].endTime;

      act(() => {
        result.current.moveRegionStart(regionId, endTime - 0.1); // Try to make too short
      });

      // Should maintain minimum 0.5s duration
      const regionDuration = result.current.regions[0].endTime - result.current.regions[0].startTime;
      expect(regionDuration).toBeGreaterThanOrEqual(0.5);
    });

    it('prevents overlap with previous region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(0);
      });

      let secondId;
      act(() => {
        secondId = result.current.addRegion(10);
      });

      act(() => {
        result.current.moveRegionStart(secondId, 3); // Try to overlap with first region
      });

      // Second region start should not overlap first region end
      const firstEnd = result.current.regions[0].endTime;
      const secondStart = result.current.regions[1].startTime;
      expect(secondStart).toBeGreaterThanOrEqual(firstEnd);
    });
  });

  describe('moveRegionEnd', () => {
    it('moves region end boundary', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
      });

      const originalEnd = result.current.regions[0].endTime;

      act(() => {
        result.current.moveRegionEnd(regionId, 15);
      });

      expect(result.current.regions[0].endTime).toBeGreaterThan(originalEnd);
    });

    it('caps at video duration', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(25);
      });

      act(() => {
        result.current.moveRegionEnd(regionId, 100); // Beyond video end
      });

      expect(result.current.regions[0].endTime).toBeLessThanOrEqual(30);
    });
  });

  describe('toggleRegionEnabled', () => {
    it('disables region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      expect(result.current.regions[0].enabled).toBe(true);

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      expect(result.current.regions[0].enabled).toBe(false);
    });

    it('enables region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, true);
      });

      expect(result.current.regions[0].enabled).toBe(true);
    });
  });

  describe('selectRegion', () => {
    it('sets selected region ID', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      let regionId;
      act(() => {
        regionId = result.current.addRegion(5);
        result.current.selectRegion(null); // Deselect
      });

      expect(result.current.selectedRegionId).toBeNull();

      act(() => {
        result.current.selectRegion(regionId);
      });

      expect(result.current.selectedRegionId).toBe(regionId);
    });
  });

  // ============================================================================
  // KEYFRAME OPERATIONS
  // ============================================================================

  describe('addOrUpdateKeyframe', () => {
    it('adds keyframe within region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const initialKeyframes = result.current.regions[0].keyframes.length;

      act(() => {
        result.current.addOrUpdateKeyframe(7, { x: 500, y: 500, radiusX: 50, radiusY: 80 });
      });

      expect(result.current.regions[0].keyframes.length).toBeGreaterThan(initialKeyframes);
    });

    it('updates existing keyframe at same frame', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const startTime = result.current.regions[0].startTime;

      act(() => {
        result.current.addOrUpdateKeyframe(startTime, { x: 999, y: 888 });
      });

      const firstKeyframe = result.current.regions[0].keyframes[0];
      expect(firstKeyframe.x).toBe(999);
      expect(firstKeyframe.y).toBe(888);
    });

    it('rejects keyframe outside any region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5); // 5-10s
      });

      let success;
      act(() => {
        success = result.current.addOrUpdateKeyframe(15, { x: 100, y: 100 });
      });

      expect(success).toBe(false);
    });

    it('rejects keyframe in disabled region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      let success;
      act(() => {
        success = result.current.addOrUpdateKeyframe(7, { x: 100, y: 100 });
      });

      expect(success).toBe(false);
    });
  });

  describe('removeKeyframe', () => {
    it('removes user keyframe', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(7, { x: 100, y: 100 });
      });

      const keyframeCount = result.current.regions[0].keyframes.length;

      act(() => {
        result.current.removeKeyframe(7);
      });

      expect(result.current.regions[0].keyframes.length).toBeLessThan(keyframeCount);
    });

    it('does not remove permanent keyframe', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const startTime = result.current.regions[0].startTime;
      const initialCount = result.current.regions[0].keyframes.length;

      act(() => {
        result.current.removeKeyframe(startTime);
      });

      // Permanent keyframes should not be removed
      expect(result.current.regions[0].keyframes.length).toBe(initialCount);
    });
  });

  // ============================================================================
  // COPY/PASTE
  // ============================================================================

  describe('copy/paste keyframes', () => {
    it('copyKeyframe stores current highlight data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      expect(result.current.copiedData).toBeNull();

      let success;
      act(() => {
        success = result.current.copyKeyframe(5);
      });

      expect(success).toBe(true);
      expect(result.current.copiedData).toBeDefined();
      expect(result.current.copiedData).toHaveProperty('x');
      expect(result.current.copiedData).toHaveProperty('y');
    });

    it('pasteKeyframe applies copied data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.addOrUpdateKeyframe(6, { x: 123, y: 456, radiusX: 20, radiusY: 30 });
      });

      act(() => {
        result.current.copyKeyframe(6);
      });

      const copiedX = result.current.copiedData.x;

      act(() => {
        result.current.pasteKeyframe(8);
      });

      // Find keyframe at frame for time 8
      const keyframes = result.current.regions[0].keyframes;
      const pastedKf = keyframes.find(kf => kf.x === copiedX && kf.frame > 0);
      expect(pastedKf).toBeDefined();
    });

    it('pasteKeyframe returns false when nothing copied', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      let success;
      act(() => {
        success = result.current.pasteKeyframe(7);
      });

      expect(success).toBe(false);
    });
  });

  // ============================================================================
  // QUERIES
  // ============================================================================

  describe('getRegionAtTime', () => {
    it('returns region containing time', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const region = result.current.getRegionAtTime(7);
      expect(region).toBeDefined();
      expect(region.startTime).toBeLessThanOrEqual(7);
      expect(region.endTime).toBeGreaterThanOrEqual(7);
    });

    it('returns null when no region at time', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const region = result.current.getRegionAtTime(15);
      expect(region).toBeNull();
    });
  });

  describe('isTimeInEnabledRegion', () => {
    it('returns true for time in enabled region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      expect(result.current.isTimeInEnabledRegion(7)).toBe(true);
    });

    it('returns false for time in disabled region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      expect(result.current.isTimeInEnabledRegion(7)).toBe(false);
    });

    it('returns false for time outside all regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      expect(result.current.isTimeInEnabledRegion(15)).toBe(false);
    });
  });

  describe('getHighlightAtTime', () => {
    it('returns interpolated highlight data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const highlight = result.current.getHighlightAtTime(7);
      expect(highlight).toBeDefined();
      expect(highlight).toHaveProperty('x');
      expect(highlight).toHaveProperty('y');
      expect(highlight).toHaveProperty('radiusX');
      expect(highlight).toHaveProperty('radiusY');
    });

    it('returns null for time in disabled region', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      const highlight = result.current.getHighlightAtTime(7);
      expect(highlight).toBeNull();
    });

    it('returns null for time outside regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const highlight = result.current.getHighlightAtTime(15);
      expect(highlight).toBeNull();
    });
  });

  describe('calculateDefaultHighlight', () => {
    it('calculates centered ellipse based on video dimensions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      const highlight = result.current.calculateDefaultHighlight(1920, 1080);

      expect(highlight.x).toBe(960); // Center x
      expect(highlight.y).toBe(540); // Center y
      expect(highlight.radiusX).toBeGreaterThan(0);
      expect(highlight.radiusY).toBeGreaterThan(0);
      expect(highlight.color).toBe('#FFFF00');
    });

    it('returns fallback for missing dimensions', () => {
      const { result } = renderHook(() => useHighlightRegions(null));

      const highlight = result.current.calculateDefaultHighlight(null, null);

      expect(highlight).toBeDefined();
      expect(highlight.radiusX).toBe(30);
      expect(highlight.radiusY).toBe(50);
    });
  });

  // ============================================================================
  // RESTORE/EXPORT
  // ============================================================================

  describe('restoreRegions', () => {
    it('restores regions from saved data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      const savedRegions = [
        {
          id: 'test-region-1',
          start_time: 5,
          end_time: 10,
          enabled: true,
          keyframes: [
            { time: 5, x: 100, y: 200, radiusX: 30, radiusY: 40, opacity: 0.15, color: '#FFFF00' },
            { time: 10, x: 150, y: 250, radiusX: 30, radiusY: 40, opacity: 0.15, color: '#FFFF00' }
          ]
        }
      ];

      act(() => {
        result.current.restoreRegions(savedRegions, 30);
      });

      expect(result.current.regions.length).toBe(1);
      expect(result.current.regions[0].startTime).toBe(5);
      expect(result.current.regions[0].endTime).toBe(10);
      expect(result.current.regions[0].keyframes.length).toBe(2);
    });

    it('handles empty saved data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.restoreRegions([], 30);
      });

      expect(result.current.regions.length).toBe(0);
    });

    it('handles null saved data', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.restoreRegions(null, 30);
      });

      expect(result.current.regions.length).toBe(0);
    });

    it('converts snake_case to camelCase fields', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      const savedRegions = [
        {
          id: 'test-region',
          start_time: 2,
          end_time: 7,
          enabled: true,
          keyframes: [
            { time: 2, x: 100, y: 200, radiusX: 30, radiusY: 40 }
          ]
        }
      ];

      act(() => {
        result.current.restoreRegions(savedRegions, 30);
      });

      // Should have startTime/endTime, not start_time/end_time
      expect(result.current.regions[0]).toHaveProperty('startTime');
      expect(result.current.regions[0]).toHaveProperty('endTime');
    });
  });

  describe('getRegionsForExport', () => {
    it('exports enabled regions only', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(0);
      });

      act(() => {
        result.current.addRegion(10);
      });

      act(() => {
        result.current.toggleRegionEnabled(0, false);
      });

      const exported = result.current.getRegionsForExport();

      expect(exported.length).toBe(1);
      expect(exported[0].start_time).toBeCloseTo(10, 1);
    });

    it('converts to snake_case for export', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const exported = result.current.getRegionsForExport();

      expect(exported[0]).toHaveProperty('start_time');
      expect(exported[0]).toHaveProperty('end_time');
    });

    it('converts frame-based keyframes to time-based', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const exported = result.current.getRegionsForExport();

      expect(exported[0].keyframes.length).toBeGreaterThan(0);
      exported[0].keyframes.forEach(kf => {
        expect(kf).toHaveProperty('time');
        expect(typeof kf.time).toBe('number');
      });
    });
  });

  describe('initializeFromClipMetadata', () => {
    it('creates regions from clip boundaries', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      const metadata = {
        source_clips: [
          { start_time: 0, end_time: 10, name: 'Clip 1' },
          { start_time: 10, end_time: 20, name: 'Clip 2' }
        ]
      };

      let count;
      act(() => {
        result.current.initializeWithDuration(30);
        count = result.current.initializeFromClipMetadata(metadata, 1920, 1080);
      });

      expect(count).toBe(2);
      expect(result.current.regions.length).toBe(2);
    });

    it('handles empty clip metadata', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      let count;
      act(() => {
        result.current.initializeWithDuration(30);
        count = result.current.initializeFromClipMetadata({}, 1920, 1080);
      });

      expect(count).toBe(0);
      expect(result.current.regions.length).toBe(0);
    });

    it('handles null metadata', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      let count;
      act(() => {
        result.current.initializeWithDuration(30);
        count = result.current.initializeFromClipMetadata(null, 1920, 1080);
      });

      expect(count).toBe(0);
    });
  });

  // ============================================================================
  // DERIVED STATE
  // ============================================================================

  describe('boundaries derived state', () => {
    it('includes 0 and duration as boundaries', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      expect(result.current.boundaries).toContain(0);
      expect(result.current.boundaries).toContain(30);
    });

    it('includes region start/end as boundaries', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const region = result.current.regions[0];
      expect(result.current.boundaries).toContain(region.startTime);
      expect(result.current.boundaries).toContain(region.endTime);
    });
  });

  describe('regionsWithLayout', () => {
    it('adds visual layout properties', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(5);
      });

      const region = result.current.regions[0];
      expect(region).toHaveProperty('visualStartPercent');
      expect(region).toHaveProperty('visualWidthPercent');
      expect(region).toHaveProperty('index');
      expect(region).toHaveProperty('isFirst');
      expect(region).toHaveProperty('isLast');
    });
  });

  describe('allKeyframes flattening', () => {
    it('flattens keyframes from all regions', () => {
      const { result } = renderHook(() => useHighlightRegions(defaultVideoMetadata));

      act(() => {
        result.current.initializeWithDuration(30);
      });

      act(() => {
        result.current.addRegion(0);
      });

      act(() => {
        result.current.addRegion(10);
      });

      // Each region has 2 keyframes
      expect(result.current.keyframes.length).toBe(4);
    });
  });
});
