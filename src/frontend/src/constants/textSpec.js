// T5180 rich text engine — shared TextSpec constants (frontend mirror of
// app/schemas.py's Align/Animation/FontKey str,Enum classes + TextSpec model).
//
// Design: docs/plans/tasks/T5180-design.md §3. `as const` maps, never magic
// strings (project type-safety rule) — the enum VALUES are the exact
// app/assets/fonts/fonts.json keys, greppable, never computed.
//
// UNIT INVARIANT (documented once in app/schemas.py above TextSpec, mirrored
// here for the frontend reader — do not restate with drift risk, point back
// to schemas.py as the source of truth):
//   - `size` and `position.y` are FRAME-RELATIVE: fractions of frame HEIGHT.
//   - `maxWidth` and `position.x` are FRAME-RELATIVE: fractions of frame WIDTH.
//   - `position` is the anchor, interpreted per `align`; `position.y` is the
//     text block's TOP edge.
//   - `shadow.blur` and `stroke.width` are EM-RELATIVE: fractions of the
//     element's OWN `size`, NOT of the frame directly (gate decision Q1).

export const Align = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
};

export const Animation = {
  NONE: 'none',
  FADE: 'fade',
  FADE_UP: 'fade-up',
  WIPE: 'wipe',
};

export const FontKey = {
  ANTON: 'anton',
  OSWALD: 'oswald',
  GRADUATE: 'graduate',
  ALFA_SLAB: 'alfa-slab',
  PLAYFAIR: 'playfair',
  KANIT_ITALIC: 'kanit-italic',
};

/**
 * @typedef {Object} TextSpecPosition
 * @property {number} x - Frame-relative: fraction of frame WIDTH. Anchor x, interpreted per align.
 * @property {number} y - Frame-relative: fraction of frame HEIGHT. Anchor y (block's TOP edge).
 */

/**
 * @typedef {Object} TextSpecShadow
 * @property {number} blur - EM-RELATIVE: fraction of the spec's own `size`. 0 = no shadow.
 * @property {string} color - `#RRGGBB` hex.
 * @property {number} opacity - 0-1.
 */

/**
 * @typedef {Object} TextSpecStroke
 * @property {number} width - EM-RELATIVE: fraction of the spec's own `size`. 0 = no stroke.
 * @property {string} color - `#RRGGBB` hex.
 */

/**
 * @typedef {Object} TextSpec
 * @property {string} text - The literal text. Newlines honoured; wrap still applies within a line.
 * @property {string} font - A FontKey value (greppable key from fonts.json).
 * @property {number} size - Frame-relative: fraction of frame HEIGHT. Also the em unit for shadow.blur/stroke.width.
 * @property {string} color - `#RRGGBB` hex.
 * @property {string} align - An Align value.
 * @property {TextSpecPosition} position - Frame-relative anchor, interpreted per align.
 * @property {number} maxWidth - Frame-relative: fraction of frame WIDTH. Wrap boundary.
 * @property {TextSpecShadow} shadow
 * @property {TextSpecStroke} stroke
 * @property {string} animation - An Animation value. Card-only; Overlay (T5225) ignores it in v1.
 */

export default { Align, Animation, FontKey };
