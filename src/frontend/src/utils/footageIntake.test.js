/**
 * T8800/T8824 — footage intake pure-function tests.
 *
 * Fixtures mirror the real folders probed 2026-09-05 (EPIC.md evidence table) plus
 * every row of docs/plans/tasks/T8824-design.md §2.4's disambiguation table, as
 * synthetic name/duration/creationTime/width/height tuples — we never commit
 * multi-GB videos.
 */
import { describe, it, expect } from 'vitest';
import {
  isJunkFile,
  isVideoFile,
  pairProxies,
  inferPlacement,
  dedupeKey,
  SLOP_MAX_S,
  GAP_MIN_S,
} from './footageIntake';

// Build a Date from UTC wall-clock components (avoids local-tz drift in CI).
const at = (h, m, s) => new Date(Date.UTC(2026, 8, 5, h, m, s));

function dji(name, h, m, s, duration = 480, extra = {}) {
  return { name, duration, creationTime: at(h, m, s), width: 3840, height: 2160, ...extra };
}
function phone(name, h, m, s, duration, extra = {}) {
  return { name, duration, creationTime: at(h, m, s), width: 1080, height: 1920, ...extra };
}

describe('isJunkFile', () => {
  it('flags proxy/subtitle/thumbnail/image extensions, case-insensitively', () => {
    for (const name of ['DJI_0003.LRF', 'clip.THM', 'subs.srt', 'a.JPG', 'b.jpeg', 'c.png', 'd.heic', 'e.gif']) {
      expect(isJunkFile({ name, size: 100 })).toBe(true);
    }
  });
  it('flags hidden dotfiles and AppleDouble resource forks', () => {
    expect(isJunkFile({ name: '.DS_Store', size: 100 })).toBe(true);
    expect(isJunkFile({ name: '._DJI_0003.MP4', size: 100 })).toBe(true);
  });
  it('flags zero-byte files', () => {
    expect(isJunkFile({ name: 'empty.mp4', size: 0 })).toBe(true);
  });
  it('does not flag real videos', () => {
    expect(isJunkFile({ name: 'DJI_0003.MP4', size: 5000 })).toBe(false);
  });
});

