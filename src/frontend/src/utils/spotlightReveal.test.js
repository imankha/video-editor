import { describe, it, expect } from 'vitest';
import { computeSpotlightReveal, SPOTLIGHT_REVEAL } from './spotlightReveal';

// T5250: the envelope is the shared spec that keeps the editor preview and the backend
// export in lockstep. The spotlight is FULL at the region start and stays full through the
// region; the ONLY animation is the exit fade-out. There is NO entrance animation. The
// mirrored Python cases in src/backend/tests/test_spotlight_reveal.py assert the same
// numbers so preview/export can't drift.
describe('computeSpotlightReveal', () => {
  const { EXIT_SEC } = SPOTLIGHT_REVEAL;

  it('is FULL (opacity 1, scale 1) exactly at region start — no entrance animation', () => {
    const r = computeSpotlightReveal(0, 0, 5);
    expect(r).toEqual({ opacityFactor: 1, radiusScale: 1 });
  });

  it('is FULL just after region start (no fade-in, no contract)', () => {
    const r = computeSpotlightReveal(0.2, 0, 5);
    expect(r).toEqual({ opacityFactor: 1, radiusScale: 1 });
  });

  it('is a no-op (1, 1) in the steady middle of a region', () => {
    const r = computeSpotlightReveal(2.5, 0, 5);
    expect(r).toEqual({ opacityFactor: 1, radiusScale: 1 });
  });

  it('is still FULL right up until the exit ramp begins', () => {
    const end = 5;
    // Exit ramp is the last EXIT_SEC; a hair before it, the spotlight is still full.
    const r = computeSpotlightReveal(end - EXIT_SEC - 0.01, 0, end);
    expect(r).toEqual({ opacityFactor: 1, radiusScale: 1 });
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

  it('caps the exit ramp at half the region so a short region still fades to 0 at the end', () => {
    // 0.4s region: exit capped to 0.2s. Full at start + steady middle, fades to 0 at end.
    const dur = 0.4;
    expect(computeSpotlightReveal(0, 0, dur)).toEqual({ opacityFactor: 1, radiusScale: 1 });
    expect(computeSpotlightReveal(0.2, 0, dur)).toEqual({ opacityFactor: 1, radiusScale: 1 });
    expect(computeSpotlightReveal(dur, 0, dur).opacityFactor).toBe(0);
  });

  it('never touches keyframe data — returns only display multipliers', () => {
    const r = computeSpotlightReveal(4.9, 0, 5);
    expect(Object.keys(r).sort()).toEqual(['opacityFactor', 'radiusScale']);
  });

  it('is a safe no-op for degenerate / missing bounds', () => {
    expect(computeSpotlightReveal(1, null, 5)).toEqual({ opacityFactor: 1, radiusScale: 1 });
    expect(computeSpotlightReveal(1, 5, 5)).toEqual({ opacityFactor: 1, radiusScale: 1 }); // zero-length
    expect(computeSpotlightReveal(1, 5, 2)).toEqual({ opacityFactor: 1, radiusScale: 1 }); // inverted
  });
});
