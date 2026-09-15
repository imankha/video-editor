import { describe, it, expect } from 'vitest';
import { maxFitCrop, wideFrameTarget, resizeAboutCenter, isWideFraming, WIDE_FRAME_SCALE } from './widenFraming';

// 1080p source, 9:16 output — the design doc's own worked example (T9950-design.md §9.2).
const VIDEO_W = 1920;
const VIDEO_H = 1080;
const ASPECT_9_16 = 9 / 16;
const DEFAULT_CROP_9_16 = { width: 205, height: 365 };

describe('widenFraming (T9950 Slice 2)', () => {
  describe('maxFitCrop', () => {
    it('fits the largest 9:16 rect inside a 1080p landscape source (even dims)', () => {
      const fit = maxFitCrop(VIDEO_W, VIDEO_H, ASPECT_9_16);
      expect(fit.height).toBe(1080);
      expect(fit.width).toBe(608); // matches design doc §9.2's benchmark table
      expect(fit.width % 2).toBe(0);
      expect(fit.height % 2).toBe(0);
    });

    it('returns zeroed dims for missing inputs', () => {
      expect(maxFitCrop(0, 1080, ASPECT_9_16)).toEqual({ width: 0, height: 0 });
      expect(maxFitCrop(1920, 1080, 0)).toEqual({ width: 0, height: 0 });
    });
  });

  describe('wideFrameTarget (§9.2 the ACTUAL widen target — 2x default, not max-fit)', () => {
    it('is 2x the default crop on a source large enough to afford it', () => {
      const target = wideFrameTarget(VIDEO_W, VIDEO_H, ASPECT_9_16, DEFAULT_CROP_9_16);
      expect(target).toEqual({ width: 410, height: 730 }); // 205*2, 365*2 — matches §9.2's table
      expect(WIDE_FRAME_SCALE).toBe(2);
    });

    it('clamps to maxFitCrop on a source too small for a full 2x scale', () => {
      // A tiny source where max-fit is smaller than 2x the default.
      const tinyW = 300;
      const tinyH = 170; // 300x170 -> max-fit 9:16 height=170, width~95.6->96
      const fit = maxFitCrop(tinyW, tinyH, ASPECT_9_16);
      const target = wideFrameTarget(tinyW, tinyH, ASPECT_9_16, DEFAULT_CROP_9_16);
      expect(target.width).toBeLessThanOrEqual(fit.width);
      expect(target.height).toBeLessThanOrEqual(fit.height);
      expect(target.width).toBe(fit.width);
      expect(target.height).toBe(fit.height);
    });
  });

  describe('resizeAboutCenter', () => {
    it('preserves the rect center when resizing', () => {
      const rect = { x: 800, y: 400, width: 205, height: 365 }; // center (902.5, 582.5)
      const resized = resizeAboutCenter(rect, 410, 730, VIDEO_W, VIDEO_H);
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const newCenterX = resized.x + resized.width / 2;
      const newCenterY = resized.y + resized.height / 2;
      expect(Math.abs(newCenterX - centerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(newCenterY - centerY)).toBeLessThanOrEqual(1);
    });

    it('clamps into source bounds when the center is near an edge', () => {
      const rect = { x: 0, y: 0, width: 205, height: 365 }; // top-left corner
      const resized = resizeAboutCenter(rect, 410, 730, VIDEO_W, VIDEO_H);
      expect(resized.x).toBeGreaterThanOrEqual(0);
      expect(resized.y).toBeGreaterThanOrEqual(0);
      expect(resized.x + resized.width).toBeLessThanOrEqual(VIDEO_W);
      expect(resized.y + resized.height).toBeLessThanOrEqual(VIDEO_H);
    });

    it('clamps into a shrunk rotation safe-area box the same way', () => {
      // Simulate a straighten-rotated safe area as a smaller effective source box —
      // resizeAboutCenter itself is rotation-agnostic (FocusContainer layers the
      // rotation safe-area clamp on top, design doc §3.2), but it must still keep
      // any given (targetW, targetH, boundsW, boundsH) call clamped correctly.
      const safeW = 1600;
      const safeH = 900;
      const rect = { x: 700, y: 380, width: 205, height: 365 };
      const resized = resizeAboutCenter(rect, 410, 730, safeW, safeH);
      expect(resized.x).toBeGreaterThanOrEqual(0);
      expect(resized.y).toBeGreaterThanOrEqual(0);
      expect(resized.x + resized.width).toBeLessThanOrEqual(safeW);
      expect(resized.y + resized.height).toBeLessThanOrEqual(safeH);
    });

    it('is idempotent: widening an already-wide rect to the same target is a no-op', () => {
      const rect = { x: 755, y: 175, width: 410, height: 730 };
      const resized = resizeAboutCenter(rect, 410, 730, VIDEO_W, VIDEO_H);
      expect(resized).toEqual({ x: rect.x, y: rect.y, width: 410, height: 730 });
    });
  });

  describe('isWideFraming', () => {
    const videoDims = { width: VIDEO_W, height: VIDEO_H };

    it('is false for keyframes at the default crop size', () => {
      const keyframes = [{ frame: 0, width: 205, height: 365 }];
      expect(isWideFraming(keyframes, videoDims, ASPECT_9_16, DEFAULT_CROP_9_16)).toBe(false);
    });

    it('is true for keyframes at the exact 2x wide-frame target', () => {
      const keyframes = [
        { frame: 0, width: 410, height: 730 },
        { frame: 100, width: 410, height: 730 },
      ];
      expect(isWideFraming(keyframes, videoDims, ASPECT_9_16, DEFAULT_CROP_9_16)).toBe(true);
    });

    it('is true within epsilon of the 2x target (server refit rounding)', () => {
      const keyframes = [{ frame: 0, width: 411, height: 729 }];
      expect(isWideFraming(keyframes, videoDims, ASPECT_9_16, DEFAULT_CROP_9_16, 0.01)).toBe(true);
    });

    it('is false if ANY keyframe is not at the wide target', () => {
      const keyframes = [
        { frame: 0, width: 410, height: 730 },
        { frame: 100, width: 205, height: 365 },
      ];
      expect(isWideFraming(keyframes, videoDims, ASPECT_9_16, DEFAULT_CROP_9_16)).toBe(false);
    });

    it('is false for max-fit keyframes (the widen button does not target max-fit)', () => {
      const fit = maxFitCrop(VIDEO_W, VIDEO_H, ASPECT_9_16);
      const keyframes = [{ frame: 0, width: fit.width, height: fit.height }];
      expect(isWideFraming(keyframes, videoDims, ASPECT_9_16, DEFAULT_CROP_9_16)).toBe(false);
    });

    it('is false for an empty keyframe list', () => {
      expect(isWideFraming([], videoDims, ASPECT_9_16, DEFAULT_CROP_9_16)).toBe(false);
    });
  });
});
