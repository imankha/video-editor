/**
 * Clip Selectors — Computed derived values from raw backend clip data
 *
 * By computing at read time, we eliminate stale flags and sync issues.
 *
 * @see T250: Clip Store Unification
 */

// ========== Clip File Status Selectors ==========

export const isExtracted = (clip) => !!clip.filename;

// ========== Display Selectors ==========

export const clipDisplayName = (clip) =>
  (clip.filename || 'clip.mp4').replace(/\.[^/.]+$/, '');

/**
 * Get the URL for a clip's video file.
 * Prefers presigned R2 URL, falls back to local proxy endpoint.
 */
export const clipFileUrl = (clip, projectId) =>
  clip.file_url || `/api/clips/projects/${projectId}/clips/${clip.id}/file`;

// ========== Data Accessors ==========

export const clipCropKeyframes = (clip) => {
  if (!clip.crop_data) return [];
  return Array.isArray(clip.crop_data) ? clip.crop_data : [];
};

export const clipSegments = (clip, duration) => {
  const defaults = { boundaries: [0, duration || 0], userSplits: [], trimRange: null, segmentSpeeds: {} };
  if (!clip.segments_data) return defaults;
  return typeof clip.segments_data === 'object' ? clip.segments_data : defaults;
};

export const clipTrimRange = (clip) => {
  if (!clip.timing_data) return null;
  return clip.timing_data.trimRange || null;
};
