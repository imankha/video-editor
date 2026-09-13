/**
 * Shared constants for clip UI components
 *
 * Used by both ClipSelectorSidebar (framing) and ClipListItem (annotate)
 * to ensure consistent visual styling across modes.
 */

// Rating adjectives for clip name generation (e.g. "Brilliant Goal")
export const RATING_ADJECTIVES = {
  5: 'Brilliant',
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

// Rating badge colors (color-blind safe palette)
export const RATING_BADGE_COLORS = {
  1: '#C62828', // Brick Red - Blunder
  2: '#F9A825', // Amber Yellow - Weak
  3: '#1565C0', // Strong Blue - Interesting
  4: '#2E7D32', // Teal-Green - Good
  5: '#66BB6A', // Light Green - Excellent
};

// Background tint colors for selected items (derived from badge colors)
export const RATING_BACKGROUND_COLORS = {
  1: 'rgba(198, 40, 40, 0.15)',   // Brick Red
  2: 'rgba(249, 168, 37, 0.15)',  // Amber Yellow
  3: 'rgba(21, 101, 192, 0.15)',  // Strong Blue
  4: 'rgba(46, 125, 50, 0.15)',   // Teal-Green
  5: 'rgba(102, 187, 106, 0.15)', // Light Green
};

// Default rating when none is set
export const DEFAULT_RATING = 3;

// T8490: one-line caption explaining what a rating means for the reel,
// mirroring the auto-flip gate's `mine` (My Athlete layer) check — bound to
// rating + layer only, not the live createProject toggle, so it always
// communicates the RULE regardless of a manual override.
export function getRatingCaption(rating, mine) {
  if (!rating) return 'How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.';
  if (rating === 1) return `Mental lapse (${RATING_NOTATION[1]}) - a play to learn from.`;
  if (rating === 2) return `Technical lapse (${RATING_NOTATION[2]}) - a play to learn from.`;
  if (rating === 3) return `Interesting play (${RATING_NOTATION[3]}) - worth a second look.`;
  if (rating === 4) return `Good play (${RATING_NOTATION[4]}) - one more star creates a clip.`;
  return mine
    ? `Brilliant play (${RATING_NOTATION[5]}) - clip will be created from play.`
    : `Brilliant team play (${RATING_NOTATION[5]}) - team plays don't create clips.`;
}

// T8490: edit-mode variant for ClipDetailsEditor — no auto-flip happens here
// (the Reel control's own button/link is the only way a reel gets created),
// so the 5-star/My Athlete state reads off `hasReel` instead of promising a
// future "will be created".
export function getEditRatingCaption(rating, mine, hasReel) {
  if (!rating) return 'How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.';
  if (rating === 1) return `Mental lapse (${RATING_NOTATION[1]}) - a play to learn from.`;
  if (rating === 2) return `Technical lapse (${RATING_NOTATION[2]}) - a play to learn from.`;
  if (rating === 3) return `Interesting play (${RATING_NOTATION[3]}) - worth a second look.`;
  if (rating === 4) return `Good play (${RATING_NOTATION[4]}) - one more star creates a clip.`;
  if (!mine) return `Brilliant team play (${RATING_NOTATION[5]}) - team plays don't create clips.`;
  return hasReel
    ? `Brilliant play (${RATING_NOTATION[5]}) - clip already created from play.`
    : `Brilliant play (${RATING_NOTATION[5]}) - create a clip below.`;
}

// T9520 N35: the ONE documented star-to-descriptor mapping, e.g. "4 stars · Good".
// Single source used across the play list, the play editor and playback so the
// rating reads identically everywhere (previously each surface showed a different
// mix of chess notation / bare adjective / "(4/5)"). Pairs the star count with the
// canonical RATING_ADJECTIVES word.
export function getRatingLabel(rating) {
  const r = rating || DEFAULT_RATING;
  const stars = `${r} star${r === 1 ? '' : 's'}`;
  return `${stars} · ${RATING_ADJECTIVES[r]}`;
}

/**
 * Get rating display info for a given rating value
 * @param {number} rating - Rating value (1-5)
 * @returns {Object} - { notation, badgeColor, backgroundColor }
 */
export function getRatingDisplay(rating) {
  const r = rating || DEFAULT_RATING;
  return {
    notation: RATING_NOTATION[r] || RATING_NOTATION[DEFAULT_RATING],
    badgeColor: RATING_BADGE_COLORS[r] || RATING_BADGE_COLORS[DEFAULT_RATING],
    backgroundColor: RATING_BACKGROUND_COLORS[r] || RATING_BACKGROUND_COLORS[DEFAULT_RATING],
  };
}

// T9480: formatDuration/formatTimeSimple moved to utils/timeFormat.js's
// formatLength/formatInstant (Stage C3) -- see that module for the one
// time-format rule. All 6 importers updated in the same commit.
