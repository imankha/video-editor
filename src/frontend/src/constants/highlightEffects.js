/**
 * Highlight effect type constants - visual styles for player highlight overlays
 *
 * BRIGHTNESS_BOOST: Increases brightness inside the highlight ellipse
 * ORIGINAL: Shows just the highlight ellipse outline (no visual effect on video)
 * DARK_OVERLAY: Darkens the area outside the highlight ellipse (spotlight effect)
 */
export const HighlightEffect = {
  BRIGHTNESS_BOOST: 'brightness_boost',
  ORIGINAL: 'original',
  DARK_OVERLAY: 'dark_overlay',
};

/**
 * Ordered list of all highlight effects for UI toggle cycling
 */
export const HIGHLIGHT_EFFECT_ORDER = [
  HighlightEffect.BRIGHTNESS_BOOST,
  HighlightEffect.ORIGINAL,
  HighlightEffect.DARK_OVERLAY,
];

export default HighlightEffect;
