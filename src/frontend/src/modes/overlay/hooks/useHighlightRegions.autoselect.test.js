import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useHighlightRegions from './useHighlightRegions';

/**
 * Bug 38 (glitch 2): the auto/pre-selected spotlight must land on the MAIN
 * CENTERED player from the region's YOLO detections, not the geometric frame
 * center. Covers the two live auto-select sites: restoreRegions (backend
 * regions arrive with `keyframes: []` + detections) and addRegion (interactive
 * timeline click after the video-level detection payload is held).
 */
describe('useHighlightRegions auto-select main centered player (bug 38 glitch 2)', () => {
  const W = 1920;
  const H = 1080;
  const videoMetadata = { width: W, height: H, fps: 30, duration: 10 };

  // Two detected players at region start: a centered subject and an off-center
  // bystander with HIGHER confidence. The centered one must win.
  // Near-center (but not EXACTLY frame center) so the "not the frame-center
  // default" assertions are meaningful.
  const centered = { x: 1000, y: 560, width: 240, height: 480, confidence: 0.5 };
  const bystander = { x: 200, y: 150, width: 240, height: 480, confidence: 0.98 };
  const startDetection = { timestamp: 0.0, frame: 0, boxes: [bystander, centered] };

  const centerFrame = { x: W / 2, y: H / 2 }; // the OLD (buggy) default position

  it('restoreRegions seeds keyframes on the centered player, not frame center', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions([
        {
          id: 'r1',
          start_time: 0.0,
          end_time: 2.0,
          keyframes: [], // backend delivers empty keyframes + detections
          detections: [startDetection],
          videoWidth: W,
          videoHeight: H,
          fps: 30,
        },
      ], 10);
    });

    const hl = result.current.getHighlightAtTime(1.0);
    expect(hl).toBeTruthy();
    // Lands on the centered player's box center...
    expect(hl.x).toBe(centered.x);
    expect(hl.y).toBe(centered.y);
    // ...padded by the manual-pick 1.3x scale, NOT the frame-center default.
    expect(hl.radiusX).toBeCloseTo((centered.width / 2) * 1.3, 6);
    expect(hl.x).not.toBe(centerFrame.x);
  });

  it('addRegion seeds the new region on the centered player', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.initializeWithDuration(10);
      result.current.setVideoDetections({
        videoWidth: W,
        videoHeight: H,
        fps: 30,
        detections: [startDetection],
      });
    });

    act(() => {
      result.current.addRegion(0);
    });

    const hl = result.current.getHighlightAtTime(0.5);
    expect(hl.x).toBe(centered.x);
    expect(hl.y).toBe(centered.y);
    expect(hl.x).not.toBe(centerFrame.x);
  });

  it('getRegionsForExport carries the centered-player spotlight (preview == export)', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions([
        {
          id: 'r1',
          start_time: 0.0,
          end_time: 2.0,
          keyframes: [],
          detections: [startDetection],
          videoWidth: W,
          videoHeight: H,
          fps: 30,
        },
      ], 10);
    });

    const exported = result.current.getRegionsForExport();
    expect(exported).toHaveLength(1);
    const kfs = exported[0].keyframes;
    expect(kfs.length).toBeGreaterThan(0);
    expect(kfs[0].x).toBe(centered.x);
    expect(kfs[0].y).toBe(centered.y);
  });

  it('degrades to a neutral centered default (no fabricated box) when detections are absent', () => {
    const { result } = renderHook(() => useHighlightRegions(videoMetadata));

    act(() => {
      result.current.restoreRegions([
        {
          id: 'r1',
          start_time: 0.0,
          end_time: 2.0,
          keyframes: [],
          detections: [], // no players detected
          videoWidth: W,
          videoHeight: H,
          fps: 30,
        },
      ], 10);
    });

    const hl = result.current.getHighlightAtTime(1.0);
    // Falls back to the geometric frame center — an honest neutral default,
    // not an arbitrary detection box.
    expect(hl.x).toBe(Math.round(W / 2));
    expect(hl.y).toBe(Math.round(H / 2));
  });
});
