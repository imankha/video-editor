// T6630 round 3 -- the 9 canonical text-position presets (3 vertical x 3
// horizontal anchors), defined ONCE so the UI's highlighted preset and the
// values WRITTEN to TextSpec derive from the SAME source (no drift between
// what the grid shows as "selected" and what gets persisted).
//
// NO SCHEMA CHANGE: these map onto the EXISTING fractional `position.x` /
// `position.y` (see textSpec.js's unit-invariant doc). text_render.py's anchor
// semantics: `position.y` is always the block's TOP edge; `position.x` is
// interpreted per `align` -- LEFT starts the line AT x, CENTER centres the
// line ON x, RIGHT ends the line AT x (text_render.py `_line_x`). Each
// horizontal slot pairs with the align value that makes its x inset read
// correctly against the frame edge it names. Because the backend already reads
// x/y/align exactly this way, the renderer needs NO change -- preview/export
// parity holds by construction, and this is OVERLAY TEXT ONLY (intro cards are
// template-owned, T6640, and untouched).

import { Align } from './textSpec';

export const VerticalSlot = { TOP: 'top', CENTER: 'center', BOTTOM: 'bottom' };
export const HorizontalSlot = { LEFT: 'left', MIDDLE: 'middle', RIGHT: 'right' };

// Frame-relative insets (fractions of frame height/width) -- close enough to
// the edge to read as "top/bottom/left/right", far enough not to clip.
const Y_BY_VERTICAL = {
  [VerticalSlot.TOP]: 0.08,
  [VerticalSlot.CENTER]: 0.45,
  [VerticalSlot.BOTTOM]: 0.82,
};
const X_BY_HORIZONTAL = {
  [HorizontalSlot.LEFT]: 0.08,
  [HorizontalSlot.MIDDLE]: 0.5,
  [HorizontalSlot.RIGHT]: 0.92,
};
const ALIGN_BY_HORIZONTAL = {
  [HorizontalSlot.LEFT]: Align.LEFT,
  [HorizontalSlot.MIDDLE]: Align.CENTER,
  [HorizontalSlot.RIGHT]: Align.RIGHT,
};

// Row-major (top row first), matching a 3-column visual grid.
export const POSITION_PRESETS = Object.values(VerticalSlot).flatMap((vertical) =>
  Object.values(HorizontalSlot).map((horizontal) => ({
    vertical,
    horizontal,
    x: X_BY_HORIZONTAL[horizontal],
    y: Y_BY_VERTICAL[vertical],
    align: ALIGN_BY_HORIZONTAL[horizontal],
  }))
);

// Fractional-coordinate match tolerance for highlighting a preset as "active".
const EPSILON = 0.01;

/**
 * Which preset (if any) the stored position/align exactly matches, within
 * EPSILON. Returns null for an arbitrary stored position (a block that was
 * never set to a preset, e.g. a pre-round-3 DB record) -- callers must NOT
 * snap/migrate on this null; it means "highlight nothing" (project rule:
 * runtime fixups are never persisted, and this must not silently rewrite
 * existing data either).
 * @param {{x: number, y: number}} position
 * @param {string} align
 * @returns {{vertical: string, horizontal: string, x: number, y: number, align: string} | null}
 */
export function matchPreset(position, align) {
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return null;
  return POSITION_PRESETS.find((p) =>
    Math.abs(p.x - position.x) < EPSILON &&
    Math.abs(p.y - position.y) < EPSILON &&
    p.align === align
  ) || null;
}

export function presetKey(vertical, horizontal) {
  return `${vertical}-${horizontal}`;
}

// T6630 round 4: default preset priority for a NEWLY CREATED element (user
// direction: "there should be a default position already chosen so i can see
// the text on the screen" -- a new element must NEVER spawn as "Custom
// position"). Bottom-center first, then center, then top-center (supervisor
// call, reversible); if a region already has elements sitting in all three,
// cascade through the remaining 6 slots (row-major) so a preset is ALWAYS
// picked, never left unset.
const _PRIORITY_KEYS = [
  presetKey(VerticalSlot.BOTTOM, HorizontalSlot.MIDDLE),
  presetKey(VerticalSlot.CENTER, HorizontalSlot.MIDDLE),
  presetKey(VerticalSlot.TOP, HorizontalSlot.MIDDLE),
];
const _ALL_KEYS_BOTTOM_FIRST = [
  ..._PRIORITY_KEYS,
  ...POSITION_PRESETS
    .map((p) => presetKey(p.vertical, p.horizontal))
    .filter((k) => !_PRIORITY_KEYS.includes(k)),
];
const _PRESET_BY_KEY = new Map(POSITION_PRESETS.map((p) => [presetKey(p.vertical, p.horizontal), p]));

/**
 * Pick a default preset for a newly created element, given its SIBLING
 * elements' current specs (elements already in the same region). Skips
 * presets already occupied by a sibling (matched via `matchPreset`, so an
 * arbitrary/legacy sibling position is simply not counted as "taken"). Always
 * returns a preset -- falls back to bottom-center (allowing overlap) in the
 * extreme case where all 9 slots are already taken.
 * @param {Array<{position?: {x:number,y:number}, align?: string}>} siblingSpecs
 * @returns {{vertical: string, horizontal: string, x: number, y: number, align: string}}
 */
export function pickDefaultPreset(siblingSpecs = []) {
  const takenKeys = new Set(
    siblingSpecs
      .map((spec) => matchPreset(spec?.position, spec?.align))
      .filter(Boolean)
      .map((p) => presetKey(p.vertical, p.horizontal))
  );
  for (const key of _ALL_KEYS_BOTTOM_FIRST) {
    if (!takenKeys.has(key)) return _PRESET_BY_KEY.get(key);
  }
  return _PRESET_BY_KEY.get(_PRIORITY_KEYS[0]);
}
