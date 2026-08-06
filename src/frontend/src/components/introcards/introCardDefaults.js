// T5205 / T6640 — factory for a new card's create payload.
//
// T6640 (decision 12): typography is TEMPLATE-owned, so there is no more
// per-slot STYLING spec to default (`text_elements` is dead — see
// `intro_card_geometry.ROLE_FOR_SLOT`). `defaultSlotSpec` was deleted along
// with the per-slot styling editor it fed (`IntroCardRail.jsx`).

import { DEFAULT_TREATMENT, DEFAULT_DURATION, TITLE_SLOT } from './introCardEditorConstants';

/**
 * Build the create payload for a brand-new card. Defaults `image_key` from the
 * profile's own intro photo (epic decision 3b). `shown_fields` empty -> a
 * fresh card is title-only until the user ticks a fact (the composition rule
 * made visible).
 * @param {{name: string, profile: object}} args
 */
export function buildCreateFields({ name, profile }) {
  return {
    // `name` is the LIBRARY label only. The card TITLE is the profile's Full
    // Name (T6570), resolved at render time — a new card sets NO title_text, so
    // it never depends on the legacy free-text override.
    name,
    treatment: DEFAULT_TREATMENT,
    shown_fields: [],
    image_key: profile?.introPhotoKey || null,
    duration: DEFAULT_DURATION,
  };
}

export { TITLE_SLOT };
