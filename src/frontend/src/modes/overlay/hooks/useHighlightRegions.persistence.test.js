import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';

/**
 * T5644 — re-added region must persist via a surgical create_region gesture.
 *
 * Bug: OverlayScreen.wrappedAddHighlightRegion did
 *   `const id = addRegion(t); const region = highlightRegions.find(r => r.id === id)`
 * but `highlightRegions` is React state captured at render, and addRegion's
 * setState hasn't flushed within the same gesture tick — so `find` returned
 * undefined and the create_region POST never fired (delete -> re-add -> reload
 * showed 0 regions on the backend).
 *
 * Fix: addRegion RETURNS the new region object; the gesture handler dispatches the
 * surgical create from THAT object directly (no async-state re-read, no reactive
 * effect). These tests pin both halves: the return contract, and that the re-add
 * gesture fires create_region with the re-added region's own data.
 */
describe('useHighlightRegions - addRegion return contract (T5644)', () => {
  const videoMetadata = { width: 1920, height: 1080, fps: 30, duration: 10 };

  it('addRegion returns the new region OBJECT (id + startTime + endTime), not just an id', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => result.current.initializeWithDuration(10));

    let returned;
    act(() => { returned = result.current.addRegion(3); });

    expect(returned).toBeTruthy();
    expect(typeof returned).toBe('object');
    expect(typeof returned.id).toBe('string');
    expect(typeof returned.startTime).toBe('number');
    expect(typeof returned.endTime).toBe('number');
    // Matches what actually landed in state.
    const inState = result.current.regions[0];
    expect(returned.id).toBe(inState.id);
    expect(returned.startTime).toBe(inState.startTime);
    expect(returned.endTime).toBe(inState.endTime);
  });

  it('addRegion returns null when it cannot create (overlap) — gesture then persists nothing', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => result.current.initializeWithDuration(10));
    act(() => { result.current.addRegion(3); });      // [3,5]
    let overlapping;
    act(() => { overlapping = result.current.addRegion(3.5); }); // overlaps [3,5]
    expect(overlapping).toBeNull();
  });
});

describe('useHighlightRegions - re-add persistence gesture (T5644)', () => {
  const videoMetadata = { width: 1920, height: 1080, fps: 30, duration: 10 };
  const PROJECT_ID = 'proj-31';

  it('delete -> re-add fires create_region with the RE-ADDED region data (not stale/undefined)', () => {
    const createRegion = vi.fn();
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => result.current.initializeWithDuration(10));

    // Mirrors OverlayScreen.wrappedAddHighlightRegion EXACTLY: dispatch the surgical
    // create from the RETURNED region object — never from a re-read of `regions`.
    const addGesture = (clickTime) => {
      const newRegion = result.current.addRegion(clickTime);
      if (newRegion) {
        createRegion(PROJECT_ID, newRegion.startTime, newRegion.endTime, newRegion.id);
      }
      return newRegion;
    };

    // Initial add persists.
    let first;
    act(() => { first = addGesture(3); });
    expect(createRegion).toHaveBeenLastCalledWith(PROJECT_ID, first.startTime, first.endTime, first.id);

    // Delete gesture (the reported flow).
    act(() => result.current.deleteRegion(first.id));
    expect(result.current.regions).toHaveLength(0);

    // RE-ADD — this is what was silently NOT persisting before the fix.
    createRegion.mockClear();
    let readded;
    act(() => { readded = addGesture(3); });

    expect(readded).toBeTruthy();
    expect(readded.id).not.toBe(first.id); // genuinely a new region
    expect(createRegion).toHaveBeenCalledTimes(1);
    // Fired with concrete numeric bounds + the new id — the exact create_region payload.
    expect(createRegion).toHaveBeenLastCalledWith(
      PROJECT_ID,
      expect.any(Number),
      expect.any(Number),
      readded.id,
    );
    const [, startArg, endArg] = createRegion.mock.calls.at(-1);
    expect(startArg).toBe(readded.startTime);
    expect(endArg).toBe(readded.endTime);
    expect(endArg).toBeGreaterThan(startArg);
  });
});

