import { describe, it, expect } from 'vitest';
import {
  isDetectionAssigned,
  countDetectionAssignments,
  detectionAssignmentStates,
  detectableDetections,
} from './detectionAssignment';

// Keyframes are authored in 30fps space; helpers compare in time-space.
const boundary = (frame) => ({ frame }); // first/last keyframes are boundaries
const userKf = (frame) => ({ frame, fromDetection: true });

// A region with two detection frames at 1.0s and 2.0s, plus the two boundary keyframes.
const regionWith = (keyframes) => ({
  id: 'r1',
  keyframes,
  detections: [
    { timestamp: 1.0, frame: 30, boxes: [{}] },
    { timestamp: 2.0, frame: 60, boxes: [{}] },
  ],
});

describe('detectableDetections', () => {
  it('ignores detections without boxes', () => {
    const region = {
      detections: [
        { timestamp: 1, boxes: [{}] },
        { timestamp: 2, boxes: [] },
        { timestamp: 3 },
      ],
    };
    expect(detectableDetections(region)).toHaveLength(1);
  });
});

describe('isDetectionAssigned', () => {
  it('is false when only boundary keyframes exist', () => {
    const region = regionWith([boundary(30), boundary(60)]);
    expect(isDetectionAssigned(region, region.detections[0])).toBe(false);
  });

  it('is true when a user keyframe sits at the detection time', () => {
    // user keyframe at frame 30 == 1.0s
    const region = regionWith([boundary(0), userKf(30), boundary(90)]);
    expect(isDetectionAssigned(region, region.detections[0])).toBe(true);
  });

  it('tolerates small frame rounding (within ~5 frames)', () => {
    const region = regionWith([boundary(0), userKf(33), boundary(90)]); // 1.1s vs 1.0s
    expect(isDetectionAssigned(region, region.detections[0])).toBe(true);
  });

  it('does not match a keyframe far from the detection time', () => {
    const region = regionWith([boundary(0), userKf(45), boundary(90)]); // 1.5s vs 1.0s
    expect(isDetectionAssigned(region, region.detections[0])).toBe(false);
  });

  it('counts an in-gesture assignment via extraTime before its keyframe lands', () => {
    const region = regionWith([boundary(30), boundary(60)]);
    expect(isDetectionAssigned(region, region.detections[0], 1.0)).toBe(true);
  });

  it('counts an explicitly-assigned FIRST boundary keyframe (edge detection)', () => {
    // detection[0] at 1.0s == frame 30 sits on the region's first keyframe.
    // An unassigned boundary would not count, but fromDetection makes it count.
    const region = regionWith([userKf(30), boundary(60)]);
    expect(isDetectionAssigned(region, region.detections[0])).toBe(true);
  });

  it('counts an explicitly-assigned LAST boundary keyframe (edge detection)', () => {
    // detection[1] at 2.0s == frame 60 sits on the region's last keyframe.
    const region = regionWith([boundary(30), userKf(60)]);
    expect(isDetectionAssigned(region, region.detections[1])).toBe(true);
  });

  it('still ignores an UNassigned last boundary at the detection time', () => {
    const region = regionWith([userKf(30), boundary(60)]);
    expect(isDetectionAssigned(region, region.detections[1])).toBe(false);
  });
});

describe('detectionAssignmentStates', () => {
  it('returns per-detection flags in timeline order (gap shows the missed marker)', () => {
    // det 1.0s unassigned, det 2.0s assigned -> [false, true]
    const region = regionWith([boundary(0), userKf(60), boundary(90)]);
    expect(detectionAssignmentStates([region])).toEqual([false, true]);
  });

  it('orders detections across regions by region start then time', () => {
    const later = { ...regionWith([boundary(0), userKf(30), boundary(90)]), id: 'r2', startTime: 10 };
    const earlier = { ...regionWith([boundary(0), boundary(90)]), id: 'r1', startTime: 0 };
    // earlier region first (both its detections unassigned), then later region (1.0s assigned, 2.0s not)
    expect(detectionAssignmentStates([later, earlier])).toEqual([false, false, true, false]);
  });
});

describe('countDetectionAssignments', () => {
  it('requires every detection frame to be assigned', () => {
    // Only the 1.0s frame assigned -> 1 of 2.
    const region = regionWith([boundary(0), userKf(30), boundary(90)]);
    expect(countDetectionAssignments([region])).toEqual({ total: 2, assigned: 1 });
  });

  it('reaches all-assigned only when both frames have keyframes', () => {
    const region = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    expect(countDetectionAssignments([region])).toEqual({ total: 2, assigned: 2 });
  });

  it('folds the in-gesture assignment into the count', () => {
    // 2.0s already assigned in state; 1.0s assigned this gesture (not yet in state).
    const region = regionWith([boundary(0), userKf(60), boundary(90)]);
    const result = countDetectionAssignments([region], { regionId: 'r1', time: 1.0 });
    expect(result).toEqual({ total: 2, assigned: 2 });
  });

  it('sums across multiple regions', () => {
    const r1 = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    const r2 = { ...regionWith([boundary(0), boundary(90)]), id: 'r2' };
    expect(countDetectionAssignments([r1, r2])).toEqual({ total: 4, assigned: 2 });
  });
});
