/**
 * Source types for final video exports.
 *
 * Single source of truth matching backend app/constants.py SourceType enum.
 */

export const SourceType = Object.freeze({
  BRILLIANT_CLIP: 'brilliant_clip',
  CUSTOM_PROJECT: 'custom_project',
});

/**
 * Human-readable labels for source types.
 */
export const SOURCE_TYPE_LABELS = Object.freeze({
  [SourceType.BRILLIANT_CLIP]: 'Brilliant Clip',
  [SourceType.CUSTOM_PROJECT]: 'Custom Project',
});

/**
 * Get display label for a source type.
 * @param {string} sourceType - The source type value
 * @returns {string} Human-readable label
 */
export function getSourceTypeLabel(sourceType) {
  return SOURCE_TYPE_LABELS[sourceType] || null;
}
