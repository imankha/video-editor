import { describe, it, expect } from 'vitest';
import {
  pickPrimaryDetectionBox,
  detectionBoxesNearestTime,
  highlightFromDetectionBox,
  scoreDetectionBox,
  SPOTLIGHT_RADIUS_SCALE,
} from './primaryDetection';

/**
 * Bug 38 (glitch 2): the auto/pre-selected spotlight must choose the MAIN
 * CENTERED + prominent player, not the geometric frame center, and must not
 * fabricate a pick when detections are absent.
 */
describe('pickPrimaryDetectionBox', () => {
  const W = 1920;
  const H = 1080;

  it('picks the centered box over an off-center, higher-confidence one', () => {
    const centered = { x: 960, y: 540, width: 200, height: 400, confidence: 0.55 };
    const edgeHighConf = { x: 120, y: 100, width: 200, height: 400, confidence: 0.99 };

    const pick = pickPrimaryDetectionBox([edgeHighConf, centered], W, H);
    expect(pick).toBe(centered);
  });

  it('centered + prominent beats an off-center box even if the off-center is bigger', () => {
    const centeredModest = { x: 980, y: 520, width: 220, height: 420, confidence: 0.6 };
    const cornerHuge = { x: 200, y: 180, width: 500, height: 700, confidence: 0.9 };

    const pick = pickPrimaryDetectionBox([cornerHuge, centeredModest], W, H);
    expect(pick).toBe(centeredModest);
  });

  it('among similarly-centered boxes, the more prominent (larger) one wins', () => {
    const small = { x: 950, y: 545, width: 120, height: 240, confidence: 0.7 };
    const large = { x: 970, y: 535, width: 260, height: 520, confidence: 0.5 };

    const pick = pickPrimaryDetectionBox([small, large], W, H);
    expect(pick).toBe(large);
  });

  it('breaks exact score ties by confidence', () => {
    // Two boxes mirrored across center -> identical center distance + area.
    const a = { x: 860, y: 540, width: 200, height: 300, confidence: 0.4 };
    const b = { x: 1060, y: 540, width: 200, height: 300, confidence: 0.8 };

    expect(scoreDetectionBox(a, W, H)).toBeCloseTo(scoreDetectionBox(b, W, H), 10);
    const pick = pickPrimaryDetectionBox([a, b], W, H);
    expect(pick).toBe(b);
  });

  it('returns null for an empty / missing detection set (no fabricated pick)', () => {
    expect(pickPrimaryDetectionBox([], W, H)).toBeNull();
    expect(pickPrimaryDetectionBox(null, W, H)).toBeNull();
    expect(pickPrimaryDetectionBox(undefined, W, H)).toBeNull();
  });

  it('returns null when frame dimensions are unknown', () => {
    const box = { x: 960, y: 540, width: 200, height: 400 };
    expect(pickPrimaryDetectionBox([box], 0, H)).toBeNull();
    expect(pickPrimaryDetectionBox([box], W, undefined)).toBeNull();
  });

  it('skips malformed boxes (non-numeric coords / non-positive size)', () => {
    const good = { x: 960, y: 540, width: 200, height: 400, confidence: 0.5 };
    const bad1 = { x: 'x', y: 540, width: 200, height: 400 };
    const bad2 = { x: 960, y: 540, width: 0, height: 400 };
    const pick = pickPrimaryDetectionBox([bad1, bad2, good], W, H);
    expect(pick).toBe(good);
  });
});

describe('detectionBoxesNearestTime', () => {
  const detections = [
    { timestamp: 0.0, frame: 0, boxes: [{ x: 1, y: 1 }] },
    { timestamp: 1.0, frame: 30, boxes: [{ x: 2, y: 2 }] },
    { timestamp: 2.0, frame: 60, boxes: [{ x: 3, y: 3 }] },
  ];

  it('returns the boxes of the detection nearest the given time', () => {
    expect(detectionBoxesNearestTime(detections, 0.9)).toEqual([{ x: 2, y: 2 }]);
    expect(detectionBoxesNearestTime(detections, 1.9)).toEqual([{ x: 3, y: 3 }]);
  });

  it('falls back to frame/fps when timestamp is absent', () => {
    const noTs = [{ frame: 60, boxes: [{ x: 9, y: 9 }] }];
    expect(detectionBoxesNearestTime(noTs, 2.0, 30)).toEqual([{ x: 9, y: 9 }]);
  });

  it('returns [] for empty input', () => {
    expect(detectionBoxesNearestTime([], 1)).toEqual([]);
    expect(detectionBoxesNearestTime(null, 1)).toEqual([]);
  });
});

describe('highlightFromDetectionBox', () => {
  it('builds an ellipse padded by the manual-pick scale (1.3x)', () => {
    const box = { x: 960, y: 540, width: 200, height: 400 };
    expect(highlightFromDetectionBox(box)).toEqual({
      x: 960,
      y: 540,
      radiusX: (200 / 2) * SPOTLIGHT_RADIUS_SCALE,
      radiusY: (400 / 2) * SPOTLIGHT_RADIUS_SCALE,
    });
  });

  it('returns null for a null box', () => {
    expect(highlightFromDetectionBox(null)).toBeNull();
  });
});
