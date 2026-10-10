import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';
import { useToastStore } from '../../../components/shared/Toast';

/**
 * T12280: the "Couldn't auto-detect your athlete" toast (T10870) is gone: it fired
 * during auto-select, before any spotlight existed, and implied AI detection. The
 * region still degrades to the centered default (no fabricated box); the guided
 * pick walk tells the user to drag the circle.
 */
describe('useHighlightRegions detection fallback (T12280)', () => {
  const W = 1920;
  const H = 1080;
  const videoMetadata = { width: W, height: H, fps: 30, duration: 10 };

  beforeEach(() => {
    useToastStore.getState().clearAll();
  });

  it('falls back to the centered default with no toast when detections have no usable box', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));
    act(() => {
      result.current.restoreRegions(
        [{
          id: 'r-nofit', start_time: 0.0, end_time: 2.0, keyframes: [],
          detections: [{ timestamp: 0.0, frame: 0, boxes: [] }],
          videoWidth: W, videoHeight: H, fps: 30,
        }],
        10
      );
    });
    const hl = result.current.getHighlightAtTime(1.0);
    expect(hl.x).toBe(Math.round(W / 2));
    expect(hl.y).toBe(Math.round(H / 2));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
