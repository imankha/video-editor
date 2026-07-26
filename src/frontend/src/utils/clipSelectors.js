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
