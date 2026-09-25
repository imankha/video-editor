/**
 * Shared constants for clip UI components
 *
 * Used by both ClipSelectorSidebar (framing) and ClipListItem (annotate)
 * to ensure consistent visual styling across modes.
 */

// Rating adjectives for clip name generation (e.g. "Highlight Goal")
// T11110: the 5-star rating is the gesture that makes a highlight, so its
// adjective is "Highlight" (was "Brilliant"). Persisted identifiers that still
// read "brilliant" (source_type, quest ids, API fields) are unchanged.
export const RATING_ADJECTIVES = {
  5: 'Highlight',
  4: 'Good',
  3: 'Interesting',
  2: 'Technical Lapse',
  1: 'Mental Lapse',
};

// Rating notation symbols (chess-style)
export const RATING_NOTATION = {
  1: '??',   // Blunder
  2: '?',    // Weak
  3: '!?',   // Interesting
  4: '!',    // Good
  5: '!!',   // Excellent
};

// Rating badge colors (color-blind safe palette P2, owner ruling H15 2026-09-24)
// T11110: Highlight (5) is gold (#F5B700). Gold clashes with the old amber
// 2-star, so the whole set was re-picked to stay color-blind distinguishable:
// 1 vermillion, 2 berry, 3 blue (unchanged), 4 bluish-green, 5 gold.
export const RATING_BADGE_COLORS = {
  1: '#D55E00', // Vermillion - Mental Lapse
  2: '#AD1457', // Berry - Technical Lapse
  3: '#1565C0', // Strong Blue - Interesting
  4: '#009E73', // Bluish-Green - Good
  5: '#F5B700', // Gold - Highlight
};

// Background tint colors for selected items (same hue as the badge at 0.15 alpha)
export const RATING_BACKGROUND_COLORS = {
  1: 'rgba(213, 94, 0, 0.15)',    // Vermillion
  2: 'rgba(173, 20, 87, 0.15)',   // Berry
  3: 'rgba(21, 101, 192, 0.15)',  // Strong Blue
  4: 'rgba(0, 158, 115, 0.15)',   // Bluish-Green
  5: 'rgba(245, 183, 0, 0.15)',   // Gold
};

// T11110: color for the notation glyph drawn ON the solid badge face
// (RatingIcon). White reads on every dark face, but rating 5's gold (#F5B700)
// needs a dark glyph for legible contrast - never white on gold.
export const RATING_GLYPH_COLORS = {
  1: '#ffffff',
  2: '#ffffff',
  3: '#ffffff',
  4: '#ffffff',
  5: '#1a1300', // dark, for contrast on gold
};

// T10690: neutral color for an unrated clip (rating === null) — deliberately
// outside the RATING_BADGE_COLORS/RATING_BACKGROUND_COLORS 1-5 palettes so an
// unrated clip can never be mistaken for a real star value.
export const UNRATED_BADGE_COLOR = '#64748b'; // slate
export const UNRATED_BACKGROUND_COLOR = 'rgba(100, 116, 139, 0.15)'; // slate tint

// T9840: default capture window for a "Mark play" tap — 6 seconds before the
// tap + 2 seconds after (8s total, was 9+3=12). The post-roll is intentional:
// parents tap AFTER they see a good play, so the seconds following the tap hold
// the end of it. Single-sourced here so BOTH the fullscreen tap-to-range default
// (AnnotateFullscreenOverlay) and useAnnotate's addClipRegion default duration
// express ONE policy — DEFAULT_CLIP_DURATION is DERIVED (before + after), not a
// separate literal that merely happens to agree.
export const DEFAULT_CLIP_BEFORE = 6;  // seconds before the tap
export const DEFAULT_CLIP_AFTER = 2;   // seconds after the tap
export const DEFAULT_CLIP_DURATION = DEFAULT_CLIP_BEFORE + DEFAULT_CLIP_AFTER; // 8s total

