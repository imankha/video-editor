import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions, { sliceDetections } from './useHighlightRegions';

/**
 * T5600: player-detection tracking squares survive highlight-region delete.
 *
 * Detections now live in a video-level flat payload held by this hook
 * (`videoDetections`, set from the /overlay-data response), not persisted
 * per-region. `addRegion` slices the held payload locally so tracking squares
 * appear instantly for a newly created region -- including one re-created
 * over a span whose previous region was deleted.
 */
describe('useHighlightRegions - video-level detections survive delete (T5600)', () => {
  const videoMetadata = { width: 1920, height: 1080, fps: 30, duration: 10 };

  const videoDetections = {
    videoWidth: 1920,
    videoHeight: 1080,
    fps: 30,
    detections: [
      { timestamp: 0.5, frame: 15, boxes: [{ x: 0.1, y: 0.1 }] },
      { timestamp: 1.0, frame: 30, boxes: [{ x: 0.2, y: 0.2 }] },
      { timestamp: 5.0, frame: 150, boxes: [{ x: 0.3, y: 0.3 }] },
    ],
  };

  it('addRegion populates detections from the held flat list for the new span', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections(videoDetections);
    });

    // [0, 2] should pick up the 0.5s and 1.0s detections, not the 5.0s one
    act(() => {
      result.current.addRegion(0);
    });

    const region = result.current.regions[0];
    expect(region.detections.map(d => d.timestamp)).toEqual([0.5, 1.0]);
    expect(region.videoWidth).toBe(1920);
    expect(region.videoHeight).toBe(1080);
    expect(region.fps).toBe(30);
  });

  it('delete then recreate a region over the SAME span re-shows its detections', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections(videoDetections);
    });

    act(() => {
      result.current.addRegion(0);
    });
    const firstRegionId = result.current.regions[0].id;
    expect(result.current.regions[0].detections.length).toBe(2);

    act(() => {
      result.current.deleteRegion(firstRegionId);
    });
    expect(result.current.regions.length).toBe(0);

    // videoDetections is untouched by delete -- it's video-level, not region-level
    act(() => {
      result.current.addRegion(0);
    });
    expect(result.current.regions.length).toBe(1);
    expect(result.current.regions[0].id).not.toBe(firstRegionId);
    expect(result.current.regions[0].detections.map(d => d.timestamp)).toEqual([0.5, 1.0]);
  });

  it('addRegion for a span with no detections gets an empty array, not undefined', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections(videoDetections);
    });

    // [2, 4] has no detections in the fixture
    act(() => {
      result.current.addRegion(2);
    });

    expect(result.current.regions[0].detections).toEqual([]);
  });

  it('addRegion before any videoDetections arrives does not crash and yields empty detections', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
    });

    act(() => {
      result.current.addRegion(0);
    });

    expect(result.current.regions[0].detections).toEqual([]);
    expect(result.current.regions[0].videoWidth).toBeNull();
  });

  it('restoreRegions is unaffected by videoDetections -- uses saved.detections as-is', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.setVideoDetections(videoDetections);
    });

    const savedRegions = [
      {
        id: 'region-from-backend',
        start_time: 0,
        end_time: 2,
        keyframes: [],
        // Backend-projected slice -- deliberately DIFFERENT from what a local
        // slice of `videoDetections` over [0,2] would produce, to prove
        // restoreRegions doesn't recompute it.
        detections: [{ timestamp: 0.5, frame: 15, boxes: [] }],
        videoWidth: 640,
        videoHeight: 1136,
        fps: 30,
      },
    ];

    act(() => {
      result.current.restoreRegions(savedRegions, 10);
    });

    expect(result.current.regions[0].detections).toEqual(savedRegions[0].detections);
    expect(result.current.regions[0].videoWidth).toBe(640);
  });
});

/**
 * T5649: dragging a region lever RE-SLICES detections to the new [start, end].
 *
 * Before T5649, `moveRegionStart`/`moveRegionEnd` returned `{...region,
 * startTime/endTime, keyframes}` and OMITTED `detections`, so the slice computed
 * once in `addRegion` stayed FROZEN. Dragging the begin lever from 3->0 never
 * pulled in the timestamp-0 detection (the "initial tracker box" never appeared).
 * These tests pin the gap the T5600 suite missed.
 */
