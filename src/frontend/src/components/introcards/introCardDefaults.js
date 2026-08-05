// T5205 — factories for a new card and a slot's default STYLING spec.
//
// A stored `text_elements[slot]` is a STYLING-ONLY TextSpec (epic data model,
// T5210 contract): its `.text` is not authoritative (the title's text is
// `card.title_text`, a fact's text is the profile field), and its
// `.size`/`.align`/`.position`/`.maxWidth` are neutral placeholders that the
// composition geometry OVERRIDES at render/preview time. What the editor owns
// here is font / colour / shadow / stroke — the styling the rail edits.

import { Animation } from '../../constants/textSpec';
import { defaultStyling } from './introCardPreviewElements';
import { SLOT_META, PLACEHOLDER_SLOT_GEOMETRY, DEFAULT_SIZE, DEFAULT_ALIGN, DEFAULT_TREATMENT, DEFAULT_DURATION, TITLE_SLOT } from './introCardEditorConstants';
import { treatmentAccent } from './introCardVisual';

/**
 * A default styling spec for a slot — the SAME font/colour/shadow the renderer
 * applies to an unstyled slot (introCardPreviewElements.defaultStyling), so the
 * rail shows the true defaults and persisting them changes nothing visible.
 * Size/align/position are placeholders (layout-owned by the composition).
 * @param {string} slot one of ALL_SLOTS
 * @param {string} [accent] treatment accent (the title's default colour)
 */
export function defaultSlotSpec(slot, accent = treatmentAccent(DEFAULT_TREATMENT)) {
  const kind = SLOT_META[slot]?.kind || 'fact';
  const styling = defaultStyling(kind, accent);
  return {
    text: '', // styling-only: real text is title_text / the profile fact
    font: styling.font,
    color: styling.color,
    size: DEFAULT_SIZE,
    align: DEFAULT_ALIGN,
    position: { ...PLACEHOLDER_SLOT_GEOMETRY.position },
    maxWidth: PLACEHOLDER_SLOT_GEOMETRY.maxWidth,
    shadow: styling.shadow ? { ...styling.shadow } : { blur: 0, color: '#000000', opacity: 0 },
    stroke: { width: 0, color: '#000000' },
    animation: Animation.NONE,
  };
}

/**
 * Build the create payload for a brand-new card. `text_elements` starts EMPTY —
 * the renderer/preview apply the default styling for every slot, so a fresh card
 * looks finished without persisting redundant specs; a spec is written only when
 * the user actually restyles a slot. Defaults `image_key` from the profile's own
 * intro photo (epic decision 3b). `shown_fields` empty -> a fresh card is
 * title-only until the user ticks a fact (the composition rule made visible).
 * @param {{name: string, profile: object}} args
 */
export function buildCreateFields({ name, profile }) {
  return {
    name,
    treatment: DEFAULT_TREATMENT,
    shown_fields: [],
    title_text: name,
    image_key: profile?.introPhotoKey || null,
    text_elements: {},
    duration: DEFAULT_DURATION,
  };
}

export { TITLE_SLOT };
