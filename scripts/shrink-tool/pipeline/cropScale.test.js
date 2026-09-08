import { describe, it, expect } from 'vitest';
import { resolveCropRect } from './cropScale.js';

describe('resolveCropRect', () => {
  it('passes through a centered, in-range crop', () => {
    const rect = resolveCropRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1000, 1000);
    expect(rect).toEqual({ sx: 250, sy: 250, sw: 500, sh: 500 });
  });

  it('clamps width and height to a 10% floor per axis', () => {
    const rect = resolveCropRect({ x: 0.5, y: 0.5, w: 0.01, h: 0.02 }, 1000, 2000);
    expect(rect.sw).toBe(100); // 10% of 1000
    expect(rect.sh).toBe(200); // 10% of 2000
  });

  it('clamps a rect that would spill past the right/bottom edge', () => {
    const rect = resolveCropRect({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 1000, 1000);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1000);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(1000);
    expect(rect.sw).toBeGreaterThanOrEqual(100); // still respects the 10% floor
  });

  it('clamps out-of-range (negative / >1) input', () => {
    const rect = resolveCropRect({ x: -0.5, y: -0.5, w: 1.5, h: 1.5 }, 800, 600);
    expect(rect.sx).toBeGreaterThanOrEqual(0);
    expect(rect.sy).toBeGreaterThanOrEqual(0);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(800);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(600);
  });

  it('clamps non-finite input (NaN) to a safe rect rather than throwing', () => {
    const rect = resolveCropRect({ x: NaN, y: NaN, w: NaN, h: NaN }, 800, 600);
    expect(Number.isFinite(rect.sx)).toBe(true);
    expect(Number.isFinite(rect.sy)).toBe(true);
    expect(rect.sw).toBeGreaterThan(0);
    expect(rect.sh).toBeGreaterThan(0);
  });

  it('handles odd source sizes without producing a negative or zero rect', () => {
    const rect = resolveCropRect({ x: 0.33, y: 0.33, w: 0.33, h: 0.33 }, 1921, 1081);
    expect(rect.sw).toBeGreaterThan(0);
    expect(rect.sh).toBeGreaterThan(0);
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(1921);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(1081);
  });

  it('the full-frame reset (double-click outside) yields the whole source', () => {
    const rect = resolveCropRect({ x: 0, y: 0, w: 1, h: 1 }, 640, 360);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: 640, sh: 360 });
  });
});