describe('useHighlightRegions - lever drag re-slices detections (T5649)', () => {
  const videoMetadata = { width: 1920, height: 1080, fps: 30, duration: 10 };

  const videoDetections = {
    videoWidth: 1920,
    videoHeight: 1080,
    fps: 30,
    detections: [
      { timestamp: 0.0, frame: 0, boxes: [{ x: 0.1, y: 0.1 }] },   // the frame-0 tracker box
      { timestamp: 1.0, frame: 30, boxes: [{ x: 0.2, y: 0.2 }] },
      { timestamp: 3.5, frame: 105, boxes: [{ x: 0.3, y: 0.3 }] },
      { timestamp: 4.5, frame: 135, boxes: [{ x: 0.4, y: 0.4 }] },
      { timestamp: 6.0, frame: 180, boxes: [{ x: 0.5, y: 0.5 }] },
    ],
  };

  const setup = () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections(videoDetections);
    });
    return result;
  };

  it('moveRegionStart to 0 pulls in the frame-0 detection (begin lever bug)', () => {
    const result = setup();

    // Region [3, 5]: initial slice has 3.5 and 4.5, NOT the timestamp-0 box.
    act(() => { result.current.addRegion(3); });
    const regionId = result.current.regions[0].id;
    expect(result.current.regions[0].detections.map(d => d.timestamp)).toEqual([3.5, 4.5]);

    // Drag begin lever to 0 -> region becomes [0, 5] -> pulls in timestamp 0 and 1.0.
    act(() => { result.current.moveRegionStart(regionId, 0); });

    const region = result.current.regions[0];
    expect(region.startTime).toBe(0);
    // Matches the canonical slice for the NEW bounds.
    expect(region.detections).toEqual(
      sliceDetections(videoDetections, region.startTime, region.endTime)
    );
    expect(region.detections.map(d => d.timestamp)).toEqual([0.0, 1.0, 3.5, 4.5]);
    // Negative control: the frozen [3,5] slice would NOT contain the frame-0 box.
    expect(region.detections.map(d => d.timestamp)).not.toEqual([3.5, 4.5]);
  });

  it('moveRegionEnd shrink drops out-of-range detections', () => {
    const result = setup();

    // Region [3, 5]: detections 3.5, 4.5.
    act(() => { result.current.addRegion(3); });
    const regionId = result.current.regions[0].id;
    expect(result.current.regions[0].detections.map(d => d.timestamp)).toEqual([3.5, 4.5]);

    // Shrink end to 4 -> [3, 4] -> drops 4.5.
    act(() => { result.current.moveRegionEnd(regionId, 4); });

    const region = result.current.regions[0];
    expect(region.endTime).toBe(4);
    expect(region.detections).toEqual(
      sliceDetections(videoDetections, region.startTime, region.endTime)
    );
    expect(region.detections.map(d => d.timestamp)).toEqual([3.5]);
    // Negative control: the frozen slice still held 4.5.
    expect(region.detections.map(d => d.timestamp)).not.toContain(4.5);
  });

  it('moveRegionEnd grow pulls newly-covered detections in', () => {
    const result = setup();

    // Region [3, 5]: detections 3.5, 4.5.
    act(() => { result.current.addRegion(3); });
    const regionId = result.current.regions[0].id;

    // Grow end to 7 -> [3, 7] -> pulls in 6.0.
    act(() => { result.current.moveRegionEnd(regionId, 7); });

    const region = result.current.regions[0];
    expect(region.endTime).toBe(7);
    expect(region.detections.map(d => d.timestamp)).toEqual([3.5, 4.5, 6.0]);
  });

  it('re-slice honours the overlap-clamped start, not the requested one (regression)', () => {
    const result = setup();

    // Region A [0, 2], region B [3, 5].
    act(() => { result.current.addRegion(0); });
    act(() => { result.current.addRegion(3); });
    const regionB = result.current.regions.find(r => r.startTime === 3);

    // Request B start = 0, but prev region A ends at 2 -> clamp to 2.
    act(() => { result.current.moveRegionStart(regionB.id, 0); });

    const movedB = result.current.regions.find(r => r.id === regionB.id);
    // Overlap guard intact: start clamped to A.endTime, NOT the requested 0.
    expect(movedB.startTime).toBe(2);
    // Detections sliced to the CLAMPED [2, 5], so the timestamp-0 box is NOT included.
    expect(movedB.detections).toEqual(
      sliceDetections(videoDetections, 2, movedB.endTime)
    );
    expect(movedB.detections.map(d => d.timestamp)).not.toContain(0.0);
    expect(movedB.detections.map(d => d.timestamp)).toEqual([3.5, 4.5]);
  });

  it('lever drag with no videoDetections held yields empty detections, no crash', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => { result.current.initializeWithDuration(10); });
    act(() => { result.current.addRegion(3); });
    const regionId = result.current.regions[0].id;

    act(() => { result.current.moveRegionStart(regionId, 0); });
    expect(result.current.regions[0].detections).toEqual([]);

    act(() => { result.current.moveRegionEnd(regionId, 7); });
    expect(result.current.regions[0].detections).toEqual([]);
  });
});

describe('sliceDetections (T5600, Python mirror slice_detections)', () => {
  const videoDetections = {
    videoWidth: 100,
    videoHeight: 100,
    fps: 30,
    detections: [
      { timestamp: 0.5, frame: 15 },
      { timestamp: 1.0, frame: 30 },
      { timestamp: 2.05, frame: 61 },
      { timestamp: 5.0, frame: 150 },
    ],
  };

  it('includes only detections within [start, end]', () => {
    const sliced = sliceDetections(videoDetections, 0, 2);
    expect(sliced.map(d => d.timestamp)).toEqual([0.5, 1.0]);
  });

  it('includes boundary detections within the EPS tolerance', () => {
    // 2.05 is just past end=2.0 but within the default 0.04 epsilon window
    const sliced = sliceDetections(videoDetections, 0, 2.02, 0.04);
    expect(sliced.map(d => d.timestamp)).toEqual([0.5, 1.0, 2.05]);
  });

  it('returns an empty array for a null/missing payload', () => {
    expect(sliceDetections(null, 0, 2)).toEqual([]);
    expect(sliceDetections({}, 0, 2)).toEqual([]);
  });
});
