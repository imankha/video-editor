// T5205 / T6640 — factory for a new card's create payload.
//
// `defaultSlotSpec` was deleted (T6640): typography is TEMPLATE-owned, so
// there is no more per-slot styling default to test here.

import { describe, it, expect } from 'vitest';
import { buildCreateFields, nextCardName } from './introCardDefaults';
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

describe('nextCardName (T6640 round 2 — "Intro Card N", gap-filling)', () => {
  it('starts at 1 for an empty library', () => {
    expect(nextCardName([])).toBe('Intro Card 1');
  });

  it('increments past every generated name already in use', () => {
    const cards = [{ name: 'Intro Card 1' }, { name: 'Intro Card 2' }];
    expect(nextCardName(cards)).toBe('Intro Card 3');
  });

  it('fills the gap left by a renamed/deleted card, not count + 1', () => {
    const cards = [{ name: 'Intro Card 1' }, { name: 'Intro Card 3' }];
    expect(nextCardName(cards)).toBe('Intro Card 2');
  });

  it('ignores cards with any other name — a user rename frees its number without colliding', () => {
    const cards = [{ name: 'Intro Card 1' }, { name: 'Highlight reel intro' }, { name: 'Stafford card' }];
    expect(nextCardName(cards)).toBe('Intro Card 2');
  });

  it('is stable when the library has zero generated-named cards', () => {
    const cards = [{ name: 'Big Game' }, { name: 'Season Opener' }];
    expect(nextCardName(cards)).toBe('Intro Card 1');
  });

  it('handles a null/undefined cards list', () => {
    expect(nextCardName(undefined)).toBe('Intro Card 1');
    expect(nextCardName(null)).toBe('Intro Card 1');
  });
});
