/**
 * Aspect ratio constants for Collections (T3610).
 *
 * Ratio is collection identity: a (scope, ratio) is its own collection. The
 * only valid published ratios are portrait (9:16) and landscape (16:9) — there
 * is no "unknown"/"other" bucket (a NULL ratio on a published reel is a bug,
 * surfaced server-side, never coerced here). Ratio shows as glyph + word in
 * names ("Top Goals - Portrait"), never the raw "9:16".
 */

export const RATIO = {
  PORTRAIT: '9:16',
  LANDSCAPE: '16:9',
};

// Deterministic display order: portrait-first (product preference).
export const RATIO_ORDER = [RATIO.PORTRAIT, RATIO.LANDSCAPE];

// Mirror of the server constant (collections.py). A (scope, ratio) is a
// collection only at or above this much published content. The server is
// authoritative (ratio_eligible / eligible); the client uses this only to
// render the unlock progress bar for sub-threshold ratios.
export const COLLECTION_MIN_DURATION_SEC = 30;

const RATIO_META = {
  [RATIO.PORTRAIT]: { label: 'Portrait', glyph: '▯' },
  [RATIO.LANDSCAPE]: { label: 'Landscape', glyph: '▭' },
};

/** Word label for a ratio ("Portrait" / "Landscape"). */
export function ratioLabel(ratio) {
  return RATIO_META[ratio]?.label ?? ratio;
}

/** Small rectangle glyph for a ratio. */
export function ratioGlyph(ratio) {
  return RATIO_META[ratio]?.glyph ?? '';
}

/** "▯ Portrait" — glyph + word, the canonical ratio display string. */
export function ratioDisplay(ratio) {
  const glyph = ratioGlyph(ratio);
  const label = ratioLabel(ratio);
  return glyph ? `${glyph} ${label}` : label;
}

/**
 * Splits a list into one bucket per aspect ratio present, portrait first
 * (RATIO_ORDER), dropping empty buckets. A single-aspect list yields a
 * single-entry array, so callers can treat "one row" and "N rows" the same
 * way without a separate branch (T5672 draft rows, My Reels game rows).
 */
export function splitByAspect(list) {
  return RATIO_ORDER
    .map(ratio => ({
      ratio,
      projects: list.filter(item => (item.aspect_ratio || RATIO.PORTRAIT) === ratio),
    }))
    .filter(bucket => bucket.projects.length > 0);
}
