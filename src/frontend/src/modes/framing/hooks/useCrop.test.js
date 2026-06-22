/**
 * Tests for useCrop hook keyframe initialization and restoration.
 *
 * Bug 19p: the crop reticule disappeared because the hook could end up with
 * ZERO keyframes after a reset — interpolation returns null for an empty
 * array, so CropOverlay renders nothing. Two suppression paths caused it:
 * 1. The savedKeyframes restore effect deduped on a ref and never re-ran
 *    after reset() wiped the controller.
 * 2. Auto-initialization was skipped whenever trimRange was set, so a clip
 *    with a saved trim but no saved crop keyframes never got defaults.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCrop from './useCrop';

const METADATA = { width: 1920, height: 1080, duration: 34.7, framerate: 30 };

const SAVED_KEYFRAMES = [
  { frame: 0, x: 100, y: 50, width: 205, height: 365, origin: 'permanent' },
  { frame: 1041, x: 300, y: 80, width: 205, height: 365, origin: 'permanent' },
];

describe('useCrop keyframe initialization', () => {
  it('auto-initializes a single default keyframe when no saved keyframes and no trim', () => {
    // Flat-list model: one keyframe at frame 0 defines the crop for the whole clip
    // (interpolation clamps). No forced end keyframe.
    const { result } = renderHook(() => useCrop(METADATA, null, null));

    expect(result.current.keyframes.length).toBe(1);
    expect(result.current.keyframes[0].frame).toBe(0);
  });

  it('auto-initializes a default keyframe when trimRange is set but no keyframes are saved (bug 19p)', () => {
    // Reel clips can have a trim/speed saved with empty crop_data — the crop
    // must still initialize or the reticule never renders. Trim is virtual, so
    // init is unaffected by trimRange.
    const trimRange = { start: 0, end: 11.389 };
    const { result } = renderHook(() => useCrop(METADATA, trimRange, null));

    expect(result.current.keyframes.length).toBeGreaterThanOrEqual(1);
    expect(result.current.keyframes[0].frame).toBe(0);
  });

  it('restores saved keyframes', () => {
    const { result } = renderHook(() => useCrop(METADATA, null, SAVED_KEYFRAMES));

    expect(result.current.keyframes.length).toBe(2);
    expect(result.current.keyframes[0].x).toBe(100);
    expect(result.current.keyframes[1].x).toBe(300);
  });

  it('re-restores saved keyframes after reset, even with an unchanged savedKeyframes prop (bug 19p)', () => {
    // Simulates clip switching A -> B -> A: returning to A re-renders with the
    // same savedKeyframes key, and the clip-switch effect's resetCrop() must
    // not leave the hook permanently empty.
    const { result } = renderHook(() => useCrop(METADATA, null, SAVED_KEYFRAMES));
    expect(result.current.keyframes.length).toBe(2);

    act(() => {
      result.current.reset();
    });

    expect(result.current.keyframes.length).toBe(2);
    expect(result.current.keyframes[0].x).toBe(100);
    expect(result.current.keyframes[1].x).toBe(300);
  });

  it('re-initializes defaults after reset when the clip has a trim but no saved keyframes (bug 19p)', () => {
    const trimRange = { start: 0, end: 11.389 };
    const { result } = renderHook(() => useCrop(METADATA, trimRange, null));
    expect(result.current.keyframes.length).toBeGreaterThanOrEqual(1);

    act(() => {
      result.current.reset();
    });

    expect(result.current.keyframes.length).toBeGreaterThanOrEqual(1);
  });

  it('does not auto-initialize when saved keyframes are provided', () => {
    const { result } = renderHook(() => useCrop(METADATA, null, SAVED_KEYFRAMES));

    // Saved keyframes win over defaults (default crop is centered, saved is not)
    expect(result.current.keyframes[0].x).toBe(100);
  });
});
