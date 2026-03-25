import { describe, it, expect } from 'vitest';
import { buildVirtualTimeline } from './useVirtualTimeline';

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
    it('preserves videoSequence in segments', () => {
      const clips = [
        { id: 'a', startTime: 10, endTime: 25, videoSequence: 1 },
        { id: 'b', startTime: 5, endTime: 15, videoSequence: 2 },
      ];
      const timeline = buildVirtualTimeline(clips);

      // Sorted by startTime: b (5-15, seq 2) then a (10-25, seq 1)
      expect(timeline.segments[0].videoSequence).toBe(2);
      expect(timeline.segments[1].videoSequence).toBe(1);
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
