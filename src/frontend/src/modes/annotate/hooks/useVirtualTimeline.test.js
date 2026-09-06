import { describe, it, expect } from 'vitest';
import {
  buildVirtualTimeline,
  buildFullVideoTimeline,
  buildGameTimeline,
  hasOverlappingAngles,
} from './useVirtualTimeline';

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

  // T8700 test 11 (design section 6 / Phase 3 "single->multi transition
  // verification, GAP 3"). The design explicitly says NO code change is
  // expected for this transition -- AnnotateContainer.applyGameData's
  // `isMultiVideo = gameData.videos && gameData.videos.length > 1` predicate
  // and buildFullVideoTimeline already exist and already handle it. There is
  // no cheap unit-test seam for applyGameData itself (it's a useCallback
  // closed over inside AnnotateContainer(...), which is called as a plain
  // function per annotate.md, not mounted as a component by any existing
  // test) -- so this is written as a REGRESSION-LOCK at the pure-function
  // level applyGameData actually calls, exercising the exact single->multi
  // switch (gameVideos: null -> buildFullVideoTimeline result) plus the
  // legacy video_sequence=null -> offset-0 resolution
  // (games.py COALESCE(rc.video_sequence, 1) / frontend `?? 1`, per
  // annotate.md "Data flow"). EXPECTED TO PASS TODAY (not RED) -- flagged for
  // the implementor: if Phase 1 backend work changes this predicate or the
  // COALESCE/`?? 1` convention, this test must be revisited; if it stays
  // untouched, this test is the proof it survived T8700 intact.
  describe('T8700: single -> multi video transition (regression lock, GAP 3)', () => {
    it('a game with 1 video derives gameVideos=null (single-video branch)', () => {
      const videosFromLoad = [{ sequence: 1, blake3_hash: 'a'.repeat(64), duration: 2700 }];
      const isMultiVideo = videosFromLoad && videosFromLoad.length > 1;
      const gameVideos = isMultiVideo ? videosFromLoad : null;
      expect(gameVideos).toBeNull();
    });

    it('re-loading the SAME game after an attach (1 -> 2 videos) switches to the multi-video timeline', () => {
      // Before attach: /load returns 1 video.
      const before = [{ sequence: 1, blake3_hash: 'a'.repeat(64), duration: 2700 }];
      const isMultiVideoBefore = before && before.length > 1;
      const gameVideosBefore = isMultiVideoBefore ? before : null;
      const timelineBefore = gameVideosBefore && gameVideosBefore.length > 1
        ? buildFullVideoTimeline(gameVideosBefore)
        : null;
      expect(gameVideosBefore).toBeNull();
      expect(timelineBefore).toBeNull();

      // After attach: a fresh /load (not a stale memo) returns 2 videos.
      const after = [
        { sequence: 1, blake3_hash: 'a'.repeat(64), duration: 2700 },
        { sequence: 2, blake3_hash: 'b'.repeat(64), duration: 2700 },
      ];
      const isMultiVideoAfter = after && after.length > 1;
      const gameVideosAfter = isMultiVideoAfter ? after : null;
      const timelineAfter = gameVideosAfter && gameVideosAfter.length > 1
        ? buildFullVideoTimeline(gameVideosAfter)
        : null;

      expect(gameVideosAfter).not.toBeNull();
      expect(timelineAfter).not.toBeNull();
      expect(timelineAfter.segments).toHaveLength(2);
      expect(timelineAfter.totalDuration).toBe(5400);
    });

    it('a legacy clip with video_sequence=null resolves at offset 0 after the transition', () => {
      const after = [
        { sequence: 1, blake3_hash: 'a'.repeat(64), duration: 2700 },
        { sequence: 2, blake3_hash: 'b'.repeat(64), duration: 2700 },
      ];
      const timeline = buildFullVideoTimeline(after);

      // Frontend convention: `region.videoSequence ?? 1` (timeFormat.js, useAnnotate.js,
      // ClipsSidePanel.jsx) before any getVideoOffset/sort call.
      const legacyClipVideoSequence = null;
      const resolvedSequence = legacyClipVideoSequence ?? 1;
      expect(timeline.getVideoOffset(resolvedSequence)).toBe(0);

      // The newly-attached video is append-only (sequence 2+, T8700 GAP 3), so it
      // can never be sequence 1 and can never steal offset 0 from existing clips.
      expect(timeline.getVideoOffset(2)).toBe(2700);
    });
  });
});

