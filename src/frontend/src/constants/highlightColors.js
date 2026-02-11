/**
 * Highlight color constants - colors for the highlight overlay stroke
 *
 * YELLOW: Default high visibility color
 * PINK: Vibrant alternative
 * ORANGE: Warm alternative
 * NONE: Transparent (no visible stroke)
 */
export const HighlightColor = {
  YELLOW: '#FFEB3B',
  PINK: '#FF88CC',  // Pink (more blue than green for distinct pink hue)
  ORANGE: '#FF9800',
  NONE: 'none',  // Distinct value (not null) for "no color / brightness boost"
};

/**
 * Display labels for UI
 */
export const HIGHLIGHT_COLOR_LABELS = {
  [HighlightColor.YELLOW]: 'Yellow',
  [HighlightColor.PINK]: 'Pink',
  [HighlightColor.ORANGE]: 'Orange',
  [HighlightColor.NONE]: 'None',
};

/**
 * Ordered list for UI display
 */
export const HIGHLIGHT_COLOR_ORDER = [
  HighlightColor.YELLOW,
  HighlightColor.PINK,
  HighlightColor.ORANGE,
  HighlightColor.NONE,
];

export default HighlightColor;
