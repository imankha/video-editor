import { describe, it, expect } from 'vitest';
import { computeSpotlightReveal, SPOTLIGHT_REVEAL } from './spotlightReveal';

// T5250: the reveal envelope is the shared spec that keeps the editor preview and the
// backend export in lockstep. These cases pin the entrance ramp, exit ramp, easing shape
// and no-op behaviour; the mirrored Python cases in
// src/backend/tests/test_spotlight_reveal.py assert the same numbers so preview/export
// can't drift.
describe('computeSpotlightReveal', () => {
  const { ENTRANCE_SEC, EXIT_SEC, ENTRANCE_START_SCALE } = SPOTLIGHT_REVEAL;

  it('is invisible (opacity 0) exactly at region start, and starts LARGER than form-fitting (contract)', () => {
    const r = computeSpotlightReveal(0, 0, 5);
    expect(r.opacityFactor).toBe(0);
    // Entrance is a focus-pull: the ring begins oversized (>1) and contracts to 1.0.
    expect(ENTRANCE_START_SCALE).toBeGreaterThan(1);
    expect(r.radiusScale).toBeCloseTo(ENTRANCE_START_SCALE, 6);
  });

  it('is fully revealed (opacity 1, scale contracted to 1) once the entrance ramp completes', () => {
    const r = computeSpotlightReveal(ENTRANCE_SEC, 0, 5);
    expect(r.opacityFactor).toBe(1);
    expect(r.radiusScale).toBe(1);
  });

  it('CONTRACTS the radius monotonically from oversized down to 1.0 across the entrance', () => {
    const scales = [0, 0.25, 0.5, 0.75, 1].map(
      (f) => computeSpotlightReveal(ENTRANCE_SEC * f, 0, 5).radiusScale
    );
    // Strictly decreasing: big -> fitting. Every intermediate scale stays > 1.
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeLessThan(scales[i - 1]);
    }
    expect(scales[0]).toBeCloseTo(ENTRANCE_START_SCALE, 6);
    expect(scales.slice(0, -1).every((s) => s > 1)).toBe(true);
    expect(scales[scales.length - 1]).toBe(1);
  });

  it('is a no-op (1, 1) in the steady middle of a region', () => {
    const r = computeSpotlightReveal(2.5, 0, 5);
    expect(r).toEqual({ opacityFactor: 1, radiusScale: 1 });
  });

  it('ramps opacity with ease-OUT on entrance, FASTER than the contraction so the big ring reads bold', () => {
    // Opacity is ease-out CUBIC: at p=0.5 => 1 - 0.5^3 = 0.875 (well past linear 0.5).
    const r = computeSpotlightReveal(ENTRANCE_SEC / 2, 0, 5);
    expect(r.opacityFactor).toBeCloseTo(0.875, 6);
    // Radius contracts on ease-out QUAD (trails opacity): START + (1-START)*0.75, still > 1.
    expect(r.radiusScale).toBeCloseTo(ENTRANCE_START_SCALE + (1 - ENTRANCE_START_SCALE) * 0.75, 6);
    expect(r.radiusScale).toBeGreaterThan(1);
    // Opacity (0.875) leads the contraction progress (0.75) — ring is near-full bright
    // while still visibly oversized.
    expect(r.opacityFactor).toBeGreaterThan(0.75);
  });

  it('fades to 0 at region end with NO scale change on exit', () => {
    const end = 5;
    const atEnd = computeSpotlightReveal(end, 0, end);
    expect(atEnd.opacityFactor).toBe(0);
    expect(atEnd.radiusScale).toBe(1);
  });

  it('fades with ease-IN on exit (below the linear midpoint at half the exit ramp)', () => {
    const end = 5;
    // Half-way through the exit ramp: q = 0.5 remaining => opacity 0.25 < 0.5 (linear).
    const r = computeSpotlightReveal(end - EXIT_SEC / 2, 0, end);
    expect(r.opacityFactor).toBeCloseTo(0.25, 6);
    expect(r.radiusScale).toBe(1);
  });

  it('caps entrance+exit at half the region so a short region still fades symmetrically', () => {
    // 0.4s region: entrance and exit each capped to 0.2s, meeting at the midpoint.
    const dur = 0.4;
    const start = computeSpotlightReveal(0, 0, dur);
    const mid = computeSpotlightReveal(0.2, 0, dur);
    const end = computeSpotlightReveal(dur, 0, dur);
    expect(start.opacityFactor).toBe(0);
    expect(end.opacityFactor).toBe(0);
    // Midpoint is fully revealed (both ramps completed there).
    expect(mid.opacityFactor).toBe(1);
    expect(mid.radiusScale).toBe(1);
  });

  it('never touches keyframe data — returns only display multipliers', () => {
    const r = computeSpotlightReveal(0.1, 0, 5);
    expect(Object.keys(r).sort()).toEqual(['opacityFactor', 'radiusScale']);
  });

  it('is a safe no-op for degenerate / missing bounds', () => {
    expect(computeSpotlightReveal(1, null, 5)).toEqual({ opacityFactor: 1, radiusScale: 1 });
    expect(computeSpotlightReveal(1, 5, 5)).toEqual({ opacityFactor: 1, radiusScale: 1 }); // zero-length
    expect(computeSpotlightReveal(1, 5, 2)).toEqual({ opacityFactor: 1, radiusScale: 1 }); // inverted
  });

  // T5250 follow-up: the reveal is an opt-in per-project setting, default OFF. `enabled`
  // is a 4th param on the shared spec itself (not a pre-check at the call site) so preview
  // and export decide "off" identically — mirrored in test_spotlight_reveal.py.
  describe('enabled gate (default OFF setting)', () => {
    it('defaults to enabled=true when the 4th arg is omitted (back-compat)', () => {
      const withArg = computeSpotlightReveal(ENTRANCE_SEC / 2, 0, 5, true);
      const omitted = computeSpotlightReveal(ENTRANCE_SEC / 2, 0, 5);
      expect(omitted).toEqual(withArg);
    });

    it('enabled=false returns the identity at every point in the cycle — byte-identical to pre-T5250 rendering', () => {
      const dur = 5;
      for (const t of [0, ENTRANCE_SEC / 2, ENTRANCE_SEC, 2.5, dur - EXIT_SEC / 2, dur]) {
        expect(computeSpotlightReveal(t, 0, dur, false)).toEqual({ opacityFactor: 1, radiusScale: 1 });
      }
    });

    it('enabled=false at exact region start does NOT pop invisible — identity, not the entrance-start scale', () => {
      // Sanity check that "off" isn't just "always mid-entrance" — it must skip the
      // envelope entirely, not evaluate it and hide the result.
      const r = computeSpotlightReveal(0, 0, 5, false);
      expect(r.opacityFactor).toBe(1);
      expect(r.radiusScale).toBe(1);
    });
  });
});
