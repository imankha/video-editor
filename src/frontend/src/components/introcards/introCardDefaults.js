// T5205 — factories for a new card and a slot's default STYLING spec.
//
// A stored `text_elements[slot]` is a STYLING-ONLY TextSpec (epic data model):
// its `.text` is not authoritative (the title's text is `card.title_text`, a
// fact's text is the profile field) and its `.position`/`.maxWidth` are neutral
// placeholders that T5210's composition geometry overrides at render/preview
// time. What the editor DOES own here is font / size / colour / align / shadow /
// stroke — the styling the right rail edits.

import { FontKey, Align, Animation } from '../../constants/textSpec';
import {
  DEFAULT_TREATMENT,
  DEFAULT_TITLE_FONT,
  DEFAULT_ALIGN,
  DEFAULT_SIZE,
  DEFAULT_DURATION,
  PLACEHOLDER_SLOT_GEOMETRY,
  TITLE_SLOT,
} from './introCardEditorConstants';

/**
 * A default styling spec for a slot. `size` differs by slot kind so a fresh card
 * reads as a hierarchy (title larger than facts) before the user touches
 * anything — this is styling, not slot geometry.
 * @param {string} slot - one of ALL_SLOTS
 */
export function defaultSlotSpec(slot) {
  const isTitle = slot === TITLE_SLOT;
  return {
    text: '', // styling-only: real text is title_text / the profile fact
    font: isTitle ? DEFAULT_TITLE_FONT : FontKey.OSWALD,
    size: isTitle ? 0.08 : DEFAULT_SIZE,
    color: '#FFFFFF',
    align: DEFAULT_ALIGN,
    position: { ...PLACEHOLDER_SLOT_GEOMETRY.position },
    maxWidth: PLACEHOLDER_SLOT_GEOMETRY.maxWidth,
    shadow: { blur: 0, color: '#000000', opacity: 0 },
    stroke: { width: 0, color: '#000000' },
    animation: Animation.NONE,
  };
}

/**
 * Ensure a text_elements map has a styling spec for `slot`, returning the
 * (possibly new) full map. Pure — never mutates the input.
 */
export function withSlotSpec(textElements, slot) {
  const map = textElements || {};
  if (map[slot]) return map;
  return { ...map, [slot]: defaultSlotSpec(slot) };
}

/**
 * Build the create payload for a brand-new card. Seeds title styling and
 * defaults `image_key` from the profile's own intro photo (epic decision 3b —
 * the photo is profile-level; a card starts from it and may reframe later).
 * `shown_fields` starts empty, so a fresh card is `title-only` until the user
 * ticks a fact — the composition rule made visible from the first gesture.
 * @param {{name: string, profile: object}} args
 */
export function buildCreateFields({ name, profile }) {
  return {
    name,
    treatment: DEFAULT_TREATMENT,
    shown_fields: [],
    title_text: name,
    image_key: profile?.introPhotoKey || null,
    text_elements: { [TITLE_SLOT]: defaultSlotSpec(TITLE_SLOT) },
    duration: DEFAULT_DURATION,
  };
}

export { Align, FontKey };
