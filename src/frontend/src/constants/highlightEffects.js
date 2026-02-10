/**
 * Highlight effect type constants - visual styles for player highlight overlays
 *
 * BRIGHTNESS_BOOST: Increases brightness inside the highlight ellipse
 * DARK_OVERLAY: Darkens the area outside the highlight ellipse (spotlight effect)
 */
export const HighlightEffect = {
  BRIGHTNESS_BOOST: 'brightness_boost',
  DARK_OVERLAY: 'dark_overlay',
};

/**
 * Ordered list of all highlight effects for UI toggle cycling
 */
export const HIGHLIGHT_EFFECT_ORDER = [
  HighlightEffect.BRIGHTNESS_BOOST,
  HighlightEffect.DARK_OVERLAY,
];

export default HighlightEffect;
