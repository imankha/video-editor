import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';

/**
 * T270: Verify that getRegionsForExport filters keyframes to region bounds.
 *
 * When a user shrinks a region, keyframes outside [startTime, endTime]
 * should be excluded from exported data.
 */
describe('useHighlightRegions - region bounds clipping (T270)', () => {
  const videoMetadata = { width: 1920, height: 1080, fps: 30, duration: 10 };

  it('getRegionsForExport filters keyframes outside region bounds', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    // Initialize duration first (required for addRegion)
    act(() => {
      result.current.initializeWithDuration(10);
    });

    // Add a region at t=0 (creates 2-second region with default keyframes)
    act(() => {
      result.current.addRegion(0);
    });

    const regions = result.current.regions;
    expect(regions.length).toBe(1);

    const region = regions[0];
    const originalStart = region.startTime;
    const originalEnd = region.endTime;

    // Add a keyframe at t=0.5 within the original region
    act(() => {
      result.current.addOrUpdateKeyframe(
        originalStart + 0.5,
        { x: 100, y: 100, radiusX: 50, radiusY: 50, opacity: 0.15 }
      );
    });

    // Now shrink the region from the start so the t=0 and t=0.5 keyframes fall outside
    // Move start to halfway through the region (t=1.0 for a [0, 2] region)
    const newStart = originalStart + (originalEnd - originalStart) / 2;
    act(() => {
      result.current.moveRegionStart(region.id, newStart);
    });

    // Export the regions
    const exported = result.current.getRegionsForExport();
    expect(exported.length).toBe(1);

    const exportedRegion = exported[0];

    // All exported keyframes should be within region bounds
    for (const kf of exportedRegion.keyframes) {
      expect(kf.time).toBeGreaterThanOrEqual(exportedRegion.start_time - 0.001);
      expect(kf.time).toBeLessThanOrEqual(exportedRegion.end_time + 0.001);
    }
  });

  it('getHighlightAtTime returns null outside region bounds', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    // Initialize duration
    act(() => {
      result.current.initializeWithDuration(10);
    });

    // Add a region at t=2
    act(() => {
      result.current.addRegion(2.0);
    });

    const region = result.current.regions[0];

    // Time outside region should return null
    const outsideBefore = result.current.getHighlightAtTime(region.startTime - 1.0);
    expect(outsideBefore).toBeNull();

    const outsideAfter = result.current.getHighlightAtTime(region.endTime + 1.0);
    expect(outsideAfter).toBeNull();

    // Time inside region should return highlight data
    const inside = result.current.getHighlightAtTime(
      (region.startTime + region.endTime) / 2
    );
    expect(inside).not.toBeNull();
  });
});
