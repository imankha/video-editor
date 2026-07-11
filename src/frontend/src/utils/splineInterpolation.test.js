/**
 * T4250: one spline interpolator (interpolateGenericSpline) now backs both crop and
 * highlight animation.
 *
 * The crop cases are CHARACTERIZATION tests: their golden outputs pin the pre-existing
 * catmullRom math so the consolidation is proven byte-identical for crop.
 *
 * The highlight cases pin the BUG FIX: keyframed strokeOpacity/fillOpacity now
 * interpolate smoothly between keyframes (they previously snapped to the consumer's
 * `?? 0.85` default), while legacy keyframes that carry only `opacity` leave the new
 * fields undefined (never NaN).
 */
import { describe, it, expect } from 'vitest';
import {
  interpolateCropSpline,
  interpolateHighlightSpline,
  interpolateGenericSpline,
} from './splineInterpolation';

const CROP = [
  { frame: 0, x: 0, y: 0, width: 100, height: 100 },
  { frame: 10, x: 100, y: 50, width: 120, height: 110 },
  { frame: 20, x: 200, y: 0, width: 100, height: 100 },
  { frame: 30, x: 300, y: 80, width: 140, height: 120 },
];

describe('interpolateCropSpline (characterization — byte-identical after T4250)', () => {
  it('interpolates the first interval (golden values)', () => {
    expect(interpolateCropSpline(CROP, 5, 0.5)).toEqual({
      time: 0.5, frame: 5, x: 43.75, y: 28.125, width: 111.25, height: 105.625,
    });
  });

  it('interpolates a middle interval (golden values)', () => {
    expect(interpolateCropSpline(CROP, 15, 1.5)).toEqual({
      time: 1.5, frame: 15, x: 150, y: 23.125, width: 108.75, height: 104.375,
    });
  });

  it('returns the raw first keyframe at/below the start boundary', () => {
    expect(interpolateCropSpline(CROP, 0, 0)).toEqual({
      frame: 0, x: 0, y: 0, width: 100, height: 100, time: 0,
    });
  });

  it('returns the raw last keyframe at/above the end boundary', () => {
    expect(interpolateCropSpline(CROP, 30, 3)).toEqual({
      frame: 30, x: 300, y: 80, width: 140, height: 120, time: 3,
    });
  });

  it('returns the single keyframe unchanged', () => {
    expect(interpolateCropSpline([{ frame: 0, x: 1, y: 2, width: 3, height: 4 }], 5, 0.5))
      .toEqual({ frame: 0, x: 1, y: 2, width: 3, height: 4, time: 0.5 });
  });

  it('returns null for empty keyframes', () => {
    expect(interpolateCropSpline([], 5, 0.5)).toBeNull();
  });
});

describe('interpolateHighlightSpline (T4250 opacity bug fix)', () => {
  it('interpolates strokeOpacity and fillOpacity between keyframes instead of snapping', () => {
    const hl = [
      { frame: 0, x: 0, y: 0, radiusX: 10, radiusY: 10, opacity: 1, strokeOpacity: 0.2, fillOpacity: 0.2, color: '#f00' },
      { frame: 10, x: 20, y: 0, radiusX: 10, radiusY: 10, opacity: 1, strokeOpacity: 1.0, fillOpacity: 0.8, color: '#0f0' },
    ];
    const mid = interpolateHighlightSpline(hl, 5, 0.5);
    // Linear-ish midpoint on a 2-keyframe spline: 0.2->1.0 => 0.6, 0.2->0.8 => 0.5.
    expect(mid.strokeOpacity).toBeCloseTo(0.6, 5);
    expect(mid.fillOpacity).toBeCloseTo(0.5, 5);
    expect(mid.opacity).toBe(1);
    expect(mid.color).toBe('#f00'); // carried from the preceding keyframe
    expect(Number.isNaN(mid.strokeOpacity)).toBe(false);
  });

  it('clamps opacity fields to [0,1] even when the spline overshoots', () => {
    // 4 keyframes chosen so the Catmull-Rom curve overshoots above 1.0 mid-interval.
    const hl = [
      { frame: 0, x: 0, y: 0, radiusX: 10, radiusY: 10, strokeOpacity: 0.0, color: '#f00' },
      { frame: 10, x: 0, y: 0, radiusX: 10, radiusY: 10, strokeOpacity: 1.0, color: '#f00' },
      { frame: 20, x: 0, y: 0, radiusX: 10, radiusY: 10, strokeOpacity: 1.0, color: '#f00' },
      { frame: 30, x: 0, y: 0, radiusX: 10, radiusY: 10, strokeOpacity: 0.0, color: '#f00' },
    ];
    const v = interpolateHighlightSpline(hl, 15, 1.5);
    expect(v.strokeOpacity).toBeGreaterThanOrEqual(0);
    expect(v.strokeOpacity).toBeLessThanOrEqual(1);
  });

  it('leaves new opacity fields undefined for legacy keyframes (opacity only) — no NaN', () => {
    const legacy = [
      { frame: 0, x: 0, y: 0, radiusX: 10, radiusY: 10, opacity: 0.3, color: '#f00' },
      { frame: 10, x: 20, y: 0, radiusX: 10, radiusY: 10, opacity: 0.9, color: '#0f0' },
    ];
    const mid = interpolateHighlightSpline(legacy, 5, 0.5);
    expect(mid.opacity).toBeCloseTo(0.6, 5);
    expect(mid.strokeOpacity).toBeUndefined();
    expect(mid.fillOpacity).toBeUndefined();
    // Nothing is NaN.
    for (const v of Object.values(mid)) {
      expect(typeof v === 'number' ? Number.isNaN(v) : false).toBe(false);
    }
  });
});

describe('interpolateGenericSpline (property-presence guard)', () => {
  it('skips a property absent on the bracket (undefined, not NaN)', () => {
    const kfs = [
      { frame: 0, a: 10 },       // no 'b'
      { frame: 10, a: 20, b: 5 },
    ];
    const r = interpolateGenericSpline(kfs, 5, 0.5, ['a', 'b']);
    expect(typeof r.a).toBe('number');
    expect(r.b).toBeUndefined();
  });
});
