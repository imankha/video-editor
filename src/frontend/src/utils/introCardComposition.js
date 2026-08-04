/**
 * Intro card composition — the shared derivation rule (T5195, epic decision 2).
 *
 * MIRRORS `app/services/intro_cards.py::derive_composition` on the backend. The
 * composition is DERIVED from what the user chose to show; it is never stored
 * (there is no template column) and never cached in the store — it is computed
 * on read here so the editor's live preview (T5205) updates the instant the user
 * ticks a fact, before anything is saved. Keep this in step with the Python rule.
 *
 *   no photo (or no facts) -> title-only
 *   photo + 1 fact          -> hero
 *   photo + 2 facts         -> broadcast
 *   photo + 3 facts         -> recruiting
 */

export const COMPOSITION = {
  TITLE_ONLY: 'title-only',
  HERO: 'hero',
  BROADCAST: 'broadcast',
  RECRUITING: 'recruiting',
};

// The facts a card may show (mirrors the profile's structured intro fields).
export const SHOWN_FIELDS = ['position', 'class', 'team'];

// The 3-way visual treatment axis (separate from composition, decision 2b).
export const TREATMENTS = ['gold', 'dark', 'photo-forward'];

/**
 * Derive a card's composition from whether it has a photo and which facts it shows.
 * @param {boolean} hasPhoto
 * @param {string[]} shownFields
 * @returns {string} one of COMPOSITION.*
 */
export function deriveComposition(hasPhoto, shownFields) {
  const n = Array.isArray(shownFields) ? shownFields.length : 0;
  if (!hasPhoto || n === 0) return COMPOSITION.TITLE_ONLY;
  if (n === 1) return COMPOSITION.HERO;
  if (n === 2) return COMPOSITION.BROADCAST;
  return COMPOSITION.RECRUITING;
}

/**
 * Composition selector for a raw card row from the store. Reads the canonical
 * `image_key`/`shown_fields` — NOT any server-sent `composition` field — so the
 * store never depends on cached derived state.
 * @param {object} card
 * @returns {string}
 */
export function selectCardComposition(card) {
  if (!card) return COMPOSITION.TITLE_ONLY;
  return deriveComposition(Boolean(card.image_key), card.shown_fields || []);
}