describe('isVideoFile', () => {
  it('accepts any video/* MIME', () => {
    expect(isVideoFile({ name: 'x.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'x.mov', type: 'video/quicktime' })).toBe(true);
  });
  it('accepts an empty-MIME file by extension (folder-drop case)', () => {
    expect(isVideoFile({ name: 'DJI_0003.MP4', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.mov', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.webm', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.m4v', type: '' })).toBe(true);
  });
  it('rejects an empty-MIME non-video extension', () => {
    expect(isVideoFile({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isVideoFile({ name: 'DJI_0003.LRF', type: '' })).toBe(false);
  });
  it('rejects a non-video MIME even with a video extension', () => {
    expect(isVideoFile({ name: 'evil.mp4', type: 'image/png' })).toBe(false);
  });
});

describe('pairProxies', () => {
  it('routes an .LRF to proxies keyed by its matching video, keeps it out of videos', () => {
    const mp4 = { name: 'DJI_0003.MP4', type: 'video/mp4' };
    const lrf = { name: 'DJI_0003.LRF', type: '' };
    const { videos, proxies } = pairProxies([mp4, lrf]);
    expect(videos).toEqual([mp4]);
    expect(proxies).toEqual({ 'DJI_0003.MP4': lrf });
  });
  it('drops an unmatched .LRF (no video with that basename)', () => {
    const lrf = { name: 'ORPHAN.LRF', type: '' };
    const { videos, proxies } = pairProxies([lrf]);
    expect(videos).toEqual([]);
    expect(proxies).toEqual({});
  });
});

describe('dedupeKey', () => {
  it('is name|size|duration', () => {
    expect(dedupeKey({ name: 'a.mp4', size: 10, duration: 5 })).toBe('a.mp4|10|5');
  });
  it('matches identical files and distinguishes different ones', () => {
    const a = { name: 'a.mp4', size: 10, duration: 5 };
    const aCopy = { name: 'a.mp4', size: 10, duration: 5 };
    const b = { name: 'a.mp4', size: 11, duration: 5 };
    expect(dedupeKey(a)).toBe(dedupeKey(aCopy));
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});

// --- inferPlacement: every row of the design doc's §2.4 fixture table ---------

describe('inferPlacement — fixture 1: DJI folder, no overlap', () => {
  const items = [
    dji('DJI_0005.MP4', 18, 44, 59, 1411),
    dji('DJI_0003.MP4', 17, 55, 44, 1410),
    dji('DJI_0006.MP4', 19, 8, 32, 273),
    dji('DJI_0004.MP4', 18, 19, 15, 1013),
  ];

  it('places by time, one lane, one ~529s gap after index 1, no question', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.confidence).toBe('time');
    expect(r.lanes).toHaveLength(1);
    expect(r.order.map((i) => i.name)).toEqual([
      'DJI_0003.MP4', 'DJI_0004.MP4', 'DJI_0005.MP4', 'DJI_0006.MP4',
    ]);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].afterIndex).toBe(1);
    expect(r.gaps[0].seconds).toBeGreaterThan(500);
    expect(r.gaps[0].seconds).toBeLessThan(560);
    expect(r.question).toBeNull();
  });
});

describe('inferPlacement — fixture 2: Legends export pair (overlap is an artifact)', () => {
  const items = [
    { name: '2nd-half.mp4', duration: 2700, creationTime: at(10, 0, 0) },
    { name: '1st-half.mp4', duration: 2700, creationTime: at(10, 13, 0) },
  ];

  it('half-words decide -> sequence placement, name order, all-null timestamps', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.confidence).toBe('name');
    expect(r.lanes).toHaveLength(1);
    expect(r.order.map((i) => i.name)).toEqual(['1st-half.mp4', '2nd-half.mp4']);
    expect(r.gaps).toEqual([]);
  });
});

describe('inferPlacement — fixture 3/4: main camera + 1 angle, plus a real gap', () => {
  const items = [
    dji('DJI_0003.MP4', 14, 0, 0, 480),
    dji('DJI_0004.MP4', 14, 8, 0, 480),
    dji('DJI_0005.MP4', 14, 25, 0, 480), // 17 min after DJI_0004 ends -> real gap
    dji('DJI_0006.MP4', 14, 33, 0, 480),
    phone('sideline.mp4', 14, 10, 0, 240), // inside DJI_0004's span, different family
  ];

  it('different camera family -> angle: backbone lane 0 (4 DJI), sideline on lane 1', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.lanes).toHaveLength(2);
    expect(r.lanes[0].map((p) => p.item.name)).toEqual([
      'DJI_0003.MP4', 'DJI_0004.MP4', 'DJI_0005.MP4', 'DJI_0006.MP4',
    ]);
    expect(r.lanes[1].map((p) => p.item.name)).toEqual(['sideline.mp4']);
  });

  it('the real halftime gap still reports on lane 0, unaffected by the angle', () => {
    const r = inferPlacement(items);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].afterIndex).toBe(1); // between DJI_0004 (index 1) and DJI_0005
  });
});

describe('inferPlacement — fixture 5: main + 2 phones overlapping each other (3 lanes)', () => {
  const items = [
    dji('main-camera.mp4', 14, 0, 0, 3600),
    phone('phone1.mp4', 14, 10, 0, 360), // 14:10-14:16
    phone('phone2.mp4', 14, 12, 0, 180), // 14:12-14:15, overlaps phone1 too
  ];

  it('needs exactly 3 lanes (lane 2 exists only because the phones overlap each other)', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.lanes).toHaveLength(3);
    expect(r.lanes[0].map((p) => p.item.name)).toEqual(['main-camera.mp4']);
  });
});

