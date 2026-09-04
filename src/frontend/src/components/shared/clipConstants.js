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
  if (!rating) return "1-5: how big was this play? 5 starts a reel automatically.";
  if (rating <= 3) return 'Saved to your library.';
  if (rating === 4) return `Big play (${RATING_NOTATION[4]}) - saved to your library.`;
  return mine
    ? `Can't-miss play (${RATING_NOTATION[5]}) - reel will be created.`
    : `Can't-miss team play (${RATING_NOTATION[5]}) - team clips don't start reels.`;
}

// T8490: edit-mode variant for ClipDetailsEditor — no auto-flip happens here
// (the Reel control's own button/link is the only way a reel gets created),
// so the 5-star/My Athlete state reads off `hasReel` instead of promising a
// future "will be created".
export function getEditRatingCaption(rating, mine, hasReel) {
  if (!rating) return "1-5: how big was this play? 5 starts a reel automatically.";
  if (rating <= 3) return 'Saved to your library.';
  if (rating === 4) return `Big play (${RATING_NOTATION[4]}) - saved to your library.`;
  if (!mine) return `Can't-miss team play (${RATING_NOTATION[5]}) - team clips don't start reels.`;
  return hasReel
    ? `Can't-miss play (${RATING_NOTATION[5]}) - reel already created.`
    : `Can't-miss play (${RATING_NOTATION[5]}) - create a reel below.`;
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

/**
 * Format duration as compact string (e.g., "12.5s")
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0.0s';
  return `${seconds.toFixed(1)}s`;
}

/**
 * Format time as MM:SS (for start/end times)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time
 */
export function formatTimeSimple(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
