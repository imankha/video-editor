/**
 * Shared constants for clip UI components
 *
 * Used by both ClipSelectorSidebar (framing) and ClipListItem (annotate)
 * to ensure consistent visual styling across modes.
 */

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
