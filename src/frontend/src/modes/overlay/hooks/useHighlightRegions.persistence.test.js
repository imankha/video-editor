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
