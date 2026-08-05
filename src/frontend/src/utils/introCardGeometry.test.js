import { describe, it, expect } from 'vitest';
import {
  CARD_ASPECTS,
  INTRO_CARD_GEOMETRY,
  INTRO_CARD_MOTION,
  STAGGER_ORDER,
  aspectKey,
  geometryFor,
} from './introCardGeometry';
import { COMPOSITION, deriveComposition } from './introCardComposition';

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
  it('every derived composition has geometry at both aspects', () => {
    for (const comp of ALL_COMPOSITIONS) {
      for (const aspect of ALL_ASPECTS) {
        const geo = geometryFor(comp, aspect);
        expect(geo.photo).toBeDefined();
        expect(geo.slots).toBeDefined();
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

  it('fact-slot count matches the derived density', () => {
    const expected = {
      [COMPOSITION.TITLE_ONLY]: 0,
      [COMPOSITION.HERO]: 1,
      [COMPOSITION.BROADCAST]: 2,
      [COMPOSITION.RECRUITING]: 3,
    };
    for (const comp of ALL_COMPOSITIONS) {
      for (const aspect of ALL_ASPECTS) {
        const factSlots = Object.keys(geometryFor(comp, aspect).slots).filter((s) =>
          s.startsWith('fact'),
        );
        expect(factSlots).toHaveLength(expected[comp]);
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

  it('STAGGER_ORDER lists title/subtitle then the fact slots', () => {
    expect(STAGGER_ORDER).toEqual(['title', 'subtitle', 'fact1', 'fact2', 'fact3']);
  });
});
