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


describe('useCrop updateAspectRatio (T3910)', () => {
  it('updates the ratio state without rewriting saved keyframes', () => {
    // Aspect-ratio change is a reel-level gesture: it re-fits crop server-side and the
    // re-fit boxes arrive via refreshed savedKeyframes. updateAspectRatio must NOT snap
    // the active clip's boxes back to the centered default (that discards framing).
    const { result } = renderHook(() => useCrop(METADATA, null, SAVED_KEYFRAMES));
    expect(result.current.keyframes.length).toBe(2);
    const before = result.current.keyframes.map(k => ({ ...k }));

    act(() => {
      result.current.updateAspectRatio('16:9');
    });

    expect(result.current.aspectRatio).toBe('16:9');
    expect(result.current.keyframes).toEqual(before);
  });

  it('uses the T10150 enlarged default sizes for a 1080p source', () => {
    // 9:16 -> 410x730, 16:9 -> 1280x720 (2x the pre-T10150 boxes, ~2x enlarge to
    // the 1440p-capped output instead of ~4x). These must mirror the backend
    // DEFAULT_CROP_SIZES (default_crop.py); parity is guarded by a backend test.
    const { result } = renderHook(() => useCrop(METADATA, null, null));
    expect(result.current.getCropDataAtTime(0)).toMatchObject({ width: 410, height: 730 });

    act(() => {
      result.current.updateAspectRatio('16:9');
    });
    expect(result.current.getCropDataAtTime(0)).toMatchObject({ width: 1280, height: 720 });
  });

  it('falls back to a fit-to-video default when the source is too small for the box', () => {
    // T10150: the enlarged 16:9 default (1280x720) does not fit a tiny source. The
    // default must clamp to the largest in-bounds 16:9 rectangle, never overflow.
    const tiny = { width: 320, height: 240, duration: 5, framerate: 30 };
    const { result } = renderHook(() => useCrop(tiny, null, null));

    act(() => {
      result.current.updateAspectRatio('16:9');
    });
    const crop = result.current.getCropDataAtTime(0);
    expect(crop.width).toBeLessThanOrEqual(320);
    expect(crop.height).toBeLessThanOrEqual(240);
    // Still 16:9 and positioned inside the frame.
    expect(Math.abs(crop.width / crop.height - 16 / 9)).toBeLessThan(0.02);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
  });

  it('changes the default-crop reticule shape for a clip with no keyframes', () => {
    // With no saved keyframes the reticule is driven by the default crop, which must
    // follow the new ratio so the preview matches what export will produce.
    const { result } = renderHook(() => useCrop(METADATA, null, null));
    const portrait = result.current.getCropDataAtTime(0);
    expect(portrait.width).toBeLessThan(portrait.height); // 9:16 default

    act(() => {
      result.current.updateAspectRatio('16:9');
    });

    const landscape = result.current.getCropDataAtTime(0);
    expect(landscape.width).toBeGreaterThan(landscape.height); // 16:9 default
  });
});
