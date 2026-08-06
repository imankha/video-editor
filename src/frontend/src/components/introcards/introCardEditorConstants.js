// T5205 — Intro card editor constants.
//
// SCOPE BOUNDARY: the layout numbers (slot geometry, motion timing) AND the
// treatment palette are T5210's shared contract (introCardGeometry.js). This
// file holds only editor-local UX: colour swatches, the treatment LABELS (the
// contract owns the colours), slot identities, and the aspect-preview options.
// Font SIZE, ALIGN and POSITION are LAYOUT-OWNED (composition-derived) per the
// contract — they are NOT user-editable styling, so there are no size/align
// presets here.

import { FontKey, Align } from '../../constants/textSpec';
import { RATIO } from '../../constants/aspectRatios';
import { TREATMENTS as TREATMENT_KEYS } from '../../utils/introCardComposition';

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

// Human labels for the treatment keys (the COLOURS live in the shared contract,
// INTRO_CARD_TREATMENTS; only the display label is editor-local).
export const TREATMENT_LABELS = {
  gold: 'Gold',
  dark: 'Dark',
  'photo-forward': 'Photo forward',
};

// The 3-way treatment toggle options — keys from the shared composition module,
// labels from above. INDEPENDENT of composition (epic decision 2b).
export const TREATMENTS = TREATMENT_KEYS.map((key) => ({
  key,
  label: TREATMENT_LABELS[key] || key,
}));

// The card's text slots (SEMANTIC styling keys). `title` reads from the profile's
// Full Name (T6570); `subtitle` is the ONE piece of FREE TEXT the user types on
// THIS card (T6570; a tournament name etc.); the three fact slots take their
// VALUE from the profile (position/class/team) and only their STYLING from the
// card. Slot IDENTITY is here; slot GEOMETRY is T5210's contract.
export const TITLE_SLOT = 'title';
export const SUBTITLE_SLOT = 'subtitle';
export const FACT_SLOTS = ['position', 'class', 'team'];
export const ALL_SLOTS = [TITLE_SLOT, SUBTITLE_SLOT, ...FACT_SLOTS];

// Human labels + the profile field each fact slot reads its value from.
export const SLOT_META = {
  // T6620: LABEL is "Athlete Name" — the title is the profile's Full Name (no
  // per-card text box since T6570), so "Title" named a control that no longer
  // exists. The slot KEY stays `title` (the shared geometry/contract key —
  // renaming it would break the parity test).
  title: { label: 'Athlete Name', kind: 'title' },
  subtitle: { label: 'Subtitle', kind: 'subtitle' },
  position: { label: 'Position', kind: 'fact', profileField: 'position' },
  class: { label: 'Class', kind: 'fact', profileField: 'class' },
  team: { label: 'Team', kind: 'fact', profileField: 'team' },
};

// Aspect-preview options. ONE stored focal point serves BOTH (epic decision 3b),
// so the editor must let the user flip between them. Values match CARD_ASPECTS in
// the shared contract (RATIO.PORTRAIT === '9:16', RATIO.LANDSCAPE === '16:9').
export const ASPECT_OPTIONS = [
  { key: RATIO.PORTRAIT, label: '9:16', w: 9, h: 16 },
  { key: RATIO.LANDSCAPE, label: '16:9', w: 16, h: 9 },
];

// Default treatment / font for a brand-new card and its title text.
export const DEFAULT_TREATMENT = 'gold';
export const DEFAULT_TITLE_FONT = FontKey.ANTON;
export const DEFAULT_ALIGN = Align.CENTER;
export const DEFAULT_SIZE = 0.06;
export const DEFAULT_DURATION = 4.0; // seconds; mirrors the backend default

// Placeholder position/size/maxWidth/align for a stored styling spec. text_elements
// holds STYLING ONLY — the composition geometry (T5210) OVERRIDES all of these at
// render/preview time ("layout always wins", player_intro._merge_spec). The TextSpec
// schema still requires the fields, so a stored styling spec carries neutral
// placeholders that are never treated as authoritative layout.
export const PLACEHOLDER_SLOT_GEOMETRY = Object.freeze({
  position: Object.freeze({ x: 0.5, y: 0.5 }),
  maxWidth: 0.8,
});