// T8880: game timeline v2 -- lanes, backbone, coverage extensions.
// The algorithm (see buildGameTimeline's header comment) is: backbone (lane 0) =
// the longest video (the "main camera"), tie-broken earliest offset then sequence,
// grown by concatenating every non-overlapping video in offset order; then the
// remaining ("angle") videos are colored into lanes 1+ by the minimal-lane greedy.
// Coverage extensions = footage covered only by lane-1+ videos, inserted into the
// virtual domain at its wall-clock position.
describe('buildGameTimeline', () => {
  const videoEntries = (gt) => gt.domain.filter((d) => d.type === 'video');
  const extEntries = (gt) => gt.domain.filter((d) => d.type === 'extension');

  it('returns null for null/empty input', () => {
    expect(buildGameTimeline(null)).toBeNull();
    expect(buildGameTimeline([])).toBeNull();
  });

  // ---- T-EQ: the ACCEPTANCE BAR. Angle-free game (offsets == prefix sums) must
  // produce a domain/boundaries output field-identical to buildFullVideoTimeline. ----
  describe('equivalence with buildFullVideoTimeline (angle-free)', () => {
    const twoHalves = [
      { sequence: 1, duration: 2700, offset_seconds: null, url: 'v1.mp4' },
      { sequence: 2, duration: 2700, offset_seconds: null, url: 'v2.mp4' },
    ];

    it('two-half game: domain matches buildFullVideoTimeline segment-for-segment', () => {
      const gt = buildGameTimeline(twoHalves);
      const ft = buildFullVideoTimeline(twoHalves);
      expect(gt.totalDuration).toBe(ft.totalDuration); // 5400
      expect(gt.lanes).toHaveLength(1);
      expect(gt.angles).toEqual([]);

      const vids = videoEntries(gt);
      expect(vids).toHaveLength(ft.segments.length);
      vids.forEach((d, i) => {
        expect(d.sequence).toBe(ft.segments[i].videoSequence);
        expect(d.virtualStart).toBe(ft.segments[i].virtualStart);
        expect(d.virtualEnd).toBe(ft.segments[i].virtualEnd);
      });
      // boundaries derived from the domain == buildFullVideoTimeline boundaries
      const boundaries = vids.slice(1).map((d) => d.virtualStart);
      expect(boundaries).toEqual(ft.getVideoBoundaries()); // [2700]
    });

    it('three videos: cumulative offsets match', () => {
      const three = [
        { sequence: 1, duration: 1800, offset_seconds: null, url: 'a.mp4' },
        { sequence: 2, duration: 2700, offset_seconds: null, url: 'b.mp4' },
        { sequence: 3, duration: 900, offset_seconds: null, url: 'c.mp4' },
      ];
      const gt = buildGameTimeline(three);
      const ft = buildFullVideoTimeline(three);
      expect(videoEntries(gt).map((d) => d.virtualStart)).toEqual(
        ft.segments.map((s) => s.virtualStart),
      );
      expect(gt.totalDuration).toBe(ft.totalDuration);
      expect(extEntries(gt)).toHaveLength(0);
    });

    it('explicit offset_seconds equal to prefix sums is still equivalent', () => {
      const explicit = [
        { sequence: 1, duration: 2700, offset_seconds: 0, url: 'v1.mp4' },
        { sequence: 2, duration: 2700, offset_seconds: 2700, url: 'v2.mp4' },
      ];
      const gt = buildGameTimeline(explicit);
      const ft = buildFullVideoTimeline(explicit);
      expect(gt.totalDuration).toBe(ft.totalDuration);
      expect(gt.lanes).toHaveLength(1);
      expect(videoEntries(gt).map((d) => d.virtualStart)).toEqual(
        ft.segments.map((s) => s.virtualStart),
      );
    });
  });

  // ---- T-EPIC: 1 backbone + 4 clips, 2 overlapping each other -> exactly 3 lanes ----
  it('EPIC scenario: yields exactly 3 lanes; lane 2 holds only the later of the overlapping pair', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 2000, offset_seconds: 0, url: 'main.mp4' }, // backbone
      { sequence: 2, duration: 120, offset_seconds: 100, url: 'a.mp4' },
      { sequence: 3, duration: 120, offset_seconds: 500, url: 'b.mp4' },
      { sequence: 4, duration: 120, offset_seconds: 540, url: 'c.mp4' }, // overlaps seq3
      { sequence: 5, duration: 120, offset_seconds: 900, url: 'd.mp4' },
    ]);

    expect(gt.lanes).toHaveLength(3);
    expect(gt.lanes[0].map((v) => v.sequence)).toEqual([1]);
    expect(gt.lanes[1].map((v) => v.sequence)).toEqual([2, 3, 5]);
    expect(gt.lanes[2].map((v) => v.sequence)).toEqual([4]);

    // all angle clips sit within the backbone span -> no extensions
    expect(extEntries(gt)).toHaveLength(0);
    expect(gt.totalDuration).toBe(2000);

    // the overlapping pair puts seq4 on the third lane (index 2)
    const seq4 = gt.angles.find((a) => a.sequence === 4);
    expect(seq4.lane).toBe(2);
  });

  // ---- T-GAP: halftime-gap clip lands on lane 0 between the halves ----
  it('halftime-gap clip (no overlap) lands on lane 0 with boundary markers both sides', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 2700, offset_seconds: 0, url: 'h1.mp4' },
      { sequence: 2, duration: 2700, offset_seconds: 3000, url: 'h2.mp4' }, // 300s real gap
      { sequence: 3, duration: 120, offset_seconds: 2800, url: 'clip.mp4' }, // inside the gap
    ]);

    expect(gt.lanes).toHaveLength(1); // everything on the backbone
    expect(gt.angles).toEqual([]);
    expect(extEntries(gt)).toHaveLength(0);

    // backbone order by offset: seq1, seq3, seq2 (the gap compresses to zero width)
    expect(videoEntries(gt).map((d) => d.sequence)).toEqual([1, 3, 2]);
    expect(videoEntries(gt).map((d) => d.virtualStart)).toEqual([0, 2700, 2820]);
    expect(gt.totalDuration).toBe(5520); // 2700 + 120 + 2700, gaps compressed

    // the clip's own footage is reachable
    expect(gt.sourcesAt(2760)).toEqual([3]);
  });

  // ---- T-APP: angle past backbone end -> extension appended ----
  it('angle past backbone end appends a coverage extension', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 2700, offset_seconds: 0, url: 'main.mp4' },
      { sequence: 2, duration: 600, offset_seconds: 2600, url: 'angle.mp4' }, // [2600,3200)
    ]);

    expect(gt.lanes).toHaveLength(2);
    expect(gt.lanes[0].map((v) => v.sequence)).toEqual([1]);

    const exts = extEntries(gt);
    expect(exts).toHaveLength(1);
    expect(exts[0].sourceSequence).toBe(2);
    expect(exts[0].wallStart).toBe(2700);
    expect(exts[0].virtualStart).toBe(2700);
    expect(exts[0].virtualEnd).toBe(3200);
    expect(gt.totalDuration).toBe(3200);

    // domain order: backbone video first, extension appended
    expect(gt.domain.map((d) => d.type)).toEqual(['video', 'extension']);

    // angle virtual span maps through wall-clock
    const angle = gt.angles.find((a) => a.sequence === 2);
    expect(angle.virtualStart).toBe(2600);
    expect(angle.virtualEnd).toBe(3200);

    expect(gt.sourcesAt(2650)).toEqual([1, 2]); // deep overlap over the backbone
    expect(gt.sourcesAt(2900)).toEqual([2]); // inside the extension
  });

  // ---- T-PRE: negative-offset angle before backbone start -> extension prepended.
  // This is the regression lock for the lane-0/backbone inversion bug: the longer
  // MAIN camera must stay on lane 0 even though the angle starts earlier. ----
  it('negative-offset angle before backbone start prepends an extension (main stays lane 0)', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 2700, offset_seconds: 0, url: 'main.mp4' }, // longest -> backbone
      { sequence: 2, duration: 400, offset_seconds: -300, url: 'early.mp4' }, // [-300,100)
    ]);

    // main camera (longer) stays on lane 0; the earlier-but-shorter clip is the angle
    expect(gt.lanes[0].map((v) => v.sequence)).toEqual([1]);
    expect(gt.lanes).toHaveLength(2);

    const exts = extEntries(gt);
    expect(exts).toHaveLength(1);
    expect(exts[0].sourceSequence).toBe(2);
    expect(exts[0].wallStart).toBe(-300);
    expect(exts[0].virtualStart).toBe(0);
    expect(exts[0].virtualEnd).toBe(300);

    // domain order: extension prepended, then backbone
    expect(gt.domain.map((d) => d.type)).toEqual(['extension', 'video']);
    expect(gt.domain[1].sequence).toBe(1);
    expect(gt.domain[1].virtualStart).toBe(300);
    expect(gt.totalDuration).toBe(3000);

    const angle = gt.angles.find((a) => a.sequence === 2);
    expect(angle.virtualStart).toBe(0);
    expect(angle.virtualEnd).toBe(400);

    expect(gt.sourcesAt(150)).toEqual([2]); // inside the prepended extension
    expect(gt.sourcesAt(350)).toEqual([1, 2]); // overlap region over the backbone
  });

  // ---- T-NOMAIN: two phone clips, no main camera, partial overlap ----
  it('two phone clips (no main camera) partial overlap: earlier=lane0, later=lane1, tail=extension', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 600, offset_seconds: 0, url: 'phoneA.mp4' }, // [0,600)
      { sequence: 2, duration: 600, offset_seconds: 400, url: 'phoneB.mp4' }, // [400,1000)
    ]);

    expect(gt.lanes[0].map((v) => v.sequence)).toEqual([1]);
    expect(gt.lanes[1].map((v) => v.sequence)).toEqual([2]);

    const exts = extEntries(gt);
    expect(exts).toHaveLength(1);
    expect(exts[0].sourceSequence).toBe(2);
    expect(exts[0].wallStart).toBe(600);
    expect(exts[0].virtualEnd).toBe(1000);
    expect(gt.totalDuration).toBe(1000); // whole span playable

    expect(gt.sourcesAt(100)).toEqual([1]);
    expect(gt.sourcesAt(500)).toEqual([1, 2]);
    expect(gt.sourcesAt(800)).toEqual([2]);
  });

  // ---- T-EPS: 1s recording-split slop does NOT create a second lane ----
  describe('epsilon tolerance (OVERLAP_EPSILON_S = 1.0)', () => {
    it('a 1s split slop keeps both videos on lane 0', () => {
      const gt = buildGameTimeline([
        { sequence: 1, duration: 1200, offset_seconds: 0, url: 'a.mp4' },
        { sequence: 2, duration: 1200, offset_seconds: 1199, url: 'b.mp4' }, // 1s overlap
      ]);
      expect(gt.lanes).toHaveLength(1);
      expect(gt.angles).toEqual([]);
      expect(extEntries(gt)).toHaveLength(0);
    });

    it('a 2s overlap DOES create a second lane (bounds the epsilon)', () => {
      const gt = buildGameTimeline([
        { sequence: 1, duration: 1200, offset_seconds: 0, url: 'a.mp4' },
        { sequence: 2, duration: 1200, offset_seconds: 1198, url: 'b.mp4' }, // 2s overlap
      ]);
      expect(gt.lanes).toHaveLength(2);
      expect(gt.lanes[1].map((v) => v.sequence)).toEqual([2]);
    });
  });

  // ---- T-SOURCES: sourcesAt in a deep 3-way overlap ----
  it('sourcesAt returns 3 sequences inside a deep overlap, 1 outside', () => {
    const gt = buildGameTimeline([
      { sequence: 1, duration: 2000, offset_seconds: 0, url: 'main.mp4' },
      { sequence: 2, duration: 300, offset_seconds: 500, url: 'a.mp4' }, // [500,800)
      { sequence: 3, duration: 300, offset_seconds: 600, url: 'b.mp4' }, // [600,900) overlaps seq2
    ]);
    expect(gt.lanes).toHaveLength(3);
    expect(gt.sourcesAt(650)).toEqual([1, 2, 3]); // deep overlap
    expect(gt.sourcesAt(1500)).toEqual([1]); // backbone only
  });

  // ---- virtualToSource / clampToSource (consumed by T8890/T8900 playback) ----
  describe('virtualToSource and clampToSource', () => {
    const gt = () =>
      buildGameTimeline([
        { sequence: 1, duration: 2700, offset_seconds: 0, url: 'main.mp4' },
        { sequence: 2, duration: 600, offset_seconds: 2600, url: 'angle.mp4' },
      ]);

    it('maps a virtual time to the active angle source file-relative time', () => {
      const t = gt();
      // virtual 2650 -> wall 2650; angle seq2 offset 2600 -> fileTime 50
      const src = t.virtualToSource(2650, 2);
      expect(src.sequence).toBe(2);
      expect(src.fileTime).toBe(50);
    });

    it('falls back to the domain-owning source when the active source does not cover the time', () => {
      const t = gt();
      // virtual 100 is deep in the backbone; angle seq2 does not cover wall 100
      const src = t.virtualToSource(100, 2);
      expect(src.sequence).toBe(1);
      expect(src.fileTime).toBe(100);
    });

    it('clampToSource snaps a virtual time into a source play range', () => {
      const t = gt();
      // clamp to the angle: virtual 100 (wall 100) is before the angle's wall start 2600
      const clamped = t.clampToSource(100, 2);
      // snaps forward to the angle's earliest reachable virtual position (its wall start)
      expect(clamped).toBe(t.wallToVirtual(2600));
    });
  });

  // ---- Display names ----
  describe('angle display names', () => {
    it('uses the filename stem, middle-ellipsised to 14 chars', () => {
      const gt = buildGameTimeline([
        { sequence: 1, duration: 2000, offset_seconds: 0, url: 'https://cdn/main.mp4' },
        {
          sequence: 2,
          duration: 120,
          offset_seconds: 100,
          url: 'https://cdn/VID_20260905_094101.mp4',
        },
      ]);
      const angle = gt.angles.find((a) => a.sequence === 2);
      expect(angle.name).toContain('…'); // middle ellipsis
      expect(angle.name.length).toBeLessThanOrEqual(14);
    });

    it('falls back to "Extra clip {n}" when no filename stem is available', () => {
      const gt = buildGameTimeline([
        { sequence: 1, duration: 2000, offset_seconds: 0, url: 'main.mp4' },
        { sequence: 2, duration: 120, offset_seconds: 100, url: '' },
      ]);
      const angle = gt.angles.find((a) => a.sequence === 2);
      expect(angle.name).toBe('Extra clip 1');
    });
  });
});

