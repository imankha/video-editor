import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';
import { useToastStore } from '../../../components/shared/Toast';
import { SPOTLIGHT_DETECTION_FALLBACK_TOAST } from '../../../config/displayNames';

/**
 * T10870: auto-spotlight surfaces a user-facing notice when it TRIED the region's
 * player detections but found no usable bounding box (e.g. a dim/dusk clip) and
 * fell back to the neutral centered default. This must fire ONLY on the
 * "we tried and failed" branch, ONCE per region -- never when a real box was
 * used and never when the region had no detections to try.
 */
describe('useHighlightRegions detection fallback notice (T10870)', () => {
  const W = 1920;
  const H = 1080;
  const videoMetadata = { width: W, height: H, fps: 30, duration: 10 };

  // A real, usable centered detection box (the happy path).
  const usableBox = { x: 1000, y: 560, width: 240, height: 480, confidence: 0.5 };
  const usableDetection = { timestamp: 0.0, frame: 0, boxes: [usableBox] };

  // Detection RAN at this timestamp but produced no usable box -- the exact
  // dim/dusk case: an entry with an empty boxes array.
  const emptyBoxDetection = { timestamp: 0.0, frame: 0, boxes: [] };

  const fallbackToasts = () =>
    useToastStore
      .getState()
      .toasts.filter((t) => t.title === SPOTLIGHT_DETECTION_FALLBACK_TOAST.title);

  beforeEach(() => {
    useToastStore.getState().clearAll();
  });

  it('shows the notice when detections exist but no usable box is found', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions(
        [
          {
            id: 'r-nofit',
            start_time: 0.0,
            end_time: 2.0,
            keyframes: [], // forces the auto-default seed path
            detections: [emptyBoxDetection],
            videoWidth: W,
            videoHeight: H,
            fps: 30,
          },
        ],
        10
      );
    });

    const toasts = fallbackToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('info');
    expect(toasts[0].message).toBe(SPOTLIGHT_DETECTION_FALLBACK_TOAST.message);
    // Falls back to the geometric center (honest neutral default).
    const hl = result.current.getHighlightAtTime(1.0);
    expect(hl.x).toBe(Math.round(W / 2));
    expect(hl.y).toBe(Math.round(H / 2));
  });

  it('does NOT show the notice when a real detection box was used', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions(
        [
          {
            id: 'r-ok',
            start_time: 0.0,
            end_time: 2.0,
            keyframes: [],
            detections: [usableDetection],
            videoWidth: W,
            videoHeight: H,
            fps: 30,
          },
        ],
        10
      );
    });

    // Sanity: the box was actually used (auto-pick landed on it).
    const hl = result.current.getHighlightAtTime(1.0);
    expect(hl.x).toBe(usableBox.x);
    expect(fallbackToasts()).toHaveLength(0);
  });

  it('does NOT show the notice when the region had zero detections', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions(
        [
          {
            id: 'r-none',
            start_time: 0.0,
            end_time: 2.0,
            keyframes: [],
            detections: [], // nothing was ever detected to try
            videoWidth: W,
            videoHeight: H,
            fps: 30,
          },
        ],
        10
      );
    });

    // Still degrades to the centered default, but silently (same as before).
    const hl = result.current.getHighlightAtTime(1.0);
    expect(hl.x).toBe(Math.round(W / 2));
    expect(fallbackToasts()).toHaveLength(0);
  });

  it('does not re-fire (or reset the dismiss timer of) an already-shown notice on repeat hits', () => {
    // dedupKey alone only prevents STACKING (array length), not a repeat POP-IN:
    // Toast.jsx's addToast replaces same-dedupKey toasts in place, so array
    // length would read 1 either way -- that assertion alone can't tell "the
    // guard fired zero extra times" from "the guard fired N times and each one
    // just overwrote the last". A real repeat fire is observable as (a) a second
    // addToast CALL (which restarts the 5s auto-dismiss timer, silently
    // resurrecting a toast the user already dismissed) and (b) a NEW toast id.
    // Spy on addToast + track id stability to actually distinguish "guarded" from
    // "unguarded but coincidentally deduped".
    const addToastSpy = vi.spyOn(useToastStore.getState(), 'addToast');

    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    const savedRegion = {
      id: 'r-nofit',
      start_time: 0.0,
      end_time: 2.0,
      keyframes: [],
      detections: [emptyBoxDetection],
      videoWidth: W,
      videoHeight: H,
      fps: 30,
    };

    act(() => {
      result.current.restoreRegions([savedRegion], 10);
    });
    expect(addToastSpy).toHaveBeenCalledTimes(1);
    const firstToastId = fallbackToasts()[0].id;

    // Re-hit the fallback branch for the SAME region id via a second restore
    // AND an export read. addToast must NOT be called again, and the toast's id
    // must be unchanged (a second call would replace it with a new id/timer via
    // the dedupKey path, even though array length would still read 1).
    act(() => {
      result.current.restoreRegions([savedRegion], 10);
      result.current.getRegionsForExport();
    });
    expect(addToastSpy).toHaveBeenCalledTimes(1);
    expect(fallbackToasts()).toHaveLength(1);
    expect(fallbackToasts()[0].id).toBe(firstToastId);

    addToastSpy.mockRestore();
  });
});