describe('inferPlacement — fixture 6: angle running past the main camera end', () => {
  const items = [
    dji('main-camera.mp4', 14, 0, 0, 1200), // 14:00-14:20
    phone('trailing.mp4', 14, 15, 0, 900), // 14:15-14:30, overflows past main's end
  ];

  it('still colors as an angle on lane 1', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.lanes).toHaveLength(2);
    expect(r.lanes[1][0].item.name).toBe('trailing.mp4');
  });
});

describe('inferPlacement — fixture 7: no main camera, two identical phones, ambiguous overlap', () => {
  const items = [
    phone('IMG_1001.MOV', 14, 0, 0, 1800), // 14:00-14:30
    phone('clip_9987.MOV', 14, 15, 0, 1800), // 14:15-14:45, same family, no naming scheme
  ];

  it('asks, defaults to sequence, never blocks', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.lanes).toHaveLength(1);
    expect(r.question).toBeTruthy();
    expect([r.question.a.name, r.question.b.name].sort()).toEqual(['IMG_1001.MOV', 'clip_9987.MOV']);
  });

  it('answering "yes" (override time) flips to 2 lanes and clears the question', () => {
    const r = inferPlacement(items, { override: 'time' });
    expect(r.placement).toBe('time');
    expect(r.lanes).toHaveLength(2);
    expect(r.question).toBeNull();
  });
});

describe('inferPlacement — fixture 8: containment (short clip wholly inside a long one)', () => {
  const items = [
    phone('outer.mov', 14, 0, 0, 5400), // 90 min
    phone('inner.mov', 14, 30, 0, 240), // 4 min, wholly inside outer, 90 >= 3x4
  ];

  it('auto-classifies as an angle, no question asked', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.question).toBeNull();
    expect(r.lanes).toHaveLength(2);
    expect(r.lanes[0][0].item.name).toBe('outer.mov');
    expect(r.lanes[1][0].item.name).toBe('inner.mov');
  });
});

describe('inferPlacement — fixture 9: same-camera slop (fixes the phantom-angle bug)', () => {
  const items = [
    dji('DJI_0010.MP4', 14, 0, 0, 600), // 14:00:00-14:10:00
    dji('DJI_0011.MP4', 14, 9, 15, 600), // starts 45s before seg1 ends
    dji('DJI_0012.MP4', 14, 18, 30, 600), // starts 45s before seg2 ends
  ];

  it('45s slop is an artifact -> sequence placement, but time order + green trust line survive', () => {
    expect(SLOP_MAX_S).toBe(120);
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.confidence).toBe('time'); // Q4: clock evidence is still true, just not the placement
    expect(r.lanes).toHaveLength(1);
    expect(r.order.map((i) => i.name)).toEqual(['DJI_0010.MP4', 'DJI_0011.MP4', 'DJI_0012.MP4']);
    expect(r.gaps).toEqual([]); // accepted regression: slop chains drop their gap connector
  });
});

describe('inferPlacement — fixture 10: sub-second slop is not an overlap at all', () => {
  const items = [
    dji('a.mp4', 14, 0, 0, 100),
    dji('b.mp4', 14, 1, 39.6, 100), // starts 0.4s before a ends -> below OVERLAP_EPSILON_S
  ];

  it('stays on the plain time path, one lane', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    expect(r.lanes).toHaveLength(1);
  });
});

describe('inferPlacement — fixture 11: Legends pair + a real phone angle (the accepted gap)', () => {
  const items = [
    { name: '2nd-half.mp4', duration: 2700, creationTime: at(10, 0, 0) },
    { name: '1st-half.mp4', duration: 2700, creationTime: at(10, 13, 0) },
    phone('phone-clip.mp4', 8, 0, 0, 300), // disjoint from both halves - no shared clock
  ];

  it('the set rule forces sequence -- no angle is invented for the phone clip', () => {
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.lanes).toHaveLength(1);
    expect(r.order.map((i) => i.name).sort()).toEqual(
      ['1st-half.mp4', '2nd-half.mp4', 'phone-clip.mp4'].sort()
    );
  });
});

