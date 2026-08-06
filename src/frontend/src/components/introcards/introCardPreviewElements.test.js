// T6640 — preview element assembly must mirror player_intro._select_elements +
// intro_card_geometry.layout: typography is TEMPLATE-owned via a fixed ROLE per
// slot (never per-card styling), position/size are MEASURED (not a fixed
// per-slot lookup), title text from the profile full name ALWAYS (T6620; dead
// title_text), blank facts/subtitle omitted, ordinal fact{N} <- shown_fields[N-1].

import { describe, it, expect } from 'vitest';
import { buildPreviewElements, layout } from './introCardPreviewElements';
import { geometryFor, ROLE_FOR_SLOT } from '../../utils/introCardGeometry';

const FRAME_W = 1080;
const FRAME_H = 1920;

describe('layout — measured, anchored stack (JS mirror of intro_card_geometry.layout)', () => {
  it('resolves colour from ROLE (title/primary -> accent, secondary -> muted)', () => {
    const positions = layout(
      'recruiting', '9:16',
      [['title', 'Maya'], ['fact1', 'Midfielder'], ['fact2', '2027']],
      '#f7e28b', FRAME_W, FRAME_H,
    );
    expect(positions.title.color).toBe('#f7e28b');
    expect(positions.fact1.color).toBe('#f7e28b'); // primary -> accent
    expect(positions.fact2.color).not.toBe('#f7e28b'); // secondary -> muted
  });

  it('a wrapped (long) title never moves the facts below it (bottom anchor invariance)', () => {
    // jsdom has no real <canvas>, so `wrapLines` falls back to `text.split('\n')`
    // (see RichText.jsx) -- real greedy-wrap-by-width is exercised in the
    // backend's equivalent test (real PIL fonts) and by the runtime Playwright
    // parity spec (T6640 design §2c), not here. An EXPLICIT '\n' still forces
    // the jsdom fallback to report 2 lines, which is enough to unit-test the
    // STACKING MATH (this invariance) independent of the wrap algorithm itself.
    const short = layout(
      'recruiting', '9:16',
      [['title', 'Maya'], ['fact1', 'Midfielder'], ['fact2', '2027'], ['fact3', 'West Coast Elite ECNL']],
      '#f7e28b', FRAME_W, FRAME_H,
    );
    const long = layout(
      'recruiting', '9:16',
      [['title', 'Anastasia\nWintergreen'], ['fact1', 'Midfielder'], ['fact2', '2027'], ['fact3', 'West Coast Elite ECNL']],
      '#f7e28b', FRAME_W, FRAME_H,
    );
    expect(long.fact1.y).toBeCloseTo(short.fact1.y, 9);
    expect(long.fact2.y).toBeCloseTo(short.fact2.y, 9);
    expect(long.fact3.y).toBeCloseTo(short.fact3.y, 9);
    // The title itself DID move (grew upward into empty space).
    expect(long.title.y).not.toBeCloseTo(short.title.y, 3);
  });
});

describe('buildPreviewElements — ordinal geometry <- semantic fields, template typography', () => {
  const card = { treatment: 'gold', title_text: 'CHAMPION', shown_fields: ['team', 'position'] };
  const profile = { full_name: 'Jordan Vega', position: 'Striker', team: 'Rovers', class: '' };

  it('maps the Nth shown fact to fact{N} (ORDINAL slot) with the profile value, in ROLE order', () => {
    // T6640: `.slot` IS the ordinal geometry key now (text_elements — the only
    // reason a SEMANTIC slot key existed — is dead). shown_fields = ['team',
    // 'position'] -> team is fact1 (primary role), position is fact2 (secondary).
    const els = buildPreviewElements(card, profile, 'broadcast', '9:16', FRAME_W, FRAME_H);
    expect(els.map((e) => e.slot)).toEqual(['title', 'fact1', 'fact2']);
    const fact1 = els.find((e) => e.slot === 'fact1');
    expect(fact1.spec.text).toBe('Rovers'); // team, shown_fields[0]
    expect(fact1.kind).toBe(ROLE_FOR_SLOT.fact1); // 'primary'
    const fact2 = els.find((e) => e.slot === 'fact2');
    expect(fact2.spec.text).toBe('Striker'); // position, shown_fields[1]
    expect(fact2.kind).toBe(ROLE_FOR_SLOT.fact2); // 'secondary'
  });

  it('omits a shown fact whose profile value is blank (never a blank line)', () => {
    const els = buildPreviewElements(
      { ...card, shown_fields: ['class', 'position'] },
      profile, 'broadcast', '9:16', FRAME_W, FRAME_H,
    );
    // class (shown_fields[0]) is blank -> omitted; position still renders at
    // fact2's ORDINAL slot (numbering follows shown_fields INDEX, not count).
    expect(els.map((e) => e.slot)).toEqual(['title', 'fact2']);
    expect(els.find((e) => e.slot === 'fact2').spec.text).toBe('Striker');
  });

  it('omits the title when the profile full name is blank (T6620)', () => {
    const els = buildPreviewElements(
      { ...card, title_text: 'CHAMPION' },
      { ...profile, full_name: '  ' },
      'hero', '9:16', FRAME_W, FRAME_H,
    );
    expect(els.find((e) => e.slot === 'title')).toBeUndefined();
  });

  it('sources the title from the profile full name, ignoring a legacy title_text', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', title_text: 'Legacy', shown_fields: [] },
      { ...profile, full_name: 'Jordan Vega' },
      'title-only', '9:16', FRAME_W, FRAME_H,
    );
    expect(els.find((e) => e.slot === 'title').spec.text).toBe('Jordan Vega');
  });

  it('omits the title when full_name is unset (even with a dead title_text)', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', title_text: 'Legacy', shown_fields: [] },
      { position: 'Striker' }, // no full_name
      'title-only', '9:16', FRAME_W, FRAME_H,
    );
    expect(els.find((e) => e.slot === 'title')).toBeUndefined();
  });

  it('renders the card subtitle at the subtitle slot when present, between title and facts', () => {
    const els = buildPreviewElements(
      { ...card, subtitle_text: 'State Cup 2027' },
      profile, 'broadcast', '9:16', FRAME_W, FRAME_H,
    );
    const sub = els.find((e) => e.slot === 'subtitle');
    expect(sub.spec.text).toBe('State Cup 2027');
    expect(sub.kind).toBe(ROLE_FOR_SLOT.subtitle); // 'secondary'
    expect(els.map((e) => e.slot)).toEqual(['title', 'subtitle', 'fact1', 'fact2']);
  });

  it('omits the subtitle when subtitle_text is blank', () => {
    const els = buildPreviewElements({ ...card, subtitle_text: '  ' }, profile, 'hero', '9:16', FRAME_W, FRAME_H);
    expect(els.find((e) => e.slot === 'subtitle')).toBeUndefined();
  });

  it('every element carries the geometry-derived maxWidth/align (never per-card styling)', () => {
    const els = buildPreviewElements(card, profile, 'broadcast', '9:16', FRAME_W, FRAME_H);
    const geo = geometryFor('broadcast', '9:16');
    for (const el of els) {
      expect(el.spec.maxWidth).toBe(geo.reflow.maxWidth);
      expect(el.spec.align).toBe(geo.reflow.align);
    }
  });

  it('returns [] for a card with no title, subtitle or facts', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', shown_fields: [] }, {}, 'title-only', '9:16', FRAME_W, FRAME_H,
    );
    expect(els).toEqual([]);
  });
});
