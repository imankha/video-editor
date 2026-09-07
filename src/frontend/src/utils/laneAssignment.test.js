import { describe, it, expect } from 'vitest';
import { OVERLAP_EPSILON_S, intervalsOverlap, assignLanes } from './laneAssignment';

describe('OVERLAP_EPSILON_S / intervalsOverlap', () => {
  it('is 1.0s', () => {
    expect(OVERLAP_EPSILON_S).toBe(1.0);
  });

  it('treats sub-epsilon overlap as adjacent (no overlap)', () => {
    expect(intervalsOverlap({ start: 0, end: 10.4 }, { start: 10, end: 20 })).toBe(false);
  });

  it('treats beyond-epsilon overlap as overlapping', () => {
    expect(intervalsOverlap({ start: 0, end: 12 }, { start: 10, end: 20 })).toBe(true);
  });
});

describe('assignLanes', () => {
  it('returns empty result for no intervals', () => {
    const { laneOf, backbone, laneCount } = assignLanes([]);
    expect(laneOf.size).toBe(0);
    expect(backbone).toEqual([]);
    expect(laneCount).toBe(0);
  });

  it('a single interval is lane 0, the backbone, one lane total', () => {
    const { laneOf, backbone, laneCount } = assignLanes([
      { key: 'a', start: 0, end: 100, duration: 100 },
    ]);
    expect(laneOf.get('a')).toBe(0);
    expect(backbone).toEqual(['a']);
    expect(laneCount).toBe(1);
  });

  it('non-overlapping intervals all land on the backbone (lane 0), minimal lanes', () => {
    const { laneOf, backbone, laneCount } = assignLanes([
      { key: 'a', start: 0, end: 100, duration: 100 },
      { key: 'b', start: 100, end: 200, duration: 100 },
      { key: 'c', start: 400, end: 500, duration: 100 },
    ]);
    expect(laneOf.get('a')).toBe(0);
    expect(laneOf.get('b')).toBe(0);
    expect(laneOf.get('c')).toBe(0);
    expect(backbone).toEqual(['a', 'b', 'c']);
    expect(laneCount).toBe(1);
  });

  it('backbone-anchoring: the LONGEST interval is lane 0 even if it starts later (no lane-0 inversion)', () => {
    // A short clip starts before a much longer one and overlaps it -- the naive
    // "earliest interval wins lane 0" greedy would put the short clip on the
    // backbone and turn the long "main camera" into an angle. Must not happen.
    const { laneOf, backbone } = assignLanes([
      { key: 'short', start: -10, end: 40, duration: 50 },
      { key: 'long', start: 0, end: 1500, duration: 1500 },
    ]);
    expect(backbone).toEqual(['long']);
    expect(laneOf.get('long')).toBe(0);
    expect(laneOf.get('short')).toBe(1);
  });

  it('a single interval wholly inside a longer one is an angle on lane 1 (minimal lanes)', () => {
    const { laneOf, backbone, laneCount } = assignLanes([
      { key: 'main', start: 0, end: 1500, duration: 1500 },
      { key: 'sideline', start: 600, end: 900, duration: 300 },
    ]);
    expect(backbone).toEqual(['main']);
    expect(laneOf.get('main')).toBe(0);
    expect(laneOf.get('sideline')).toBe(1);
    expect(laneCount).toBe(2);
  });

  it('two angles that overlap each other need two distinct angle lanes (3 lanes total)', () => {
    const { laneOf, laneCount } = assignLanes([
      { key: 'main', start: 0, end: 1500, duration: 1500 },
      { key: 'phoneA', start: 600, end: 960, duration: 360 },
      { key: 'phoneB', start: 650, end: 950, duration: 300 },
    ]);
    expect(laneOf.get('main')).toBe(0);
    expect(laneOf.get('phoneA')).toBe(1);
    expect(laneOf.get('phoneB')).toBe(2);
    expect(laneCount).toBe(3);
  });

  it('two angles that do NOT overlap each other share lane 1 (minimal-lane greedy)', () => {
    const { laneOf, laneCount } = assignLanes([
      { key: 'main', start: 0, end: 1500, duration: 1500 },
      { key: 'phoneA', start: 100, end: 200, duration: 100 },
      { key: 'phoneB', start: 300, end: 400, duration: 100 },
    ]);
    expect(laneOf.get('main')).toBe(0);
    expect(laneOf.get('phoneA')).toBe(1);
    expect(laneOf.get('phoneB')).toBe(1);
    expect(laneCount).toBe(2);
  });

  it('epsilon tolerance: sub-second overlap does not force a second angle lane', () => {
    const { laneOf, laneCount } = assignLanes([
      { key: 'main', start: 0, end: 1500, duration: 1500 },
      { key: 'phoneA', start: 100, end: 200.4, duration: 100.4 },
      { key: 'phoneB', start: 200, end: 300, duration: 100 },
    ]);
    expect(laneOf.get('phoneA')).toBe(1);
    expect(laneOf.get('phoneB')).toBe(1);
    expect(laneCount).toBe(2);
  });

  it('an angle running past the main camera end still colors as an angle', () => {
    const { laneOf, backbone } = assignLanes([
      { key: 'main', start: 0, end: 1000, duration: 1000 },
      { key: 'trailing', start: 900, end: 1200, duration: 300 },
    ]);
    expect(backbone).toEqual(['main']);
    expect(laneOf.get('trailing')).toBe(1);
  });
});
