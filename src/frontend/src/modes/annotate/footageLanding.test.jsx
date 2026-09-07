import { describe, it, expect } from 'vitest';
import { computeLandingOutcomes, LANDING } from './footageLanding';

/**
 * T8910: the three landing variants for footage added inside Annotate are easy
 * to get subtly wrong, so they're pinned here against the SERVER-computed
 * offsets (never re-inferred from raw timestamps). Synthetic descriptor lists
 * mirror the epic's real cases (EPIC.md "Test fixtures").
 */

const v = (sequence, duration, offset_seconds, extra = {}) => ({
  sequence,
  duration,
  offset_seconds,
  original_filename: extra.original_filename ?? `clip${sequence}.mp4`,
  recorded_at: extra.recorded_at ?? null,
});

describe('computeLandingOutcomes (T8910)', () => {
  it('classifies an overlapping added video as ANGLE with its lane start position', () => {
    // seq1 is the long main camera; seq2 is a short clip filmed DURING it.
    const videos = [
      v(1, 100, 0, { original_filename: 'main.mp4', recorded_at: '2026-07-18T18:00:00Z' }),
      v(2, 30, 20, { original_filename: 'sideline.mp4', recorded_at: '2026-07-18T18:00:20Z' }),
    ];
    const [out] = computeLandingOutcomes(videos, 1);
    expect(out.variant).toBe(LANDING.ANGLE);
    expect(out.sequence).toBe(2);
    expect(out.name).toBe('sideline');
    expect(out.pos).toBeCloseTo(20, 1);
  });

  it('classifies a no-timestamp appended video (offset == prefix-sum) as AMBER at the end', () => {
    const videos = [
      v(1, 100, 0),
      v(2, 50, 100, { recorded_at: null }), // prefix-sum placement, no evidence
    ];
    const [out] = computeLandingOutcomes(videos, 1);
    expect(out.variant).toBe(LANDING.AMBER);
    expect(out.sequence).toBe(2);
    expect(out.pos).toBeCloseTo(100, 1);
    expect(out.virtualEnd).toBeCloseTo(150, 1);
  });

  it('treats a >12h-window video (recorded_at present but placed by prefix-sum) as AMBER, not MAIN', () => {
    // Backend stored recorded_at as evidence but placed by prefix-sum because the
    // clock was outside the 12h window — offset therefore EQUALS the prefix-sum.
    // A `recorded_at == null` check alone would wrongly call this MAIN.
    const videos = [
      v(1, 100, 0),
      v(2, 40, 100, { recorded_at: '2019-01-01T00:00:00Z' }),
    ];
    const [out] = computeLandingOutcomes(videos, 1);
    expect(out.variant).toBe(LANDING.AMBER);
  });

  it('classifies a clock-placed non-overlapping half (gap) as MAIN', () => {
    // Second half placed by wall clock into a gap: offset (250) differs from the
    // prefix-sum (100), and it does not overlap -> main track, real timing.
    const videos = [
      v(1, 100, 0, { recorded_at: '2026-07-18T18:00:00Z' }),
      v(2, 50, 250, { recorded_at: '2026-07-18T18:04:10Z' }),
    ];
    const [out] = computeLandingOutcomes(videos, 1);
    expect(out.variant).toBe(LANDING.MAIN);
    expect(out.sequence).toBe(2);
  });

  it('handles a single-video game gaining its first extra video (single->multi)', () => {
    const videos = [v(1, 120, 0), v(2, 60, 120, { recorded_at: null })];
    const outcomes = computeLandingOutcomes(videos, 1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].variant).toBe(LANDING.AMBER);
  });

  it('classifies each of several appended videos (addedCount tail)', () => {
    const videos = [v(1, 100, 0), v(2, 50, 100), v(3, 40, 150)];
    const outcomes = computeLandingOutcomes(videos, 2);
    expect(outcomes.map((o) => o.sequence)).toEqual([2, 3]);
    expect(outcomes.every((o) => o.variant === LANDING.AMBER)).toBe(true);
  });

  it('returns nothing when zero rows were added (dedup no-op)', () => {
    expect(computeLandingOutcomes([v(1, 100, 0)], 0)).toEqual([]);
    expect(computeLandingOutcomes([], 1)).toEqual([]);
  });
});
