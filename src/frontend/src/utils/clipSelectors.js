/**
 * Clip Selectors — Computed derived values from raw backend clip data
 *
 * These pure functions replace stored boolean flags (isExtracted, isExtracting, etc.)
 * that were previously set during transformClipToUIFormat(). By computing at read time,
 * we eliminate stale flags and sync issues.
 *
 * @see T250: Clip Store Unification
 */

// ========== Extraction Status Selectors ==========

export const isExtracted = (clip) => !!clip.filename;

export const isExtracting = (clip) =>
  clip.extraction_status === 'running' || clip.extraction_status === 'pending';

export const isFailed = (clip) => clip.extraction_status === 'failed';

export const isRetrying = (clip) => clip.extraction_status === 'retrying';

// ========== Display Selectors ==========

export const clipDisplayName = (clip) =>
  (clip.filename || 'clip.mp4').replace(/\.[^/.]+$/, '');

/**
 * Get the URL for a clip's video file.
 * Prefers presigned R2 URL, falls back to local proxy endpoint.
 */
export const clipFileUrl = (clip, projectId) =>
  clip.file_url || `/api/clips/projects/${projectId}/clips/${clip.id}/file`;

// ========== Lazy JSON Parsers ==========

export const clipCropKeyframes = (clip) => {
  if (!clip.crop_data) return [];
  try { return JSON.parse(clip.crop_data); }
  catch { return []; }
};

export const clipSegments = (clip, duration) => {
  if (!clip.segments_data) {
    return { boundaries: [0, duration || 0], userSplits: [], trimRange: null, segmentSpeeds: {} };
  }
  try { return JSON.parse(clip.segments_data); }
  catch { return { boundaries: [0, duration || 0], userSplits: [], trimRange: null, segmentSpeeds: {} }; }
};

export const clipTrimRange = (clip) => {
  if (!clip.timing_data) return null;
  try { return JSON.parse(clip.timing_data).trimRange || null; }
  catch { return null; }
};
