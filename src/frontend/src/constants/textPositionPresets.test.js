import { describe, it, expect } from 'vitest';
import { POSITION_PRESETS, matchPreset, presetKey, VerticalSlot, HorizontalSlot } from './textPositionPresets';
import { Align } from './textSpec';

describe('textPositionPresets — the 9 canonical anchors (T6630 round 3)', () => {
  it('defines exactly 9 presets (3 vertical x 3 horizontal)', () => {
    expect(POSITION_PRESETS).toHaveLength(9);
  });

  it('every preset has a unique (vertical, horizontal) key', () => {
    const keys = POSITION_PRESETS.map((p) => presetKey(p.vertical, p.horizontal));
    expect(new Set(keys).size).toBe(9);
  });

  it('horizontal slot pairs with the align that makes its x inset read correctly', () => {
    for (const p of POSITION_PRESETS) {
      if (p.horizontal === HorizontalSlot.LEFT) expect(p.align).toBe(Align.LEFT);
      if (p.horizontal === HorizontalSlot.MIDDLE) expect(p.align).toBe(Align.CENTER);
      if (p.horizontal === HorizontalSlot.RIGHT) expect(p.align).toBe(Align.RIGHT);
    }
  });

  it('x/y are fractional (0-1), matching the existing TextSpec position contract', () => {
    for (const p of POSITION_PRESETS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('matchPreset finds the exact preset for a stored position+align', () => {
    const topLeft = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.TOP && p.horizontal === HorizontalSlot.LEFT);
    const match = matchPreset({ x: topLeft.x, y: topLeft.y }, topLeft.align);
    expect(match).not.toBeNull();
    expect(match.vertical).toBe(VerticalSlot.TOP);
    expect(match.horizontal).toBe(HorizontalSlot.LEFT);
  });

  it('matchPreset tolerates tiny float drift (epsilon)', () => {
    const centerMiddle = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.CENTER && p.horizontal === HorizontalSlot.MIDDLE);
    const match = matchPreset({ x: centerMiddle.x + 0.001, y: centerMiddle.y - 0.001 }, centerMiddle.align);
    expect(match).not.toBeNull();
  });

  it('matchPreset returns null for an arbitrary (non-preset) stored position -- never snaps', () => {
    const match = matchPreset({ x: 0.37, y: 0.61 }, Align.CENTER);
    expect(match).toBeNull();
  });

  it('matchPreset returns null when position is missing (guards against crashing on legacy data)', () => {
    expect(matchPreset(null, Align.CENTER)).toBeNull();
    expect(matchPreset(undefined, Align.CENTER)).toBeNull();
  });

  it('matchPreset requires align to also match — same x/y with a different align is not a preset hit', () => {
    const topMiddle = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.TOP && p.horizontal === HorizontalSlot.MIDDLE);
    const match = matchPreset({ x: topMiddle.x, y: topMiddle.y }, Align.LEFT);
    expect(match).toBeNull();
  });
});
