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
  it('does NOT seed a keyframe on open, but exposes the default crop for the reticule', () => {
    // Flat-list model: opening a clip creates no keyframe. The reticule renders
    // the default centered crop via getCropDataAtTime/interpolateCrop fallback,
    // and the first keyframe is created only when the user edits the box.
    const { result } = renderHook(() => useCrop(METADATA, null, null));

    expect(result.current.keyframes.length).toBe(0);
    const crop = result.current.getCropDataAtTime(0);
    expect(crop).toBeTruthy();
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
    // Matches the GPU export default (centered 9:16 crop)
    expect(result.current.interpolateCrop(0)).toMatchObject({ width: crop.width, height: crop.height });
  });

  it('does NOT seed a keyframe when trimRange is set but no keyframes are saved', () => {
    // Reel clips can have a trim/speed saved with empty crop_data. Trim is virtual
    // and init seeds nothing; the reticule still renders via the default fallback.
    const trimRange = { start: 0, end: 11.389 };
    const { result } = renderHook(() => useCrop(METADATA, trimRange, null));

    expect(result.current.keyframes.length).toBe(0);
    expect(result.current.getCropDataAtTime(0)).toBeTruthy();
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

  it('keeps the default crop available after reset when the clip has a trim but no saved keyframes', () => {
    const trimRange = { start: 0, end: 11.389 };
    const { result } = renderHook(() => useCrop(METADATA, trimRange, null));
    expect(result.current.keyframes.length).toBe(0);
    expect(result.current.getCropDataAtTime(0)).toBeTruthy();

    act(() => {
      result.current.reset();
    });

    expect(result.current.getCropDataAtTime(0)).toBeTruthy();
  });

  it('does not auto-initialize when saved keyframes are provided', () => {
    const { result } = renderHook(() => useCrop(METADATA, null, SAVED_KEYFRAMES));

    // Saved keyframes win over defaults (default crop is centered, saved is not)
    expect(result.current.keyframes[0].x).toBe(100);
  });
});
