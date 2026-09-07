import { describe, it, expect } from 'vitest';
import { buildGameTimeline, buildFullVideoTimeline, hasOverlappingAngles } from './useVirtualTimeline';

// T8890 relies on buildGameTimeline's T8890-added surface: kind, sourceTimeToVirtual,
// and the playback-compat methods (segments/virtualToActual/actualToVirtual) that let
// useVideoProxy drive the A/B player off the backbone+extension domain. These tests
// pin those, plus the active-source binding virtualToSource(t, activeSequence) that
// makes a clip created while an angle is active carry THAT angle's sequence.

// video B sits entirely inside video A (the classic sideline-phone-during-game case).
// T8892: `url` is the REAL R2 shape (content-addressed by blake3 hash); the angle
// name comes from `original_filename`, NEVER the url. A hash url + a human filename
// is the exact regression this task fixes -- assertions must read the filename.
const twoSource = [
  { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/67ef5eefeed423a69.mp4', original_filename: 'main-camera.mp4' },
  { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/1c0ffee9900dbeef.mp4', original_filename: 'sideline.mp4' },
];

// EPIC deep-overlap: three angles concurrent over the backbone at ~600-960s.
const deepOverlap = [
  { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/aaa111.mp4', original_filename: 'main-camera.mp4' },
  { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/bbb222.mp4', original_filename: 'endzone.mp4' },
  { sequence: 3, duration: 300, offset_seconds: 650, url: 'games/ccc333.mp4', original_filename: 'sideline.mp4' },
  { sequence: 4, duration: 300, offset_seconds: 660, url: 'games/ddd444.mp4', original_filename: 'corner.mp4' },
];

describe('buildGameTimeline — T8890 playback + source surface', () => {
  it('reports kind:"overlap" (the discriminator every consumer branches on)', () => {
    expect(buildGameTimeline(twoSource).kind).toBe('overlap');
    // buildFullVideoTimeline (angle-free path) must NOT claim to be overlap.
    expect(buildFullVideoTimeline(twoSource).kind).toBeUndefined();
  });

  it('backbone is the longest video (seq 1); the inner clip is an angle', () => {
    const t = buildGameTimeline(twoSource);
    expect(t.lanes[0].map((v) => v.sequence)).toEqual([1]);
    expect(t.angles.map((a) => a.sequence)).toEqual([2]);
    expect(t.angles[0].name).toBe('sideline'); // stem of original_filename, NOT the hash url
  });

  it('T8892: angle name derives from original_filename, never the content-hash url', () => {
    const t = buildGameTimeline(twoSource);
    // The url is `games/1c0ffee9900dbeef.mp4`; the name must be the human filename.
    expect(t.angles[0].name).toBe('sideline');
    expect(t.angles[0].name).not.toMatch(/[0-9a-f]{8}/i); // no hash leaked in
  });

  it('T8892: an angle with NO original_filename falls back to "Extra clip {n}", never a hash', () => {
    const noName = [
      { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/deadbeef01.mp4', original_filename: 'main-camera.mp4' },
      { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/cafef00d02.mp4', original_filename: null },
    ];
    const t = buildGameTimeline(noName);
    expect(t.angles[0].name).toBe('Extra clip 1'); // 1-based lane order among angles
    expect(t.angles[0].name).not.toMatch(/[0-9a-f]{8}/i);
  });

  it('T8892: long filenames are middle-ellipsized to 14 chars', () => {
    const longName = [
      { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/x1.mp4', original_filename: 'main-camera.mp4' },
      { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/x2.mp4', original_filename: 'GX010042-sideline-endzone-camera.mp4' },
    ];
    const t = buildGameTimeline(longName);
    expect(t.angles[0].name).toContain('…');
    expect(t.angles[0].name.length).toBeLessThanOrEqual(14);
  });

  it('sourceTimeToVirtual round-trips against virtualToSource for the backbone', () => {
    const t = buildGameTimeline(twoSource);
    // Backbone file time 900 -> wall 900 -> virtual 900 (backbone offset 0).
    const v = t.sourceTimeToVirtual(1, 900);
    expect(v).toBeCloseTo(900, 5);
    const back = t.virtualToSource(v, 1);
    expect(back.sequence).toBe(1);
    expect(back.fileTime).toBeCloseTo(900, 5);
  });

  it('sourceTimeToVirtual maps an angle clip onto the shared wall position', () => {
    const t = buildGameTimeline(twoSource);
    // Angle (seq 2) file time 100 -> wall 700 -> virtual 700 (inside backbone span).
    expect(t.sourceTimeToVirtual(2, 100)).toBeCloseTo(700, 5);
  });

  it('virtualToSource honors the ACTIVE angle when it covers the playhead', () => {
    const t = buildGameTimeline(twoSource);
    // At virtual 700 both the backbone and angle seq 2 exist; active=2 wins.
    const active = t.virtualToSource(700, 2);
    expect(active.sequence).toBe(2);
    expect(active.fileTime).toBeCloseTo(100, 5); // wall 700 - angle offset 600
    // With no active angle, it falls back to the backbone owner (seq 1).
    expect(t.virtualToSource(700, null).sequence).toBe(1);
  });

  it('virtualToSource falls back to the backbone when the active angle does NOT cover t', () => {
    const t = buildGameTimeline(twoSource);
    // Angle seq 2 spans virtual 600-900; at 1200 it does not cover -> backbone.
    expect(t.virtualToSource(1200, 2).sequence).toBe(1);
  });

  it('playback segments + virtualToActual/actualToVirtual round-trip (proxy contract)', () => {
    const t = buildGameTimeline(twoSource);
    expect(Array.isArray(t.segments)).toBe(true);
    const r = t.virtualToActual(300);
    expect(r.videoSequence).toBe(1);
    expect(r.actualTime).toBeCloseTo(300, 5);
    expect(t.actualToVirtual(r.videoIndex, r.actualTime)).toBeCloseTo(300, 5);
  });

  it('deep overlap yields exactly 3 angle lanes (minimal-lane greedy)', () => {
    expect(hasOverlappingAngles(deepOverlap)).toBe(true);
    const t = buildGameTimeline(deepOverlap);
    expect(t.lanes.length - 1).toBe(3); // 3 angle lanes above the backbone
    expect(t.angles.map((a) => a.sequence).sort()).toEqual([2, 3, 4]);
  });

  it('sourcesAt reports every source covering the playhead, backbone-first', () => {
    const t = buildGameTimeline(deepOverlap);
    // At virtual ~700 the backbone + all three angles are live.
    const seqs = t.sourcesAt(700);
    expect(seqs[0]).toBe(1); // backbone first
    expect(seqs.slice().sort()).toEqual([1, 2, 3, 4]);
  });

  it('an angle crossing a backbone boundary maps to the correct underlying segment index', () => {
    // Two adjacent backbone videos (seq 1: 0-900, seq 5: 900-1800); angle seq 2
    // spans wall 850-950, crossing the 900 boundary. This is the case that made
    // currentVideoIndexRef go stale after auto-fallback (reviewer T8890): the
    // switchSource fix resyncs the index via virtualToActual(sourceTimeToVirtual()).
    const twoBackbone = [
      { sequence: 1, duration: 900, offset_seconds: 0, url: 'a.mp4' },
      { sequence: 5, duration: 900, offset_seconds: 900, url: 'b.mp4' },
      { sequence: 2, duration: 100, offset_seconds: 850, url: 'angle.mp4' },
    ];
    const t = buildGameTimeline(twoBackbone);
    expect(t.lanes[0].map((v) => v.sequence)).toEqual([1, 5]); // both backbone
    // Angle file time 40 -> wall 890 -> under backbone segment 0 (seq 1).
    const before = t.virtualToActual(t.sourceTimeToVirtual(2, 40));
    expect(before.videoIndex).toBe(0);
    expect(before.videoSequence).toBe(1);
    // Angle file time 60 -> wall 910 -> under backbone segment 1 (seq 5).
    const after = t.virtualToActual(t.sourceTimeToVirtual(2, 60));
    expect(after.videoIndex).toBe(1);
    expect(after.videoSequence).toBe(5);
  });

  it('clampToSource keeps an out-point inside the chosen source bounds', () => {
    const t = buildGameTimeline(twoSource);
    // A clip on angle seq 2 (virtual 600-900) whose end would run to 1000 clamps back.
    const clamped = t.clampToSource(1000, 2);
    expect(clamped).toBeLessThanOrEqual(900 + 1e-6);
  });
});
