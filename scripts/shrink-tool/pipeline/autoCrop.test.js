import { describe, it, expect } from 'vitest';
import { suggestCropFromFrames, computeCellVariance } from './autoCrop.js';

const WIDTH = 240;
const HEIGHT = 120; // 24x12 at a 10px cell for easy exact-cell math with the default 24x14 grid? see note below

/** Solid RGBA frame of one gray level. */
function solidFrame(width, height, gray) {
  const frame = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frame.length; i += 4) {
    frame[i] = frame[i + 1] = frame[i + 2] = gray;
    frame[i + 3] = 255;
  }
  return frame;
}

/** Same as solidFrame, but a rectangular region (in pixel coords) is a different gray. */
function frameWithPatch(width, height, baseGray, patch, patchGray) {
  const frame = solidFrame(width, height, baseGray);
  for (let y = patch.y0; y < patch.y1; y++) {
    for (let x = patch.x0; x < patch.x1; x++) {
      const p = (y * width + x) * 4;
      frame[p] = frame[p + 1] = frame[p + 2] = patchGray;
    }
  }
  return frame;
}

describe('suggestCropFromFrames', () => {
  it('returns null for fewer than 2 frames', () => {
    expect(suggestCropFromFrames([solidFrame(WIDTH, HEIGHT, 100)], WIDTH, HEIGHT)).toBeNull();
    expect(suggestCropFromFrames([], WIDTH, HEIGHT)).toBeNull();
  });

  it('returns null when nothing changes across the samples (fully static clip)', () => {
    const frames = [solidFrame(WIDTH, HEIGHT, 80), solidFrame(WIDTH, HEIGHT, 80), solidFrame(WIDTH, HEIGHT, 80)];
    expect(suggestCropFromFrames(frames, WIDTH, HEIGHT)).toBeNull();
  });

  it('finds a moving patch confined to the middle of the frame, ignoring a static border', () => {
    // A bright "player" patch that appears in a different spot in each sample --
    // the union of its positions should drive the suggested bbox, while the static
    // top strip (sky) and bottom strip (empty field) stay out of it.
    const patchPositions = [
      { x0: 80, x1: 120, y0: 50, y1: 70 },
      { x0: 140, x1: 180, y0: 55, y1: 75 },
      { x0: 60, x1: 100, y0: 45, y1: 65 },
      { x0: 100, x1: 140, y0: 60, y1: 80 },
    ];
    const frames = patchPositions.map((p) => frameWithPatch(WIDTH, HEIGHT, 40, p, 220));

    const crop = suggestCropFromFrames(frames, WIDTH, HEIGHT);
    expect(crop).not.toBeNull();

    // The whole union of patch positions spans x:[60,180) y:[45,80) out of 240x120 --
    // roughly the middle third vertically. The suggested crop should be a strict
    // subset of the frame and should NOT include the very top (sky, y<45) or the
    // very bottom (dead field, y>=80) with any real margin.
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThan(0.1); // top strip excluded
    expect(crop.y + crop.h).toBeLessThan(0.9); // bottom strip excluded
    expect(crop.w).toBeGreaterThan(0);
    expect(crop.h).toBeGreaterThan(0);
  });

  it('never returns a rect narrower than the 10% minimum on either axis', () => {
    // A single-cell-sized patch, changing in exactly one place -- the raw bbox
    // would be much smaller than 10% of the frame on both axes.
    const patch = { x0: 118, x1: 122, y0: 58, y1: 62 };
    const frames = [
      frameWithPatch(WIDTH, HEIGHT, 50, patch, 250),
      solidFrame(WIDTH, HEIGHT, 50),
    ];
    const crop = suggestCropFromFrames(frames, WIDTH, HEIGHT);
    expect(crop).not.toBeNull();
    expect(crop.w).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(crop.h).toBeGreaterThanOrEqual(0.1 - 1e-9);
  });

  it('the whole rect always stays within the 0..1 frame', () => {
    const patch = { x0: 0, x1: 20, y0: 0, y1: 20 }; // hugs a corner
    const frames = [frameWithPatch(WIDTH, HEIGHT, 50, patch, 250), solidFrame(WIDTH, HEIGHT, 50)];
    const crop = suggestCropFromFrames(frames, WIDTH, HEIGHT);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.w).toBeLessThanOrEqual(1);
    expect(crop.y + crop.h).toBeLessThanOrEqual(1);
  });
});

describe('computeCellVariance', () => {
  it('is zero everywhere for identical frames', () => {
    const frames = [solidFrame(WIDTH, HEIGHT, 90), solidFrame(WIDTH, HEIGHT, 90)];
    const variance = computeCellVariance(frames, WIDTH, HEIGHT, 8, 6);
    expect(Array.from(variance).every((v) => v === 0)).toBe(true);
  });

  it('is higher in a cell that changes than in one that does not', () => {
    const patch = { x0: 0, x1: 30, y0: 0, y1: 20 }; // confined to the top-left cell of an 8x6 grid over 240x120
    const frames = [frameWithPatch(WIDTH, HEIGHT, 50, patch, 250), solidFrame(WIDTH, HEIGHT, 50)];
    const variance = computeCellVariance(frames, WIDTH, HEIGHT, 8, 6);
    const topLeftCell = variance[0];
    const bottomRightCell = variance[variance.length - 1];
    expect(topLeftCell).toBeGreaterThan(bottomRightCell);
  });
});