// T8490 / T9820: one-line caption explaining what a rating means for the play.
// T10690: `!rating` covers null AND undefined — the no-rating branch below is
// now a real, reachable state (a freshly created play carries no rating until
// the user picks one), not just a create-form transient.
// The creation clause is driven by the LIVE create-clip intent (`createIntent`,
// the AnnotateFullscreenOverlay toggle), NOT by the star count. Star-threshold
// copy ("one more star creates a clip", "five stars creates a clip") was a false
// prediction the moment the toggle disagreed with it (T9820 / E47: 4 stars with
// creation toggled ON still claimed another star was required). The rating
// adjective describes quality; the outcome clause states what Save will actually
// do. Ratings 1-3 stay adjective-only (they never claimed creation, so nothing to
// correct); the no-rating/4/5 branches drop their star prediction for the intent.
export function getRatingCaption(rating, mine, createIntent) {
  const outcome = createIntent
    ? 'this play will also become an editable clip.'
    : 'this saves the play without creating a clip.';
  if (!rating) return `How good was this play? Rate it 1 to 5 - ${outcome}`;
  if (rating === 1) return `Mental lapse (${RATING_NOTATION[1]}) - a play to learn from.`;
  if (rating === 2) return `Technical lapse (${RATING_NOTATION[2]}) - a play to learn from.`;
  if (rating === 3) return `Interesting play (${RATING_NOTATION[3]}) - worth a second look.`;
  if (rating === 4) return `Good play (${RATING_NOTATION[4]}) - ${outcome}`;
  const label = mine ? 'Highlight play' : 'Highlight team play';
  return `${label} (${RATING_NOTATION[5]}) - ${outcome}`;
}

// T8490 / T9820: edit-mode variant for ClipDetailsEditor — clip creation here is a
// separate manual control (never rating-gated), so the outcome clause reads off
// `hasReel` (does a clip already exist) instead of predicting one from the star
// count. The rating===4 branch previously repeated the same false "one more star
// creates a clip" threshold; it now mirrors the 5-star branch's hasReel wording.
// T10690: `!rating` covers null AND undefined — same reachable-unrated-state note
// as getRatingCaption above.
// T11110: "Brilliant" -> "Highlight". The old "create a clip below" / "team plays
// don't create clips" clauses named a control that no longer exists, so they are
// dropped (the full caption rewrite is T11150/T11160); the true "clip already
// created" clause stays, and applies to team plays too (per H13, team plays CAN
// become highlights).
export function getEditRatingCaption(rating, mine, hasReel) {
  if (!rating) return 'How good was this play? Rate it 1 to 5.';
  if (rating === 1) return `Mental lapse (${RATING_NOTATION[1]}) - a play to learn from.`;
  if (rating === 2) return `Technical lapse (${RATING_NOTATION[2]}) - a play to learn from.`;
  if (rating === 3) return `Interesting play (${RATING_NOTATION[3]}) - worth a second look.`;
  if (rating === 4) {
    return hasReel
      ? `Good play (${RATING_NOTATION[4]}) - clip already created from play.`
      : `Good play (${RATING_NOTATION[4]}).`;
  }
  const label = mine ? 'Highlight play' : 'Highlight team play';
  return hasReel
    ? `${label} (${RATING_NOTATION[5]}) - clip already created from play.`
    : `${label} (${RATING_NOTATION[5]}).`;
}

// T9520 N35: the ONE documented star-to-descriptor mapping, e.g. "4 stars · Good".
// Single source used across the play list, the play editor and playback so the
// rating reads identically everywhere (previously each surface showed a different
// mix of chess notation / bare adjective / "(4/5)"). Pairs the star count with the
// canonical RATING_ADJECTIVES word.
export function getRatingLabel(rating) {
  if (rating == null) return 'Not rated';
  const stars = `${rating} star${rating === 1 ? '' : 's'}`;
  return `${stars} · ${RATING_ADJECTIVES[rating]}`;
}

/**
 * Get rating display info for a given rating value
 * @param {number|null} rating - Rating value (1-5), or null for "not rated"
 * @returns {Object} - { notation, badgeColor, backgroundColor }
 */
export function getRatingDisplay(rating) {
  if (rating == null) {
    return { notation: '', badgeColor: UNRATED_BADGE_COLOR, backgroundColor: UNRATED_BACKGROUND_COLOR };
  }
  return {
    notation: RATING_NOTATION[rating],
    badgeColor: RATING_BADGE_COLORS[rating],
    backgroundColor: RATING_BACKGROUND_COLORS[rating],
  };
}

// T9480: formatDuration/formatTimeSimple moved to utils/timeFormat.js's
// formatLength/formatInstant (Stage C3) -- see that module for the one
// time-format rule. All 6 importers updated in the same commit.
