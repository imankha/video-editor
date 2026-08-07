import { describe, it, expect } from 'vitest';
import {
  CARD_ASPECTS,
  INTRO_CARD_GEOMETRY,
  INTRO_CARD_MOTION,
  INTRO_CARD_TREATMENTS,
  STAGGER_ORDER,
  aspectKey,
  geometryFor,
  treatmentFor,
} from './introCardGeometry';
import { COMPOSITION, deriveComposition, TREATMENTS } from './introCardComposition';

// The Python-vs-JS number parity is guarded by the backend
// tests/test_t5210_geometry_parity.py (it re-parses this file's embedded JSON).
// These tests guard the FRONTEND consumer: the accessors and shape the editor
// (T5205) relies on.

const ALL_COMPOSITIONS = [
  COMPOSITION.TITLE_ONLY,
  COMPOSITION.HERO,
  COMPOSITION.BROADCAST,
  COMPOSITION.RECRUITING,
];
const ALL_ASPECTS = [CARD_ASPECTS.portrait, CARD_ASPECTS.landscape];

describe('aspectKey (mirrors backend intro_card_geometry.aspect_key)', () => {
  it('portrait -> 9:16, landscape + square -> 16:9', () => {
    expect(aspectKey(1080, 1920)).toBe(CARD_ASPECTS.portrait);
    expect(aspectKey(1920, 1080)).toBe(CARD_ASPECTS.landscape);
    expect(aspectKey(1000, 1000)).toBe(CARD_ASPECTS.landscape);
  });
});

describe('geometryFor', () => {
  it('every derived composition has photo + reflow + typography (all 3 roles) at both aspects (T6640)', () => {
    // T6640: static per-slot `slots` was replaced by `reflow` (anchor/rhythm)
    // + `typography` (role sizing) — the ACTUAL slot count/position is now
    // MEASURED at render time (`layout()`), not enumerated in the contract, so
    // every composition defines the SAME 3 roles regardless of fact density.
    for (const comp of ALL_COMPOSITIONS) {
      for (const aspect of ALL_ASPECTS) {
        const geo = geometryFor(comp, aspect);
        expect(geo.photo).toBeDefined();
        expect(geo.reflow).toBeDefined();
        expect(geo.reflow.anchorMode).toMatch(/^(bottom|center)$/);
        expect(geo.typography.title).toBeDefined();
        expect(geo.typography.primary).toBeDefined();
        expect(geo.typography.secondary).toBeDefined();
      }
    }
  });

  it('covers every composition deriveComposition can return', () => {
    const reachable = new Set([
      deriveComposition(false, []),
      deriveComposition(true, []),
      deriveComposition(true, ['position']),
      deriveComposition(true, ['position', 'class']),
      deriveComposition(true, ['position', 'class', 'team']),
    ]);
    for (const comp of reachable) {
      expect(INTRO_CARD_GEOMETRY[comp]).toBeDefined();
    }
  });

  it('throws on an unknown composition or aspect (no silent fallback)', () => {
    expect(() => geometryFor('nope', CARD_ASPECTS.portrait)).toThrow();
    expect(() => geometryFor(COMPOSITION.HERO, '1:1')).toThrow();
  });

  it('title typography is bounded (minSize <= size, maxLines >= 1) — the T6640 shrink-to-fit bound', () => {
    for (const comp of ALL_COMPOSITIONS) {
      for (const aspect of ALL_ASPECTS) {
        const { title } = geometryFor(comp, aspect).typography;
        expect(title.minSize).toBeGreaterThan(0);
        expect(title.minSize).toBeLessThanOrEqual(title.size);
        expect(title.maxLines).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('INTRO_CARD_MOTION', () => {
  it('exposes the push-in / stagger / flash timeline the preview animates with', () => {
    for (const k of [
      'photoPushInZoomStart',
      'photoPushInZoomEnd',
      'textStaggerFirstSt',
      'textStaggerStep',
      'textFadeD',
      'textRiseFrac',
      'flashOutD',
    ]) {
      expect(typeof INTRO_CARD_MOTION[k]).toBe('number');
    }
    expect(INTRO_CARD_MOTION.photoPushInZoomEnd).toBeGreaterThan(
      INTRO_CARD_MOTION.photoPushInZoomStart,
    );
  });

  it('STAGGER_ORDER lists title, subtitle, then the fact slots (T6570)', () => {
    expect(STAGGER_ORDER).toEqual(['title', 'subtitle', 'fact1', 'fact2', 'fact3']);
  });
});

describe('INTRO_CARD_TREATMENTS (editor swatches = render pixels)', () => {
  it('covers every treatment the toggle offers', () => {
    expect(Object.keys(INTRO_CARD_TREATMENTS).sort()).toEqual([...TREATMENTS].sort());
  });

  it('exposes a background (solid or radial endpoints) + accent per treatment', () => {
    for (const name of TREATMENTS) {
      const t = treatmentFor(name);
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
      if (t.background.type === 'solid') {
        expect(t.background.color).toMatch(/^#[0-9a-f]{6}$/i);
      } else {
        expect(t.background.type).toBe('radial');
        expect(t.background.stops.length).toBeGreaterThanOrEqual(2);
        expect(t.background.center).toHaveLength(2);
        expect(t.background.extent).toHaveLength(2);
      }
    }
  });

  it('throws on an unknown treatment', () => {
    expect(() => treatmentFor('neon')).toThrow();
  });
});
