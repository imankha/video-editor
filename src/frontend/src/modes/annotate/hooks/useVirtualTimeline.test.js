import { describe, it, expect } from 'vitest';
import { buildVirtualTimeline, buildFullVideoTimeline } from './useVirtualTimeline';

describe('buildVirtualTimeline', () => {
  it('returns empty timeline for no clips', () => {
    const timeline = buildVirtualTimeline([]);
    expect(timeline.segments).toEqual([]);
    expect(timeline.totalVirtualDuration).toBe(0);
    expect(timeline.virtualToActual(0)).toBeNull();
  });

  it('returns empty timeline for null input', () => {
    const timeline = buildVirtualTimeline(null);
    expect(timeline.totalVirtualDuration).toBe(0);
  });

  it('builds single-clip timeline', () => {
    const clips = [{ id: 'a', startTime: 10, endTime: 25 }];
    const timeline = buildVirtualTimeline(clips);

    expect(timeline.segments).toHaveLength(1);
    expect(timeline.totalVirtualDuration).toBe(15); // 25 - 10
    expect(timeline.segments[0]).toMatchObject({
      clipId: 'a',
      startTime: 10,
      endTime: 25,
      virtualStart: 0,
      virtualEnd: 15,
      duration: 15,
    });
  });

  it('builds multi-clip timeline with correct virtual offsets', () => {
    const clips = [
      { id: 'a', startTime: 10, endTime: 25 },  // 15s
      { id: 'b', startTime: 45, endTime: 55 },  // 10s
      { id: 'c', startTime: 120, endTime: 140 }, // 20s
    ];
    const timeline = buildVirtualTimeline(clips);

    expect(timeline.segments).toHaveLength(3);
    expect(timeline.totalVirtualDuration).toBe(45); // 15 + 10 + 20

    expect(timeline.segments[0].virtualStart).toBe(0);
    expect(timeline.segments[0].virtualEnd).toBe(15);

    expect(timeline.segments[1].virtualStart).toBe(15);
    expect(timeline.segments[1].virtualEnd).toBe(25);

    expect(timeline.segments[2].virtualStart).toBe(25);
    expect(timeline.segments[2].virtualEnd).toBe(45);
  });

  it('sorts clips by startTime', () => {
    const clips = [
      { id: 'c', startTime: 120, endTime: 140 },
      { id: 'a', startTime: 10, endTime: 25 },
      { id: 'b', startTime: 45, endTime: 55 },
    ];
    const timeline = buildVirtualTimeline(clips);

    expect(timeline.segments[0].clipId).toBe('a');
    expect(timeline.segments[1].clipId).toBe('b');
    expect(timeline.segments[2].clipId).toBe('c');
  });

  describe('virtualToActual', () => {
    const clips = [
      { id: 'a', startTime: 10, endTime: 25 },  // 15s, virtual [0, 15)
      { id: 'b', startTime: 45, endTime: 55 },  // 10s, virtual [15, 25)
      { id: 'c', startTime: 120, endTime: 140 }, // 20s, virtual [25, 45]
    ];

    it('maps start of first segment', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(0);
      expect(result.segmentIndex).toBe(0);
      expect(result.actualTime).toBe(10);
    });

    it('maps middle of first segment', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(7.5);
      expect(result.segmentIndex).toBe(0);
      expect(result.actualTime).toBe(17.5);
    });

    it('maps boundary between segments (goes to next)', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(15);
      expect(result.segmentIndex).toBe(1);
      expect(result.actualTime).toBe(45);
    });

    it('maps middle of second segment', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(20);
      expect(result.segmentIndex).toBe(1);
      expect(result.actualTime).toBe(50);
    });

    it('maps end of last segment', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(45);
      expect(result.segmentIndex).toBe(2);
      expect(result.actualTime).toBe(140);
    });

    it('clamps negative values to 0', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(-5);
      expect(result.segmentIndex).toBe(0);
      expect(result.actualTime).toBe(10);
    });

    it('clamps values beyond total duration', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.virtualToActual(100);
      expect(result.segmentIndex).toBe(2);
      expect(result.actualTime).toBe(140);
    });
  });

  describe('actualToVirtual', () => {
    const clips = [
      { id: 'a', startTime: 10, endTime: 25 },
      { id: 'b', startTime: 45, endTime: 55 },
    ];

    it('maps start of segment', () => {
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.actualToVirtual(0, 10)).toBe(0);
    });

    it('maps middle of first segment', () => {
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.actualToVirtual(0, 17.5)).toBe(7.5);
    });

    it('maps start of second segment', () => {
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.actualToVirtual(1, 45)).toBe(15);
    });

    it('maps end of second segment', () => {
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.actualToVirtual(1, 55)).toBe(25);
    });

    it('clamps actualTime to segment bounds', () => {
      const timeline = buildVirtualTimeline(clips);
      // Before segment start
      expect(timeline.actualToVirtual(0, 5)).toBe(0);
      // After segment end
      expect(timeline.actualToVirtual(0, 30)).toBe(15);
    });

    it('returns 0 for invalid segment index', () => {
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.actualToVirtual(-1, 10)).toBe(0);
      expect(timeline.actualToVirtual(5, 10)).toBe(0);
    });
  });

  describe('getSegmentAtVirtualTime', () => {
    const clips = [
      { id: 'a', startTime: 10, endTime: 25 },
      { id: 'b', startTime: 45, endTime: 55 },
    ];

    it('returns correct segment', () => {
      const timeline = buildVirtualTimeline(clips);
      const result = timeline.getSegmentAtVirtualTime(5);
      expect(result.segment.clipId).toBe('a');
      expect(result.segmentIndex).toBe(0);
    });

    it('returns null for empty timeline', () => {
      const timeline = buildVirtualTimeline([]);
      expect(timeline.getSegmentAtVirtualTime(0)).toBeNull();
    });
  });

  describe('cross-video support', () => {
    it('sorts by videoSequence first, then startTime', () => {
      const clips = [
        { id: 'a', startTime: 10, endTime: 25, videoSequence: 1 },
        { id: 'b', startTime: 5, endTime: 15, videoSequence: 2 },
      ];
      const timeline = buildVirtualTimeline(clips);

      // Seq 1 comes before seq 2 regardless of startTime
      expect(timeline.segments[0].videoSequence).toBe(1);
      expect(timeline.segments[0].clipId).toBe('a');
      expect(timeline.segments[1].videoSequence).toBe(2);
      expect(timeline.segments[1].clipId).toBe('b');
    });

    it('sorts by startTime within the same videoSequence', () => {
      const clips = [
        { id: 'c', startTime: 300, endTime: 315, videoSequence: 1 },
        { id: 'a', startTime: 60, endTime: 75, videoSequence: 1 },
        { id: 'b', startTime: 180, endTime: 195, videoSequence: 1 },
      ];
      const timeline = buildVirtualTimeline(clips);

      expect(timeline.segments[0].clipId).toBe('a');
      expect(timeline.segments[1].clipId).toBe('b');
      expect(timeline.segments[2].clipId).toBe('c');
    });

    it('interleaves clips from multiple halves correctly', () => {
      // Simulates real bug: 2nd half clips have lower startTimes than late 1st half clips
      const clips = [
        { id: 'h1_late', startTime: 2400, endTime: 2415, videoSequence: 1 },
        { id: 'h2_early', startTime: 30, endTime: 45, videoSequence: 2 },
        { id: 'h1_early', startTime: 120, endTime: 135, videoSequence: 1 },
        { id: 'h2_late', startTime: 1800, endTime: 1815, videoSequence: 2 },
      ];
      const timeline = buildVirtualTimeline(clips);

      // All first-half clips before all second-half clips
      expect(timeline.segments.map(s => s.clipId)).toEqual([
        'h1_early', 'h1_late', 'h2_early', 'h2_late',
      ]);
    });

    it('treats null/undefined videoSequence as sequence 1', () => {
      const clips = [
        { id: 'b', startTime: 5, endTime: 15, videoSequence: 2 },
        { id: 'a', startTime: 10, endTime: 25 },  // no videoSequence
      ];
      const timeline = buildVirtualTimeline(clips);

      // null defaults to seq 1, so 'a' comes first
      expect(timeline.segments[0].clipId).toBe('a');
      expect(timeline.segments[0].videoSequence).toBeNull();
      expect(timeline.segments[1].clipId).toBe('b');
      expect(timeline.segments[1].videoSequence).toBe(2);
    });

    it('builds correct virtual offsets across sequences', () => {
      const clips = [
        { id: 'h2', startTime: 10, endTime: 20, videoSequence: 2 },  // 10s
        { id: 'h1', startTime: 100, endTime: 115, videoSequence: 1 }, // 15s
      ];
      const timeline = buildVirtualTimeline(clips);

      // h1 (seq 1) first: virtual [0, 15)
      expect(timeline.segments[0].clipId).toBe('h1');
      expect(timeline.segments[0].virtualStart).toBe(0);
      expect(timeline.segments[0].virtualEnd).toBe(15);

      // h2 (seq 2) second: virtual [15, 25)
      expect(timeline.segments[1].clipId).toBe('h2');
      expect(timeline.segments[1].virtualStart).toBe(15);
      expect(timeline.segments[1].virtualEnd).toBe(25);

      expect(timeline.totalVirtualDuration).toBe(25);
    });

    it('handles null videoSequence', () => {
      const clips = [
        { id: 'a', startTime: 10, endTime: 25 },
      ];
      const timeline = buildVirtualTimeline(clips);
      expect(timeline.segments[0].videoSequence).toBeNull();
    });
  });
});

