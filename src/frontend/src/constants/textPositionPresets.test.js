import { describe, it, expect } from 'vitest';
import { POSITION_PRESETS, matchPreset, presetKey, pickDefaultPreset, VerticalSlot, HorizontalSlot } from './textPositionPresets';
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

describe('pickDefaultPreset — a new element never spawns "Custom position" (T6630 round 4/7)', () => {
  // T6630 round 7: fresh user direction changed the priority order from
  // bottom-center-first to top-right-first ("Try to choose a not selected
  // position in that region starting from the top right"), walking
  // row-major from the top row, right-to-left within each row.
  it('with no siblings, picks top-right (top priority)', () => {
    const preset = pickDefaultPreset([]);
    expect(preset.vertical).toBe(VerticalSlot.TOP);
    expect(preset.horizontal).toBe(HorizontalSlot.RIGHT);
  });

  it('when top-right is taken by a sibling, falls back to top-center', () => {
    const topRight = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.TOP && p.horizontal === HorizontalSlot.RIGHT);
    const preset = pickDefaultPreset([{ position: { x: topRight.x, y: topRight.y }, align: topRight.align }]);
    expect(preset.vertical).toBe(VerticalSlot.TOP);
    expect(preset.horizontal).toBe(HorizontalSlot.MIDDLE);
  });

  it('when top-right AND top-center are taken, falls back to top-left', () => {
    const tr = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.TOP && p.horizontal === HorizontalSlot.RIGHT);
    const tc = POSITION_PRESETS.find((p) => p.vertical === VerticalSlot.TOP && p.horizontal === HorizontalSlot.MIDDLE);
    const preset = pickDefaultPreset([
      { position: { x: tr.x, y: tr.y }, align: tr.align },
      { position: { x: tc.x, y: tc.y }, align: tc.align },
    ]);
    expect(preset.vertical).toBe(VerticalSlot.TOP);
    expect(preset.horizontal).toBe(HorizontalSlot.LEFT);
  });

  it('when the entire top row is taken, falls back to center-right', () => {
    const topRow = POSITION_PRESETS.filter((p) => p.vertical === VerticalSlot.TOP);
    const preset = pickDefaultPreset(topRow.map((p) => ({ position: { x: p.x, y: p.y }, align: p.align })));
    expect(preset.vertical).toBe(VerticalSlot.CENTER);
    expect(preset.horizontal).toBe(HorizontalSlot.RIGHT);
  });

  it('when all 9 slots are taken, still returns a preset (falls back to top-right, allows overlap)', () => {
    const allSiblings = POSITION_PRESETS.map((p) => ({ position: { x: p.x, y: p.y }, align: p.align }));
    const preset = pickDefaultPreset(allSiblings);
    expect(preset).toBeTruthy();
    expect(preset.vertical).toBe(VerticalSlot.TOP);
    expect(preset.horizontal).toBe(HorizontalSlot.RIGHT);
  });

  it('a sibling with a non-preset (arbitrary/legacy) position does not block any slot', () => {
    const preset = pickDefaultPreset([{ position: { x: 0.37, y: 0.61 }, align: Align.CENTER }]);
    expect(preset.vertical).toBe(VerticalSlot.TOP);
    expect(preset.horizontal).toBe(HorizontalSlot.RIGHT);
  });

  it('a sibling with no position at all (undefined spec fields) does not crash', () => {
    expect(() => pickDefaultPreset([{}, { position: null }])).not.toThrow();
  });
});
