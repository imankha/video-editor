// T5205 / T6640 — factory for a new card's create payload.
//
// `defaultSlotSpec` was deleted (T6640): typography is TEMPLATE-owned, so
// there is no more per-slot styling default to test here.

import { describe, it, expect } from 'vitest';
import { buildCreateFields } from './introCardDefaults';
import { DEFAULT_TREATMENT } from './introCardEditorConstants';

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

  it('sends no text_elements (T6640: the column is dead; the template supplies styling)', () => {
    expect(buildCreateFields({ name: 'x', profile: {} }).text_elements).toBeUndefined();
  });

  it('defaults image_key from the profile photo (epic decision 3b), null when none', () => {
    expect(buildCreateFields({ name: 'x', profile: { introPhotoKey: 'k123' } }).image_key).toBe('k123');
    expect(buildCreateFields({ name: 'x', profile: {} }).image_key).toBeNull();
    expect(buildCreateFields({ name: 'x', profile: null }).image_key).toBeNull();
  });
});