describe('buildFullVideoTimeline', () => {
  const twoHalves = [
    { sequence: 1, duration: 2700, url: 'http://example.com/v1.mp4' },
    { sequence: 2, duration: 2700, url: 'http://example.com/v2.mp4' },
  ];

  it('returns null for null/undefined input', () => {
    expect(buildFullVideoTimeline(null)).toBeNull();
    expect(buildFullVideoTimeline(undefined)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(buildFullVideoTimeline([])).toBeNull();
  });

  describe('single video', () => {
    const single = [{ sequence: 1, duration: 2700, url: 'http://example.com/v1.mp4' }];

    it('builds timeline with one segment', () => {
      const tl = buildFullVideoTimeline(single);
      expect(tl.segments).toHaveLength(1);
      expect(tl.totalDuration).toBe(2700);
    });

    it('segment covers full range', () => {
      const tl = buildFullVideoTimeline(single);
      expect(tl.segments[0]).toMatchObject({
        videoIndex: 0,
        videoSequence: 1,
        virtualStart: 0,
        virtualEnd: 2700,
        duration: 2700,
      });
    });

    it('virtualToActual is identity for single video', () => {
      const tl = buildFullVideoTimeline(single);
      const result = tl.virtualToActual(1000);
      expect(result.videoIndex).toBe(0);
      expect(result.videoSequence).toBe(1);
      expect(result.actualTime).toBe(1000);
    });
  });

  describe('two halves (standard soccer game)', () => {
    it('builds timeline with two segments', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.segments).toHaveLength(2);
      expect(tl.totalDuration).toBe(5400);
    });

    it('first segment covers 0 to first duration', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.segments[0]).toMatchObject({
        videoIndex: 0,
        videoSequence: 1,
        virtualStart: 0,
        virtualEnd: 2700,
        duration: 2700,
      });
    });

    it('second segment starts where first ends', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.segments[1]).toMatchObject({
        videoIndex: 1,
        videoSequence: 2,
        virtualStart: 2700,
        virtualEnd: 5400,
        duration: 2700,
      });
    });
  });

  describe('three videos', () => {
    const three = [
      { sequence: 1, duration: 1800, url: 'http://example.com/v1.mp4' },
      { sequence: 2, duration: 2700, url: 'http://example.com/v2.mp4' },
      { sequence: 3, duration: 900, url: 'http://example.com/v3.mp4' },
    ];

    it('builds correct cumulative offsets', () => {
      const tl = buildFullVideoTimeline(three);
      expect(tl.segments).toHaveLength(3);
      expect(tl.totalDuration).toBe(5400);
      expect(tl.segments[0].virtualStart).toBe(0);
      expect(tl.segments[1].virtualStart).toBe(1800);
      expect(tl.segments[2].virtualStart).toBe(4500);
    });
  });

  describe('sorts by sequence', () => {
    it('handles out-of-order input', () => {
      const outOfOrder = [
        { sequence: 2, duration: 2700, url: 'http://example.com/v2.mp4' },
        { sequence: 1, duration: 2700, url: 'http://example.com/v1.mp4' },
      ];
      const tl = buildFullVideoTimeline(outOfOrder);
      expect(tl.segments[0].videoSequence).toBe(1);
      expect(tl.segments[1].videoSequence).toBe(2);
    });
  });

  describe('virtualToActual', () => {
    it('maps time in first video correctly', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(1000);
      expect(result.videoIndex).toBe(0);
      expect(result.videoSequence).toBe(1);
      expect(result.actualTime).toBe(1000);
    });

    it('maps time in second video correctly', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(3000);
      expect(result.videoIndex).toBe(1);
      expect(result.videoSequence).toBe(2);
      expect(result.actualTime).toBe(300);
    });

    it('maps exact boundary to second video start', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(2700);
      expect(result.videoIndex).toBe(1);
      expect(result.videoSequence).toBe(2);
      expect(result.actualTime).toBe(0);
    });

    it('maps time 0 to first video start', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(0);
      expect(result.videoIndex).toBe(0);
      expect(result.actualTime).toBe(0);
    });

    it('maps end of total duration to last video end', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(5400);
      expect(result.videoIndex).toBe(1);
      expect(result.actualTime).toBe(2700);
    });

    it('clamps negative values', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(-100);
      expect(result.videoIndex).toBe(0);
      expect(result.actualTime).toBe(0);
    });

    it('clamps values beyond total duration', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.virtualToActual(10000);
      expect(result.videoIndex).toBe(1);
      expect(result.actualTime).toBe(2700);
    });
  });

  describe('actualToVirtual', () => {
    it('maps first video time correctly', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(0, 1000)).toBe(1000);
    });

    it('maps second video time with offset', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(1, 300)).toBe(3000);
    });

    it('maps start of second video', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(1, 0)).toBe(2700);
    });

    it('maps end of second video', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(1, 2700)).toBe(5400);
    });

    it('clamps actualTime to video duration', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(0, 5000)).toBe(2700);
    });

    it('clamps negative actualTime', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(1, -100)).toBe(2700);
    });

    it('returns 0 for invalid videoIndex', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.actualToVirtual(-1, 100)).toBe(0);
      expect(tl.actualToVirtual(5, 100)).toBe(0);
    });
  });

  describe('getVideoOffset', () => {
    it('returns 0 for first video', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.getVideoOffset(1)).toBe(0);
    });

    it('returns first video duration for second video', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.getVideoOffset(2)).toBe(2700);
    });

    it('returns 0 for unknown sequence', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.getVideoOffset(99)).toBe(0);
    });

    it('returns 0 for null sequence', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.getVideoOffset(null)).toBe(0);
    });
  });

  describe('getVideoBoundaries', () => {
    it('returns empty for single video', () => {
      const single = [{ sequence: 1, duration: 2700, url: 'u' }];
      const tl = buildFullVideoTimeline(single);
      expect(tl.getVideoBoundaries()).toEqual([]);
    });

    it('returns boundary at first video duration for two halves', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      expect(tl.getVideoBoundaries()).toEqual([2700]);
    });

    it('returns multiple boundaries for N videos', () => {
      const three = [
        { sequence: 1, duration: 1800, url: 'u' },
        { sequence: 2, duration: 2700, url: 'u' },
        { sequence: 3, duration: 900, url: 'u' },
      ];
      const tl = buildFullVideoTimeline(three);
      expect(tl.getVideoBoundaries()).toEqual([1800, 4500]);
    });
  });

  describe('clampToVideo', () => {
    it('returns same times when clip is within a single video', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.clampToVideo(100, 200);
      expect(result).toEqual({ startTime: 100, endTime: 200, videoSequence: 1 });
    });

    it('clamps endTime to first video boundary', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.clampToVideo(2600, 2800);
      expect(result).toEqual({ startTime: 2600, endTime: 2700, videoSequence: 1 });
    });

    it('clip in second video returns correct sequence', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.clampToVideo(3000, 3100);
      expect(result.videoSequence).toBe(2);
      expect(result.startTime).toBe(300);
      expect(result.endTime).toBe(400);
    });

    it('clamps clip that spans boundary', () => {
      const tl = buildFullVideoTimeline(twoHalves);
      const result = tl.clampToVideo(2600, 2800);
      expect(result.endTime).toBe(2700);
      expect(result.videoSequence).toBe(1);
    });
  });
});
