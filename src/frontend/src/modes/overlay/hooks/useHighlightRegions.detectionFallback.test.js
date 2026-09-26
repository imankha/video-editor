import { describe, it, expect, beforeEach } from 'vitest';
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

  it('shows the notice only once per region across repeated code paths', () => {
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
    expect(fallbackToasts()).toHaveLength(1);

    // Re-hit the fallback branch for the SAME region id (a second restore + an
    // export read). The guard must keep it at a single toast, not spam pop-ins.
    act(() => {
      result.current.restoreRegions([savedRegion], 10);
      result.current.getRegionsForExport();
    });
    expect(fallbackToasts()).toHaveLength(1);
  });
});