// T8880: AnnotateContainer path selection -- old buildFullVideoTimeline for every
// angle-free game (prefix-sum, backfilled, OR gapped), new buildGameTimeline ONLY
// when footage genuinely overlaps. A gap game is angle-free and MUST stay on the
// old path: routing it to the differently-shaped new builder would crash the
// render path before T8890 adapts those consumers.
describe('hasOverlappingAngles (AnnotateContainer path selection)', () => {
  it('is false for a plain 2-half game (offsets == prefix sums) -> old path', () => {
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 2700, offset_seconds: 0 },
        { sequence: 2, duration: 2700, offset_seconds: 2700 },
      ]),
    ).toBe(false);
  });

  it('is false for backfilled null offsets (fall back to prefix sum)', () => {
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 2700, offset_seconds: null },
        { sequence: 2, duration: 2700, offset_seconds: null },
      ]),
    ).toBe(false);
  });

  it('is false for a single video', () => {
    expect(hasOverlappingAngles([{ sequence: 1, duration: 2700, offset_seconds: 0 }])).toBe(false);
  });

  it('is FALSE for a real halftime GAP with no overlap (angle-free -> old path)', () => {
    // The DJI evidence case: continuous halves + ~halftime gap. Every video is on
    // lane 0, so buildFullVideoTimeline concatenates it byte-identically to today.
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 2700, offset_seconds: 0 },
        { sequence: 2, duration: 2700, offset_seconds: 3000 }, // real 300s gap, no overlap
      ]),
    ).toBe(false);
  });

  it('is true when videos genuinely overlap (angle placement) -> new path', () => {
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 2700, offset_seconds: 0 },
        { sequence: 2, duration: 600, offset_seconds: 2600 }, // overlaps the main by 100s
      ]),
    ).toBe(true);
  });

  it('tolerates sub-epsilon overlap (1s recording slop stays on the old path)', () => {
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 1200, offset_seconds: 0 },
        { sequence: 2, duration: 1200, offset_seconds: 1199.5 }, // 0.5s overlap
      ]),
    ).toBe(false);
  });

  it('trips on a 2s overlap (bounds the epsilon) -> new path', () => {
    expect(
      hasOverlappingAngles([
        { sequence: 1, duration: 1200, offset_seconds: 0 },
        { sequence: 2, duration: 1200, offset_seconds: 1198 }, // 2s overlap
      ]),
    ).toBe(true);
  });
});
