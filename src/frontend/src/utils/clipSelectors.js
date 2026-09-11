/**
 * Clip Selectors — Computed derived values from raw backend clip data
 *
 * By computing at read time, we eliminate stale flags and sync issues.
 *
 * @see T250: Clip Store Unification
 */

import { API_BASE } from '../config';

// ========== Clip File Status Selectors ==========

export const isExtracted = (clip) => !!clip.filename;

// ========== Display Selectors ==========

export const clipDisplayName = (clip) =>
  (clip.filename || 'clip.mp4').replace(/\.[^/.]+$/, '');

/**
 * Get the URL for a clip's video file.
 * Prefers presigned R2 URL, falls back to the backend proxy endpoint.
 *
 * The fallback MUST carry API_BASE: on staging/prod the frontend and API are
 * different hosts, so a bare `/api/...` src resolves against the Cloudflare Pages
 * origin and returns the SPA shell instead of the video (T5890). Matches
 * projectDataStore.getClipFileUrl, which already prefixes API_BASE.
 */
export const clipFileUrl = (clip, projectId) =>
  clip.file_url || `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/file`;

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

/**
 * The clip's source duration in seconds, derived from the clip's OWN data — the
 * single source every surface reads so they never disagree (T9460).
 *
 * Raw backend clips carry their boundaries (start_time/end_time) and, for uploads,
 * video_duration. The clipMetadataCache duration is just a memoized copy of this
 * same derivation, and it is NOT built on the freshly-created-draft path (Annotate
 * save -> Focus open loads clips via fetchClips, which never populates the cache).
 * Reading the cache there yielded a confident `0.0s` while the header — which falls
 * back to the clip — correctly showed the real length. Deriving from the clip fixes
 * that class of drift.
 *
 * Returns `null` (never a fabricated 0) when the duration is genuinely unknown, so
 * callers render an honest loading state instead of a wrong zero (no silent
 * fallbacks for internal data).
 */
export const clipSourceDuration = (clip) => {
  if (!clip) return null;
  if (clip.duration != null) return clip.duration;
  if (clip.start_time != null && clip.end_time != null) return clip.end_time - clip.start_time;
  if (clip.video_duration != null) return clip.video_duration;
  return null;
};

export const clipTrimRange = (clip) => {
  if (!clip.timing_data) return null;
  return clip.timing_data.trimRange || null;
};

/**
 * The clip's horizon-straighten angle in degrees (content-correction, +CCW).
 * Stored as the scalar working_clips.rotation (T5640) — mirrors how crop_data
 * flows: raw off the backend response, defaulted to 0 at read time. Never a
 * derived/duplicated flag; the store holds the raw value.
 */
export const clipRotation = (clip) => Number(clip?.rotation) || 0;
