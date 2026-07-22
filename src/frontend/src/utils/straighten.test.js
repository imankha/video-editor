import { describe, it, expect } from 'vitest';
import { correctionAngle, clampRotation } from './straighten';
import { MAX_ROT } from './rotationSafeArea';

/**
 * T5640 — straighten-tool angle math.
 *
 * theta = content-correction angle (deg), positive = CCW. correctionAngle reduces
 * a screen-space drag (y-down) mod 90 into (-45, 45], so the user drags along
 * whatever should be level (horizon) OR vertical (goalpost).
 */
describe('correctionAngle', () => {
  it('is 0 for a perfectly horizontal drag', () => {
    expect(correctionAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0, 6);
  });

  it('normalizes a horizon tilted +2 degrees (down-to-the-right) to theta = -2', () => {
    // A reference line that slopes down to the right by 2 degrees in screen space
    // (y-down): dy = tan(2deg) * dx.
    const dx = 100;
    const dy = Math.tan((2 * Math.PI) / 180) * dx;
    expect(correctionAngle({ x: 0, y: 0 }, { x: dx, y: dy })).toBeCloseTo(-2, 4);
  });

  it('reduces a near-vertical (goalpost) drag into (-45, 45]', () => {
    // Nearly straight down, tilted a couple degrees off vertical.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: Math.tan((3 * Math.PI) / 180) * 100, y: 100 };
    const theta = correctionAngle(p0, p1);
    expect(theta).toBeGreaterThan(-45);
    expect(theta).toBeLessThanOrEqual(45);
    // A 3-degree lean off vertical corrects to +3 (CCW) here.
    expect(theta).toBeCloseTo(3, 4);
  });

  it('keeps the reduced result within (-45, 45] for an arbitrary drag', () => {
    const theta = correctionAngle({ x: 0, y: 0 }, { x: -30, y: 80 });
    expect(theta).toBeGreaterThan(-45);
    expect(theta).toBeLessThanOrEqual(45);
  });
});

describe('clampRotation', () => {
  it('caps at +MAX_ROT', () => {
    expect(clampRotation(35)).toBe(MAX_ROT);
  });

  it('caps at -MAX_ROT', () => {
    expect(clampRotation(-35)).toBe(-MAX_ROT);
  });

  it('passes through values within the cap', () => {
    expect(clampRotation(7.3)).toBe(7.3);
    expect(clampRotation(-12)).toBe(-12);
  });
});