describe('inferPlacement — fixture 12: one item has no creationTime', () => {
  it('skips the time tier entirely -> counter names decide -> today\'s exact behaviour', () => {
    const items = [
      { name: 'DJI_0002.MP4', duration: 60, creationTime: at(10, 5, 0) },
      { name: 'DJI_0003.MP4', duration: 60, creationTime: null }, // missing
      { name: 'DJI_0001.MP4', duration: 60, creationTime: at(10, 0, 0) },
    ];
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.confidence).toBe('name');
    expect(r.order.map((i) => i.name)).toEqual(['DJI_0001.MP4', 'DJI_0002.MP4', 'DJI_0003.MP4']);
  });
});

describe('inferPlacement — other coverage', () => {
  it('ambiguous names, no creationTime -> confidence "unknown", natural name order', () => {
    const items = [
      { name: 'b.mp4', duration: 60, creationTime: null },
      { name: 'a.mp4', duration: 60, creationTime: null },
    ];
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    expect(r.confidence).toBe('unknown');
    expect(r.order.map((i) => i.name)).toEqual(['a.mp4', 'b.mp4']);
    expect(r.question).toBeNull();
  });

  it('a garbage clock outside the 12h placement window falls back to sequence', () => {
    const items = [
      { name: 'a.mp4', duration: 60, creationTime: at(0, 0, 0) },
      { name: 'b.mp4', duration: 60, creationTime: at(13, 0, 0) }, // 13h away -> garbage
    ];
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
  });

  it('handles the empty set', () => {
    expect(inferPlacement([])).toEqual({
      order: [], confidence: 'unknown', gaps: [], placement: 'sequence', lanes: [], spanSeconds: 0, question: null,
    });
  });

  it('exposes GAP_MIN_S as 120', () => {
    expect(GAP_MIN_S).toBe(120);
  });

  it('a manual order folds every item (including angles) into one sequential lane', () => {
    const items = [
      dji('DJI_0003.MP4', 14, 0, 0, 480),
      dji('DJI_0004.MP4', 14, 8, 0, 480),
      phone('sideline.mp4', 14, 10, 0, 240),
    ];
    const r = inferPlacement(items, { manualNames: ['sideline.mp4', 'DJI_0004.MP4', 'DJI_0003.MP4'] });
    expect(r.placement).toBe('sequence');
    expect(r.confidence).toBe('manual');
    expect(r.lanes).toHaveLength(1);
    expect(r.order.map((i) => i.name)).toEqual(['sideline.mp4', 'DJI_0004.MP4', 'DJI_0003.MP4']);
    expect(r.gaps).toEqual([]);
  });
});

// --- compute_video_offsets mirror (src/backend/app/routers/games.py) ---------
// The Python is the source of truth; this pins the JS model against its actual
// formula (zero = min(recorded_at); offset = recorded_at - zero for 'time' mode;
// prefix-sum-of-durations by payload order for 'sequence' mode).

describe('inferPlacement — offsetSeconds mirrors compute_video_offsets', () => {
  it("'time' mode: offset = recorded_at - zero (zero = earliest item)", () => {
    const items = [
      dji('DJI_0003.MP4', 17, 55, 44, 1410),
      dji('DJI_0004.MP4', 18, 19, 15, 1013),
    ];
    const r = inferPlacement(items);
    expect(r.placement).toBe('time');
    const zero = at(17, 55, 44).getTime() / 1000;
    for (const placed of r.lanes[0]) {
      const expected = placed.item.creationTime.getTime() / 1000 - zero;
      expect(placed.offsetSeconds).toBeCloseTo(expected, 5);
    }
  });

  it("'sequence' mode: offset = prefix-sum of durations by payload order", () => {
    const items = [
      { name: '2nd-half.mp4', duration: 2700, creationTime: at(10, 0, 0) },
      { name: '1st-half.mp4', duration: 2700, creationTime: at(10, 13, 0) },
    ];
    const r = inferPlacement(items);
    expect(r.placement).toBe('sequence');
    let acc = 0;
    for (const placed of r.lanes[0]) {
      expect(placed.offsetSeconds).toBe(acc);
      acc += placed.item.duration;
    }
  });
});
