import { describe, it, expect } from 'vitest';
import { mergeMoments } from './merge.js';

let n = 0;
const ent = (index, stamp_s, label, dur, crc = ++n * 1000 + index, size = 100 + index) => ({
  name: `${index} x_-_${label}.mp4`, index, stamp_s, label, durationS: dur, crc32: crc, size, compressedSize: size,
});

describe('mergeMoments', () => {
  it('collapses exact duplicates (same crc+size), unions labels', () => {
    const r = mergeMoments([ent(33, 100, 'Shot on goal', 25, 5, 9), ent(34, 100, 'Goal', 25, 5, 9)]);
    expect(r.afterDedupe).toBe(1);
    expect(r.moments).toHaveLength(1);
    expect(r.moments[0].labels).toEqual(['Goal', 'Shot on goal']);
  });

  it('folds heavy overlap into one moment spanning the union, Goal first', () => {
    const r = mergeMoments([ent(5, 883, 'Shot on goal', 25), ent(6, 884, 'Goal', 25), ent(7, 885, 'Attack', 15)]);
    expect(r.afterDedupe).toBe(3);
    expect(r.moments).toHaveLength(1);
    const m = r.moments[0];
    expect(m.labels).toEqual(['Goal', 'Shot on goal', 'Attack']);
    expect(m.stamp_s).toBe(883);
    expect(m.duration_s).toBe(26);
    expect(m.entries).toHaveLength(3);
    expect(m.entries.filter((x) => x.upload)).toHaveLength(1);
    expect(m.entries.find((x) => x.upload).label).toBe('Goal');
  });

  it('keeps clips overlapping by half or less apart', () => {
    const r = mergeMoments([ent(1, 0, 'Attack', 20), ent(2, 10, 'Attack', 20)]);
    expect(r.moments).toHaveLength(2);
  });

  it('folds when overlap exceeds half the shorter clip', () => {
    const r = mergeMoments([ent(1, 0, 'Attack', 20), ent(2, 9, 'Attack', 10)]);
    expect(r.moments).toHaveLength(1);
  });

  it('sorts by stamp; unknown labels pass through verbatim and rank last', () => {
    const r = mergeMoments([ent(2, 500, 'Zebra', 10), ent(1, 100, 'Highlight', 10), ent(3, 100, 'Foo Bar', 10)]);
    expect(r.moments.map((m) => m.stamp_s)).toEqual([100, 500]);
    expect(r.moments[0].labels).toEqual(['Highlight', 'Foo Bar']);
  });

  it('priority Goal > Shot on goal > Attack > Defence > Highlight', () => {
    const r = mergeMoments([
      ent(1, 0, 'Highlight', 10), ent(2, 0, 'Defence', 10), ent(3, 0, 'Attack', 10),
      ent(4, 0, 'Shot on goal', 10), ent(5, 0, 'Goal', 10),
    ]);
    expect(r.moments[0].labels).toEqual(['Goal', 'Shot on goal', 'Attack', 'Defence', 'Highlight']);
  });

  it('throws when an entry has no duration (no silent fallback)', () => {
    expect(() => mergeMoments([{ ...ent(1, 0, 'Goal', 10), durationS: undefined }])).toThrow(/duration/i);
  });
});
