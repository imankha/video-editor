// T5205 — preview element assembly must mirror player_intro._merge_spec: styling
// (font/colour/shadow/stroke) from text_elements, LAYOUT (size/align/position/
// maxWidth) from the contract geometry (layout always wins), text from
// title_text/profile, blank facts omitted, ordinal fact{N} <- shown_fields[N-1].

import { describe, it, expect } from 'vitest';
import { buildPreviewElements, mergeSpec, defaultStyling, DEFAULT_TITLE_FONT, DEFAULT_FACT_FONT } from './introCardPreviewElements';
import { geometryFor } from '../../utils/introCardGeometry';

describe('mergeSpec — layout always wins over stored styling', () => {
  it('takes size/align/position/maxWidth from geometry, font/colour/shadow from styling', () => {
    const slotGeo = { x: 0.5, y: 0.74, size: 0.066, maxWidth: 0.9, align: 'center' };
    const styling = { font: 'graduate', color: '#123456', size: 0.5, align: 'left', shadow: { blur: 0.1, color: '#000', opacity: 0.5 } };
    const spec = mergeSpec(styling, 'HELLO', slotGeo, 'title', '#f7e28b');
    expect(spec.size).toBe(0.066); // geometry, NOT styling's 0.5
    expect(spec.align).toBe('center'); // geometry, NOT styling's 'left'
    expect(spec.position).toEqual({ x: 0.5, y: 0.74 });
    expect(spec.maxWidth).toBe(0.9);
    expect(spec.font).toBe('graduate'); // styling
    expect(spec.color).toBe('#123456'); // styling
    expect(spec.shadow.blur).toBe(0.1); // styling
  });

  it('applies default styling (accent title / near-white facts) when unstyled', () => {
    expect(defaultStyling('title', '#f7e28b')).toMatchObject({ font: DEFAULT_TITLE_FONT, color: '#f7e28b' });
    expect(defaultStyling('fact', '#f7e28b')).toMatchObject({ font: DEFAULT_FACT_FONT, color: '#ffffff' });
  });
});

describe('buildPreviewElements — ordinal geometry <- semantic fields', () => {
  const card = { treatment: 'gold', title_text: 'CHAMPION', shown_fields: ['team', 'position'], text_elements: {} };
  const profile = { position: 'Striker', team: 'Rovers', class: '' };

  it('maps the Nth shown fact to fact{N} geometry with the profile value', () => {
    const els = buildPreviewElements(card, profile, 'broadcast', '9:16');
    const geo = geometryFor('broadcast', '9:16');
    // title + team (fact1) + position (fact2)
    expect(els.map((e) => e.slot)).toEqual(['title', 'team', 'position']);
    const team = els.find((e) => e.slot === 'team');
    expect(team.spec.text).toBe('Rovers');
    expect(team.spec.position).toEqual({ x: geo.slots.fact1.x, y: geo.slots.fact1.y });
    const position = els.find((e) => e.slot === 'position');
    expect(position.spec.position).toEqual({ x: geo.slots.fact2.x, y: geo.slots.fact2.y });
  });

  it('omits a shown fact whose profile value is blank (never a blank line)', () => {
    const els = buildPreviewElements(
      { ...card, shown_fields: ['class', 'position'] },
      profile,
      'broadcast',
      '9:16',
    );
    // class is blank -> omitted; position still renders at fact2's ORDINAL slot
    // (numbering follows shown_fields index, matching the renderer's enumerate).
    expect(els.map((e) => e.slot)).toEqual(['title', 'position']);
    expect(els.find((e) => e.slot === 'position').geoSlot).toBe('fact2');
  });

  it('omits the title when title_text is blank', () => {
    const els = buildPreviewElements({ ...card, title_text: '  ' }, profile, 'hero', '9:16');
    expect(els.find((e) => e.slot === 'title')).toBeUndefined();
  });

  // T6570 — the title text is the profile's Full Name (title_text a legacy override).
  it('sources the title from the profile full name when there is no title_text', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', shown_fields: [], text_elements: {} },
      { ...profile, full_name: 'Jordan Vega' },
      'title-only', '9:16',
    );
    expect(els.find((e) => e.slot === 'title').spec.text).toBe('Jordan Vega');
  });

  it('grandfathers a legacy title_text over the profile full name', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', title_text: 'Legacy', shown_fields: [], text_elements: {} },
      { ...profile, full_name: 'Jordan Vega' },
      'title-only', '9:16',
    );
    expect(els.find((e) => e.slot === 'title').spec.text).toBe('Legacy');
  });

  it('omits the title when neither title_text nor full_name is set', () => {
    const els = buildPreviewElements(
      { treatment: 'gold', shown_fields: [], text_elements: {} },
      { ...profile },
      'title-only', '9:16',
    );
    expect(els.find((e) => e.slot === 'title')).toBeUndefined();
  });

  // T6570 — the subtitle is FREE TEXT on the card, orthogonal to composition.
  it('renders the card subtitle at the subtitle slot when present', () => {
    const els = buildPreviewElements(
      { ...card, subtitle_text: 'State Cup 2027' },
      profile, 'broadcast', '9:16',
    );
    const geo = geometryFor('broadcast', '9:16');
    const sub = els.find((e) => e.slot === 'subtitle');
    expect(sub.spec.text).toBe('State Cup 2027');
    expect(sub.spec.position).toEqual({ x: geo.slots.subtitle.x, y: geo.slots.subtitle.y });
    // order: title, subtitle, then the facts
    expect(els.map((e) => e.slot)).toEqual(['title', 'subtitle', 'team', 'position']);
  });

  it('omits the subtitle when subtitle_text is blank', () => {
    const els = buildPreviewElements({ ...card, subtitle_text: '  ' }, profile, 'hero', '9:16');
    expect(els.find((e) => e.slot === 'subtitle')).toBeUndefined();
  });
});
