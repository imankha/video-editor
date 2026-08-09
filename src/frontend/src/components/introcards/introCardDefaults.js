// T5205 / T6640 — factory for a new card's create payload.
//
// T6640 (decision 12): typography is TEMPLATE-owned, so there is no more
// per-slot STYLING spec to default (`text_elements` is dead — see
// `intro_card_geometry.ROLE_FOR_SLOT`). `defaultSlotSpec` was deleted along
// with the per-slot styling editor it fed (`IntroCardRail.jsx`).

import { DEFAULT_TREATMENT, DEFAULT_DURATION, TITLE_SLOT } from './introCardEditorConstants';

// T6660: renamed the generated label from "Intro Card N" to "Athlete Intro
// Card N" (user-facing final name). The regex only recognizes the NEW form,
// so a pre-T6660 card still named "Intro Card N" no longer occupies a slot
// in the gap-filling sequence below -- copy-only rename, no data migration
// (task file scope), so a stale old-style name is left as-is until the user
// edits it.
const GENERATED_NAME_RE = /^Athlete Intro Card (\d+)$/;

/**
 * The generated name for a brand-new card: "Athlete Intro Card N", N the
 * LOWEST number not already used by one of this profile's cards with
 * EXACTLY that name (T6640 round 2, user decision). Gap-filling, not
 * `count + 1` — cards "Athlete Intro Card 1" and "Athlete Intro Card 3"
 * exist -> the next is "Athlete Intro Card 2" (renaming a card frees its
 * number). Cards with any OTHER name (including a user's own rename) don't
 * occupy a slot in this sequence — names aren't unique in general, only this
 * generator avoids repeating a number it can still see in use.
 * @param {{name: string}[]} cards
 */
export function nextCardName(cards) {
  const used = new Set(
    (cards || [])
      .map((c) => GENERATED_NAME_RE.exec(c.name || ''))
      .filter(Boolean)
      .map((m) => parseInt(m[1], 10)),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `Athlete Intro Card ${n}`;
}

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