/**
 * T5646 — re-added overlay region loses tracking boxes on a FRESH-EXPORT session.
 *
 * Root cause: OverlayScreen's fresh-export effect set the video-level detection
 * payload (`setVideoDetections`) and THEN called `reset()` to clear regions before
 * restore — and the old `reset()` nulled `videoDetections`. On a later delete->re-add,
 * `addRegion` sliced a null payload -> `detections:[]`, videoWidth/Height/fps null ->
 * no detection markers (desktop) and no on-video boxes (mobile).
 *
 * Fix: `reset()` clears only per-region state; the video-level payload survives.
 * These tests reproduce the fresh-export load ORDERING (set payload -> reset ->
 * restore) and pin that a subsequent add slices non-empty detections, while the
 * plain-reload ordering (no reset) stays green (regression guard).
 */
describe('useHighlightRegions - video-level detections survive reset (T5646)', () => {
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

  // Backend-projected slice for the restored region — deliberately different from a
  // local slice of `videoDetections`, to prove restore uses saved.detections as-is.
  const savedRegions = [
    {
      id: 'region-from-export',
      start_time: 0,
      end_time: 2,
      keyframes: [],
      detections: [{ timestamp: 0.5, frame: 15, boxes: [{ x: 0.9, y: 0.9 }] }],
      videoWidth: 1920,
      videoHeight: 1080,
      fps: 30,
    },
  ];

  it('reset() clears regions but does NOT null the video-level detection payload', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections(videoDetections);
    });
    expect(result.current.videoDetections).toEqual(videoDetections);

    act(() => { result.current.reset(); });

    // Regions/duration cleared...
    expect(result.current.regions).toHaveLength(0);
    expect(result.current.duration).toBeNull();
    // ...but the video-level payload survives (the T5646 contract).
    expect(result.current.videoDetections).toEqual(videoDetections);
  });

  it('fresh-export ordering (setVideoDetections -> reset -> restore) leaves detections sliceable; re-add gets non-empty detections', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    // Reproduce OverlayScreen's fresh-export effect ordering EXACTLY.
    act(() => {
      result.current.setVideoDetections(videoDetections); // set payload first
      result.current.reset();                             // clear regions before restore
      result.current.restoreRegions(savedRegions, 10);    // rehydrate from backend
    });

    // Payload survived the reset.
    expect(result.current.videoDetections).toEqual(videoDetections);
    // Restored (initial) region keeps its backend-projected slice.
    expect(result.current.regions[0].detections).toEqual(savedRegions[0].detections);

    // Now the reported flow: delete the restored region, then re-add over its span.
    act(() => { result.current.deleteRegion(result.current.regions[0].id); });
    expect(result.current.regions).toHaveLength(0);

    let readded;
    act(() => { readded = result.current.addRegion(0); }); // [0, 2]

    expect(readded).toBeTruthy();
    // Sliced from the still-held video-level payload — NON-EMPTY -> markers + boxes appear.
    expect(result.current.regions[0].detections.map(d => d.timestamp)).toEqual([0.5, 1.0]);
    expect(result.current.regions[0].detections.length).toBeGreaterThan(0);
    expect(result.current.regions[0].videoWidth).toBe(1920);
    expect(result.current.regions[0].videoHeight).toBe(1080);
    expect(result.current.regions[0].fps).toBe(30);
  });

  it('regression: plain-reload ordering (setVideoDetections -> restore, no reset) still slices on re-add', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    // Plain-reload effect ordering: no resetHighlightRegions() call.
    act(() => {
      result.current.setVideoDetections(videoDetections);
      result.current.restoreRegions(savedRegions, 10);
    });

    expect(result.current.videoDetections).toEqual(videoDetections);

    act(() => { result.current.deleteRegion(result.current.regions[0].id); });
    let readded;
    act(() => { readded = result.current.addRegion(0); });

    expect(readded).toBeTruthy();
    expect(result.current.regions[0].detections.map(d => d.timestamp)).toEqual([0.5, 1.0]);
  });
});
