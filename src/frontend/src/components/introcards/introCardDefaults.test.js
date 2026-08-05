// T5205 — factories for a new card / slot styling spec.

import { describe, it, expect } from 'vitest';
import { buildCreateFields, defaultSlotSpec, withSlotSpec } from './introCardDefaults';
import { TITLE_SLOT, DEFAULT_TREATMENT, PLACEHOLDER_SLOT_GEOMETRY } from './introCardEditorConstants';

describe('buildCreateFields', () => {
  it('starts a fresh card as title-only (no facts) with the title text = name', () => {
    const fields = buildCreateFields({ name: 'My card', profile: {} });
    expect(fields.name).toBe('My card');
    expect(fields.shown_fields).toEqual([]);
    expect(fields.title_text).toBe('My card');
    expect(fields.treatment).toBe(DEFAULT_TREATMENT);
    expect(fields.text_elements[TITLE_SLOT]).toBeTruthy();
  });

  it('defaults image_key from the profile photo (epic decision 3b), null when none', () => {
    expect(buildCreateFields({ name: 'x', profile: { introPhotoKey: 'k123' } }).image_key).toBe('k123');
    expect(buildCreateFields({ name: 'x', profile: {} }).image_key).toBeNull();
    expect(buildCreateFields({ name: 'x', profile: null }).image_key).toBeNull();
  });
});

describe('defaultSlotSpec', () => {
  it('gives the title a larger size than a fact slot (styling hierarchy)', () => {
    expect(defaultSlotSpec(TITLE_SLOT).size).toBeGreaterThan(defaultSlotSpec('team').size);
  });

  it('is styling-only: text is empty and position is the neutral placeholder', () => {
    const spec = defaultSlotSpec('position');
    expect(spec.text).toBe('');
    expect(spec.position).toEqual(PLACEHOLDER_SLOT_GEOMETRY.position);
    expect(spec.maxWidth).toBe(PLACEHOLDER_SLOT_GEOMETRY.maxWidth);
  });
});

describe('withSlotSpec', () => {
  it('adds a missing slot spec without mutating the input', () => {
    const input = {};
    const out = withSlotSpec(input, 'team');
    expect(out.team).toBeTruthy();
    expect(input.team).toBeUndefined();
  });

  it('leaves an existing slot spec untouched', () => {
    const existing = { team: defaultSlotSpec('team') };
    expect(withSlotSpec(existing, 'team')).toBe(existing);
  });
});
