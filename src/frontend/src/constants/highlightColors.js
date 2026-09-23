export const HighlightColor = {
  WHITE: '#FFFFFF',
  CYAN: '#00FFFF',
  YELLOW: '#FFEB3B',
  PINK: '#FF88CC',
  ORANGE: '#FF9800',
  NONE: 'none',
};

export const HIGHLIGHT_COLOR_LABELS = {
  [HighlightColor.WHITE]: 'White',
  [HighlightColor.CYAN]: 'Cyan',
  [HighlightColor.YELLOW]: 'Yellow',
  [HighlightColor.PINK]: 'Pink',
  [HighlightColor.ORANGE]: 'Orange',
  [HighlightColor.NONE]: 'None',
};

export const HIGHLIGHT_COLOR_ORDER = [
  HighlightColor.WHITE,
  HighlightColor.CYAN,
  HighlightColor.YELLOW,
  HighlightColor.PINK,
  HighlightColor.ORANGE,
  HighlightColor.NONE,
];

// T11020: highlightColor can now be any hex string picked from the full spectrum
// or the eyedropper, not just one of the 5 presets above. Centralized here (next
// to the label map it reads) so the two display sites (OverlaySpotlightPanel,
// OverlayModeView's mobile summary) can't drift on what a custom hex reads as.
export function highlightColorLabel(color) {
  if (!color) return HIGHLIGHT_COLOR_LABELS[HighlightColor.WHITE];
  return HIGHLIGHT_COLOR_LABELS[color] || 'Custom';
}

export default HighlightColor;
