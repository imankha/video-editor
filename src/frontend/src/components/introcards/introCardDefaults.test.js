// T5205 — factories for a new card / slot styling spec.

import { describe, it, expect } from 'vitest';
import { buildCreateFields, defaultSlotSpec } from './introCardDefaults';
import { TITLE_SLOT, DEFAULT_TREATMENT, PLACEHOLDER_SLOT_GEOMETRY } from './introCardEditorConstants';
import { DEFAULT_TITLE_FONT, DEFAULT_FACT_FONT } from './introCardPreviewElements';

describe('buildCreateFields', () => {
  it('starts a fresh card as title-only (no facts) and sets NO title_text (T6570: title = profile Full Name)', () => {
    const fields = buildCreateFields({ name: 'My card', profile: {} });
    expect(fields.name).toBe('My card');
    expect(fields.shown_fields).toEqual([]);
    // A new card never authors a title_text override — the title resolves from
    // the profile's Full Name at render time.
    expect(fields.title_text).toBeUndefined();
    expect(fields.treatment).toBe(DEFAULT_TREATMENT);
  });

  it('leaves text_elements EMPTY so the renderer/preview apply default styling', () => {
    // No redundant specs persisted; a slot spec is written only when restyled.
    expect(buildCreateFields({ name: 'x', profile: {} }).text_elements).toEqual({});
  });

  it('defaults image_key from the profile photo (epic decision 3b), null when none', () => {
    expect(buildCreateFields({ name: 'x', profile: { introPhotoKey: 'k123' } }).image_key).toBe('k123');
    expect(buildCreateFields({ name: 'x', profile: {} }).image_key).toBeNull();
    expect(buildCreateFields({ name: 'x', profile: null }).image_key).toBeNull();
  });
});

describe('defaultSlotSpec', () => {
  it('uses the renderer default fonts per kind (anton title / oswald fact)', () => {
    expect(defaultSlotSpec(TITLE_SLOT).font).toBe(DEFAULT_TITLE_FONT);
    expect(defaultSlotSpec('team').font).toBe(DEFAULT_FACT_FONT);
  });

  it('colours the title with the treatment accent it is given', () => {
    expect(defaultSlotSpec(TITLE_SLOT, '#abcdef').color).toBe('#abcdef');
  });

  it('is styling-only: text empty and size/position are the layout placeholders', () => {
    const spec = defaultSlotSpec('position');
    expect(spec.text).toBe('');
    expect(spec.position).toEqual(PLACEHOLDER_SLOT_GEOMETRY.position);
    expect(spec.maxWidth).toBe(PLACEHOLDER_SLOT_GEOMETRY.maxWidth);
  });
});
