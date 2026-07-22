import { describe, it, expect } from 'vitest';
import {
  MAX_ROT,
  maxAxisAlignedInRotated,
  safeAreaForAspect,
  clampCropToSafeArea,
} from './rotationSafeArea';

/**
 * T5640 — rotation safe-area geometry (the "no black corners" clamp).
 *
 * These pin the shared spine that both the set-rotation clamp (useCrop) and the
 * crop-drag clamp (FramingContainer) depend on, plus the FE/BE sign convention.
 */
describe('maxAxisAlignedInRotated', () => {
  it('returns the full frame at theta = 0 (identity)', () => {
    expect(maxAxisAlignedInRotated(640, 360, 0)).toEqual({ width: 640, height: 360 });
  });

  it('is symmetric on a square at 45 degrees', () => {
    const { width, height } = maxAxisAlignedInRotated(100, 100, 45);
    // A square inscribed in a 45-degree-rotated square has side S / sqrt(2).
    expect(width).toBeCloseTo(height, 6);
    expect(width).toBeCloseTo(100 / Math.SQRT2, 4);
  });

  it('is sign-agnostic (theta and -theta give the same inscribed rect)', () => {
    const pos = maxAxisAlignedInRotated(640, 360, 12);
    const neg = maxAxisAlignedInRotated(640, 360, -12);
    expect(pos.width).toBeCloseTo(neg.width, 9);
    expect(pos.height).toBeCloseTo(neg.height, 9);
  });

  it('shrinks the inscribed rect as theta grows', () => {
    const small = maxAxisAlignedInRotated(640, 360, 3);
    const large = maxAxisAlignedInRotated(640, 360, 15);
    expect(large.width).toBeLessThan(small.width);
    expect(large.height).toBeLessThan(small.height);
    expect(small.width).toBeLessThan(640);
  });
});

describe('safeAreaForAspect', () => {
  it('is the centered full frame at theta = 0 when the aspect already matches', () => {
    // 640x360 is exactly 16:9, so the safe area is the whole frame, centered.
    const S = safeAreaForAspect(640, 360, 0, 16 / 9);
    expect(S.x0).toBeCloseTo(0, 6);
    expect(S.y0).toBeCloseTo(0, 6);
    expect(S.wSafe).toBeCloseTo(640, 6);
    expect(S.hSafe).toBeCloseTo(360, 6);
  });

  it('produces a box of exactly the target aspect', () => {
    const r = 9 / 16;
    const S = safeAreaForAspect(1920, 1080, 8, r);
    expect(S.wSafe / S.hSafe).toBeCloseTo(r, 6);
  });
});

describe('clampCropToSafeArea', () => {
  it('is an identity passthrough at theta = 0', () => {
    const crop = { x: 10, y: 20, width: 205, height: 365 };
    expect(clampCropToSafeArea(crop, 640, 360, 0, 9 / 16)).toEqual(crop);
  });

  it('shrinks and recenters an oversize crop while preserving aspect', () => {
    const r = 9 / 16;
    const W = 640;
    const H = 360;
    // Start from the whole-frame-height crop, which will exceed the inscribed
    // rect once the frame is rotated.
    const crop = { x: 0, y: 0, width: H * r, height: H };
    const clamped = clampCropToSafeArea(crop, W, H, 10, r);

    // Aspect preserved exactly.
    expect(clamped.width / clamped.height).toBeCloseTo(r, 6);

    // Shrunk (fits inside the inscribed rect).
    expect(clamped.height).toBeLessThan(crop.height);

    // Recentered inside the safe region and fully in-bounds.
    const S = safeAreaForAspect(W, H, 10, r);
    expect(clamped.x).toBeGreaterThanOrEqual(S.x0 - 1e-6);
    expect(clamped.y).toBeGreaterThanOrEqual(S.y0 - 1e-6);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(S.x0 + S.wSafe + 1e-6);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(S.y0 + S.hSafe + 1e-6);
  });

  it('leaves a crop already inside the safe area at its position', () => {
    const r = 9 / 16;
    const W = 640;
    const H = 360;
    const S = safeAreaForAspect(W, H, 6, r);
    // A tiny crop well within the safe region should not move.
    const crop = { x: S.x0 + 5, y: S.y0 + 5, width: S.wSafe / 4, height: S.wSafe / 4 / r };
    const clamped = clampCropToSafeArea(crop, W, H, 6, r);
    expect(clamped.x).toBeCloseTo(crop.x, 6);
    expect(clamped.y).toBeCloseTo(crop.y, 6);
    expect(clamped.width).toBeCloseTo(crop.width, 6);
  });

  it('exposes MAX_ROT = 20', () => {
    expect(MAX_ROT).toBe(20);
  });
});
