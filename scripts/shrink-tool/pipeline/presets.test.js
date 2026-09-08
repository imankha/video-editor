import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  REFERENCE_ENCODE_PIXELS_PER_SEC,
  resolveOutputSize,
  estimateOutputBytes,
  estimateShrinkSeconds,
  shouldOfferShrink,
} from './presets.js';

describe('resolveOutputSize', () => {
  it('never upscales: width caps at min(maxWidth, cropWidth)', () => {
    // crop narrower than the cap for every preset
    const crop = { w: 1280, h: 720 };
    for (const preset of Object.values(PRESETS)) {
      const { width, height } = resolveOutputSize(preset, crop.w, crop.h);
      expect(width).toBeLessThanOrEqual(crop.w);
      expect(width).toBeLessThanOrEqual(preset.maxWidth);
      expect(height).toBeLessThanOrEqual(crop.h);
    }
  });

  it('caps width at preset.maxWidth for a crop wider than the cap', () => {
    const { width, height } = resolveOutputSize(PRESETS.sharp, 7680, 4320);
    expect(width).toBe(3840);
    expect(height).toBe(2160); // 7680:4320 == 16:9, 3840*9/16 = 2160
  });

  it('both dimensions are always even', () => {
    // odd crop dims exercise the floor-to-even path
    const { width, height } = resolveOutputSize(PRESETS.small, 1921, 1081);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it('holds for both presets against the real 8K crop', () => {
    expect(resolveOutputSize(PRESETS.sharp, 7680, 4320)).toEqual({ width: 3840, height: 2160 });
    expect(resolveOutputSize(PRESETS.small, 7680, 4320)).toEqual({ width: 1920, height: 1080 });
  });
});

describe('estimateOutputBytes', () => {
  it('is bitrate * duration / 8, plus 2% overhead', () => {
    const bytes = estimateOutputBytes(PRESETS.sharp, 100);
    const expected = (24_000_000 * 100 / 8) * 1.02;
    expect(bytes).toBeCloseTo(expected, 6);
  });
});

describe('estimateShrinkSeconds', () => {
  it('matches the design doc pre-probe table for the real 50 GB DJI folder (69 min @ 8K)', () => {
    const durationSec = 69 * 60;
    const fps = 29.97;

    const sharpest = resolveOutputSize(PRESETS.sharp, 7680, 4320);
    const smallest = resolveOutputSize(PRESETS.small, 7680, 4320);

    const sharpSeconds = estimateShrinkSeconds({
      outWidth: sharpest.width, outHeight: sharpest.height, durationSec, fps,
      pixelsPerSecond: REFERENCE_ENCODE_PIXELS_PER_SEC,
    });
    const smallSeconds = estimateShrinkSeconds({
      outWidth: smallest.width, outHeight: smallest.height, durationSec, fps,
      pixelsPerSecond: REFERENCE_ENCODE_PIXELS_PER_SEC,
    });

    expect(sharpSeconds / 60).toBeCloseTo(92.7, 0);
    expect(smallSeconds / 60).toBeCloseTo(23.2, 0);
  });

  it('is one code path: pre-probe reference number and a measured number use the same formula', () => {
    const args = { outWidth: 2688, outHeight: 1512, durationSec: 60, fps: 30 };
    const reference = estimateShrinkSeconds({ ...args, pixelsPerSecond: REFERENCE_ENCODE_PIXELS_PER_SEC });
    const measured = estimateShrinkSeconds({ ...args, pixelsPerSecond: 90_000_000 });
    // Slower measured throughput -> a bigger estimate, same formula shape.
    expect(measured).toBeGreaterThan(reference);
  });
});

describe('shouldOfferShrink', () => {
  it('offers on the real DJI segment (17.2 GB, ~97 Mbps)', () => {
    expect(shouldOfferShrink({ totalBytes: 17.2e9, sourceBitrateBps: 97_150_000 })).toBe(true);
  });

  it('refuses the Legends file (bitrate below every preset, ~4.67 Mbps)', () => {
    expect(shouldOfferShrink({ totalBytes: 6e9, sourceBitrateBps: 4.67e6 })).toBe(false);
  });

  it('refuses a file under the byte floor even at a high bitrate', () => {
    expect(shouldOfferShrink({ totalBytes: 2.9e9, sourceBitrateBps: 20_000_000 })).toBe(false);
  });
});
