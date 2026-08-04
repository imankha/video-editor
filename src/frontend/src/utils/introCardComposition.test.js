import { describe, it, expect } from 'vitest';
import {
  COMPOSITION,
  deriveComposition,
  selectCardComposition,
} from './introCardComposition';

describe('deriveComposition (mirrors backend derive_composition)', () => {
  it('no photo -> title-only regardless of fact count', () => {
    expect(deriveComposition(false, [])).toBe(COMPOSITION.TITLE_ONLY);
    expect(deriveComposition(false, ['position', 'class'])).toBe(COMPOSITION.TITLE_ONLY);
  });

  it('photo + 0 facts -> title-only', () => {
    expect(deriveComposition(true, [])).toBe(COMPOSITION.TITLE_ONLY);
  });

  it('photo + 1/2/3 facts -> hero/broadcast/recruiting', () => {
    expect(deriveComposition(true, ['position'])).toBe(COMPOSITION.HERO);
    expect(deriveComposition(true, ['position', 'class'])).toBe(COMPOSITION.BROADCAST);
    expect(deriveComposition(true, ['position', 'class', 'team'])).toBe(COMPOSITION.RECRUITING);
  });

  it('tolerates a missing/undefined shownFields', () => {
    expect(deriveComposition(true, undefined)).toBe(COMPOSITION.TITLE_ONLY);
  });
});

describe('selectCardComposition (reads canonical fields, not a cached value)', () => {
  it('derives from image_key + shown_fields, ignoring any server composition field', () => {
    const card = {
      image_key: 'intro/x.jpg',
      shown_fields: ['position'],
      composition: 'STALE_SERVER_VALUE',
    };
    expect(selectCardComposition(card)).toBe(COMPOSITION.HERO);
  });

  it('no photo -> title-only', () => {
    expect(selectCardComposition({ image_key: null, shown_fields: ['team', 'class'] })).toBe(
      COMPOSITION.TITLE_ONLY,
    );
  });

  it('null card -> title-only', () => {
    expect(selectCardComposition(null)).toBe(COMPOSITION.TITLE_ONLY);
  });
});
