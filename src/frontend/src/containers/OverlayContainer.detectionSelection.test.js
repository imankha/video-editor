import { describe, expect, it } from 'vitest';
import { selectRegionDetection } from './OverlayContainer';

const boxes = [{ x: 1, y: 2, width: 3, height: 4 }];
const detection = (frame, withBoxes = false) => ({ frame, boxes: withBoxes ? boxes : [] });

describe('selectRegionDetection (T10950)', () => {
  it('uses a later non-empty sample when the opening sample is empty', () => {
    const result = selectRegionDetection([detection(0), detection(20, true)], 0, 30);
    expect(result.detection.frame).toBe(20);
  });

  it('keeps the closest in-threshold sample when it has boxes', () => {
    const result = selectRegionDetection([detection(0, true), detection(1, true)], 1, 30);
    expect(result.detection.frame).toBe(1);
  });

  it('falls back to the closest non-empty sample when the closest sample is empty', () => {
    const result = selectRegionDetection([detection(0, true), detection(2), detection(4, true)], 2, 30);
    expect(result.detection.frame).toBe(0);
  });

  it('does not fabricate boxes when every sample is empty', () => {
    const result = selectRegionDetection([detection(0), detection(20)], 0, 30);
    expect(result.detection).toBeNull();
  });

  it('only selects from the detections supplied for the active region', () => {
    const regionA = [detection(0), detection(20, true)];
    const regionB = [detection(0, true)];
    expect(selectRegionDetection(regionA, 0, 30).detection).toBe(regionA[1]);
    expect(selectRegionDetection(regionB, 0, 30).detection).toBe(regionB[0]);
  });

  it('does not affect clicked-detection priority (selection is bypassed by the caller)', () => {
    const clicked = { frame: 99, boxes };
    const result = selectRegionDetection([detection(0, true)], 0, 30);
    expect(clicked.boxes).toEqual(boxes);
    expect(result.detection.frame).toBe(0);
  });
});
