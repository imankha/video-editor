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

// =============================================================================
// T6640 round 2 — exhaustive FACT SUBSET matrix (the acceptance criterion).
// The reported live-preview collision used Position OFF / Class+Team ON, a
// subset the original matrix never exercised (it only ever tried the maximal
// shown_fields per composition). Every combination of {position, class, team}
// on/off (2**3 = 8) is a first-class user action (unchecking a fact in the
// rail), so every one is exercised here, at both aspects, with the long
// wrapping name. jsdom has no real <canvas> (wrapLines falls back to
// text.split('\n')), so an explicit '\n' forces deterministic 2-line wrapping
// -- same technique as the invariance test above; real-canvas wrap agreement
// is proven separately by the backend matrix (real PIL fonts) and the runtime
// Playwright parity spec.
// =============================================================================
import { deriveComposition, SHOWN_FIELDS } from '../../utils/introCardComposition';

function allSubsets(items) {
  return items.reduce(
    (subsets, item) => subsets.concat(subsets.map((s) => [...s, item])),
    [[]],
  );
}

// =============================================================================
// T6640 round 3 — layout() emits the wrapped `lines` it used to reserve height
// (design §2 Option 1, §3). This closes the double-wrap: RichText renders these
// verbatim instead of re-deriving its own line count from spec.text, so the
// reserved height and the rendered height can no longer disagree. This is a
// STRUCTURAL check (does the lines array agree with the height math?), not a
// pixel/collision claim -- real-font wrap agreement is proven in the real
// browser by e2e/T5180-text-parity.spec.js, jsdom has no real <canvas>.
// =============================================================================
describe('layout — emits the wrapped `lines` it used for height reservation (T6640 round 3)', () => {
  it('every produced spec carries a `lines` array whose length matches the reserved line count', () => {
    // jsdom's wrapLines fallback is text.split('\n') (RichText.jsx), so an
    // explicit '\n' in the title text is what forces >1 line here -- same
    // technique the existing invariance test above already relies on.
    const positions = layout(
      'broadcast', '9:16',
      [['title', 'Anastasia\nWintergreen'], ['fact1', 'Midfielder'], ['fact2', '2027']],
      '#f7e28b', FRAME_W, FRAME_H,
    );
    expect(positions.title.lines).toEqual(['Anastasia', 'Wintergreen']);
    expect(positions.title.lines).toHaveLength(2);
    expect(positions.fact1.lines).toEqual(['Midfielder']);
    expect(positions.fact1.lines).toHaveLength(1);
  });

  it('buildPreviewElements forwards `lines` onto each element spec (so RichText can consume it)', () => {
    const card = { treatment: 'gold', shown_fields: ['position'] };
    const profile = { full_name: 'Anastasia\nWintergreen', position: 'Midfielder' };
    const els = buildPreviewElements(card, profile, 'broadcast', '9:16', FRAME_W, FRAME_H);
    const title = els.find((e) => e.slot === 'title');
    expect(title.spec.lines).toEqual(['Anastasia', 'Wintergreen']);
    const fact1 = els.find((e) => e.slot === 'fact1');
    expect(fact1.spec.lines).toEqual(['Midfielder']);
  });

  it('single-line text produces a `lines` array of length 1, not the bare unwrapped string', () => {
    const positions = layout(
      'broadcast', '9:16',
      [['title', 'Maya'], ['fact1', 'Midfielder']],
      '#f7e28b', FRAME_W, FRAME_H,
    );
    expect(positions.title.lines).toEqual(['Maya']);
  });
});

describe('buildPreviewElements — exhaustive fact-subset x aspect matrix never collides', () => {
  const LONG_NAME = 'Anastasia\nWintergreen'; // invented, no PII; \n forces the jsdom-fallback wrap
  const longCard = { treatment: 'gold' };
  const longProfile = {
    full_name: LONG_NAME, position: 'Midfielder', class: '2031', team: 'West Coast ECNL',
  };

  for (const shown of allSubsets(SHOWN_FIELDS)) {
    for (const aspect of ['9:16', '16:9']) {
      const label = shown.length ? shown.join('+') : 'none';
      it(`shown=[${label}] aspect=${aspect} — no overlap, stays in frame`, () => {
        const composition = deriveComposition(true, shown);
        const els = buildPreviewElements(
          { ...longCard, shown_fields: shown }, longProfile, composition, aspect, FRAME_W, FRAME_H,
        );
        expect(els.length).toBeGreaterThan(0); // title always renders (full_name set)

        // Re-derive each element's rendered height EXACTLY as layout()/
        // advanceFrac did: jsdom has no real <canvas>, so measureFontMetricsPx
        // falls back to ascent=size*0.8, descent=size*0.2 (RichText.jsx) --
        // their sum is exactly `size`, so advanceFrac === size in this
        // environment. Line count comes from the literal '\n' baked into
        // spec.text by the wrap (jsdom's wrapLines fallback), matching what
        // layout() itself measured when it positioned this element.
        const intervals = els.map((el) => {
          const lines = el.spec.text.split('\n').length;
          const y0 = el.spec.position.y;
          const y1 = y0 + lines * el.spec.size;
          return { slot: el.slot, y0, y1 };
        });
        intervals.sort((a, b) => a.y0 - b.y0);
        for (let i = 0; i < intervals.length; i++) {
          expect(intervals[i].y0).toBeGreaterThanOrEqual(-1e-6);
        }
        for (let i = 1; i < intervals.length; i++) {
          expect(intervals[i].y0).toBeGreaterThanOrEqual(intervals[i - 1].y1 - 1e-6);
        }
      });
    }
  }
});
