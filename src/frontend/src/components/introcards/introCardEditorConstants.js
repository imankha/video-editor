// T5205 — Intro card editor constants.
//
// SCOPE BOUNDARY (wave decision 2026-08-04): this file holds the axes the CARD
// EDITOR owns — text size presets, colour swatches, the visual-treatment axis
// (epic decision 2b), the slot identities, and the aspect-preview options. It
// deliberately holds NEITHER slot geometry (the normalised rect each slot
// occupies per composition/aspect) NOR motion-timing constants — those are the
// shared contract T5210 owns and lands as `introCardGeometry` / motion mirrors
// for this screen to import. If a number here starts to look like "where a slot
// sits" or "how long an animation runs", it is in the wrong file.

import { FontKey, Align } from '../../constants/textSpec';
import { RATIO } from '../../constants/aspectRatios';
import { TREATMENTS as TREATMENT_KEYS } from '../../utils/introCardComposition';

// Text SIZE presets (S/M/L/XL) — the user-facing meaning of "control the font
// size" (task scope B). Each maps to a normalised TextSpec.size (fraction of
// frame HEIGHT, the same unit RichText/text_render read). NOT a raw number
// field: parents pick a T-shirt size, not a decimal.
export const SIZE_PRESETS = [
  { key: 'S', label: 'S', value: 0.04 },
  { key: 'M', label: 'M', value: 0.06 },
  { key: 'L', label: 'L', value: 0.08 },
  { key: 'XL', label: 'XL', value: 0.11 },
];

/** Nearest preset key for a stored normalised size (so a swatch reads active). */
export function sizePresetKeyFor(sizeValue) {
  let best = SIZE_PRESETS[0];
  let bestDelta = Infinity;
  for (const preset of SIZE_PRESETS) {
    const delta = Math.abs(preset.value - sizeValue);
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best.key;
}

// Colour swatches for the text-colour control (swatches + a custom picker, task
// scope B). Curated, high-contrast picks that read on any treatment; the custom
// picker covers everything else.
export const COLOR_SWATCHES = [
  '#FFFFFF', // white
  '#000000', // black
  '#FFD66B', // gold
  '#F5A623', // amber
  '#EF4444', // red
  '#22C55E', // green
  '#3B82F6', // blue
  '#A855F7', // purple
];

// The visual TREATMENT axis (epic decision 2b) — INDEPENDENT of composition.
// Changing this must never change which composition is derived. The `preview`
// styles are the browser preview's approximation of each treatment's look;
// exact parity with the T5210 render is a render-side concern, not encoded here.
export const TREATMENTS = [
  {
    key: 'gold',
    label: 'Gold',
    swatchStyle: { background: 'linear-gradient(135deg, #7a5c15 0%, #d4af37 55%, #f7e28b 100%)' },
    stageStyle: { background: 'radial-gradient(120% 120% at 50% 0%, #2a2410 0%, #0d0b06 70%)' },
    accent: '#f7e28b',
  },
  {
    key: 'dark',
    label: 'Dark',
    swatchStyle: { background: 'linear-gradient(135deg, #1f2937 0%, #0b0f16 100%)' },
    stageStyle: { background: 'radial-gradient(120% 120% at 50% 0%, #1a2230 0%, #05070b 70%)' },
    accent: '#e5e7eb',
  },
  {
    key: 'photo-forward',
    label: 'Photo forward',
    swatchStyle: { background: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)' },
    // Photo-forward lets the image carry the frame; the backdrop is a near-black
    // wash so the photo edges blend rather than sit on a coloured field.
    stageStyle: { background: '#04060a' },
    accent: '#ffffff',
  },
];

export const TREATMENT_KEY_SET = new Set(TREATMENT_KEYS);

/** Look up a treatment's meta by key (falls back to the first entry). */
export function treatmentMeta(key) {
  return TREATMENTS.find((t) => t.key === key) || TREATMENTS[0];
}

// The card's text slots. `title` is a free-text line the user types; the three
// fact slots take their VALUE from the profile (position/class/team) and only
// their STYLING from the card. Slot IDENTITY lives here; slot GEOMETRY (where
// each renders) is T5210's contract.
export const TITLE_SLOT = 'title';
export const FACT_SLOTS = ['position', 'class', 'team'];
export const ALL_SLOTS = [TITLE_SLOT, ...FACT_SLOTS];

// Human labels + the profile field each fact slot reads its value from.
export const SLOT_META = {
  title: { label: 'Title', kind: 'title' },
  position: { label: 'Position', kind: 'fact', profileField: 'position' },
  class: { label: 'Class', kind: 'fact', profileField: 'class' },
  team: { label: 'Team', kind: 'fact', profileField: 'team' },
};

// Aspect-preview options. The whole point of a normalised focal point (over a
// fixed crop rect) is that ONE stored framing serves BOTH — so the editor must
// let the user flip between them (task scope B, epic decision 3b). Box sizes are
// the on-screen stage size, NOT slot geometry.
export const ASPECT_OPTIONS = [
  { key: RATIO.PORTRAIT, label: '9:16', w: 9, h: 16 },
  { key: RATIO.LANDSCAPE, label: '16:9', w: 16, h: 9 },
];

// Default entrance treatment / font for a brand-new card and its title text.
export const DEFAULT_TREATMENT = 'gold';
export const DEFAULT_TITLE_FONT = FontKey.ANTON;
export const DEFAULT_ALIGN = Align.CENTER;
export const DEFAULT_SIZE = 0.06; // matches SIZE_PRESETS 'M'
export const DEFAULT_DURATION = 4.0; // seconds; mirrors the backend default

// Placeholder position/maxWidth for a stored styling spec. text_elements holds
// STYLING ONLY (epic data model) — a slot's real position/maxWidth come from
// T5210's composition geometry at render/preview time and OVERRIDE these. The
// TextSpec model still requires the fields, so we store a neutral placeholder
// and never treat it as authoritative layout.
export const PLACEHOLDER_SLOT_GEOMETRY = Object.freeze({
  position: Object.freeze({ x: 0.5, y: 0.5 }),
  maxWidth: 0.8,
});
