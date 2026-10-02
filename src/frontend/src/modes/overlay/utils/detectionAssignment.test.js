import { describe, it, expect } from 'vitest';
import {
  isDetectionAssigned,
  countDetectionAssignments,
  detectionAssignmentStates,
  detectableDetections,
  orderedDetectionMarkers,
  nextUnpickedMarker,
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

describe('orderedDetectionMarkers', () => {
  it('matches detectionAssignmentStates ordering (region start, then detection time)', () => {
    const later = { ...regionWith([boundary(0), boundary(90)]), id: 'r2', startTime: 10 };
    const earlier = { ...regionWith([boundary(0), boundary(90)]), id: 'r1', startTime: 0 };
    const markers = orderedDetectionMarkers([later, earlier]);
    expect(markers.map((m) => [m.regionId, m.detection.timestamp])).toEqual([
      ['r1', 1.0], ['r1', 2.0], ['r2', 1.0], ['r2', 2.0],
    ]);
  });
});

describe('nextUnpickedMarker', () => {
  it('starts at the first marker on entry (fromIndex -1) when nothing is picked', () => {
    const region = regionWith([boundary(0), boundary(90)]);
    expect(nextUnpickedMarker([region], -1)).toEqual({ index: 0, regionId: 'r1', region, detection: region.detections[0] });
  });

  it('advances forward to the next unpicked marker after the one just picked', () => {
    // marker 0 (1.0s) assigned, marker 1 (2.0s) not -> advancing from 0 lands on 1.
    const region = regionWith([boundary(0), userKf(30), boundary(90)]);
    expect(nextUnpickedMarker([region], 0)).toEqual({ index: 1, regionId: 'r1', region, detection: region.detections[1] });
  });

  it('wraps to the start once the last marker is picked', () => {
    // 4 markers across 2 regions, only marker 3 (last) unpicked after picking it via extraTime
    // is counted — picking marker N wraps to marker 1 (index 0) when earlier ones are unpicked.
    const r1 = { ...regionWith([boundary(0), boundary(90)]), id: 'r1', startTime: 0 }; // both unpicked
    const r2 = { ...regionWith([boundary(0), userKf(30), boundary(90)]), id: 'r2', startTime: 10 }; // 1.0s picked, 2.0s not
    // Order: r1@1.0(idx0,unpicked) r1@2.0(idx1,unpicked) r2@1.0(idx2,picked) r2@2.0(idx3,unpicked)
    // Picked marker index 2 (r2@1.0) -> forward search wraps past idx3(unpicked) -- but idx3 IS unpicked,
    // so it lands there first.
    expect(nextUnpickedMarker([r1, r2], 2)).toEqual({ index: 3, regionId: 'r2', region: r2, detection: r2.detections[1] });
    // Picking from the actual LAST index (3) wraps all the way to the first unpicked marker, index 0.
    expect(nextUnpickedMarker([r1, r2], 3)).toEqual({ index: 0, regionId: 'r1', region: r1, detection: r1.detections[0] });
  });

  it('counts an in-gesture pick via justAssigned so the walk advances past it immediately', () => {
    // Both markers unpicked in stored state; picking marker 0 this gesture (justAssigned)
    // must advance to marker 1, not re-park on marker 0.
    const region = regionWith([boundary(0), boundary(90)]);
    const result = nextUnpickedMarker([region], 0, { regionId: 'r1', time: 1.0 });
    expect(result).toEqual({ index: 1, regionId: 'r1', region, detection: region.detections[1] });
  });

  it('returns null once every marker is assigned — the walk is done', () => {
    const region = regionWith([boundary(0), userKf(30), userKf(60), boundary(90)]);
    expect(nextUnpickedMarker([region], 0)).toBeNull();
  });

  it('returns null when there are no markers at all', () => {
    expect(nextUnpickedMarker([], -1)).toBeNull();
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
