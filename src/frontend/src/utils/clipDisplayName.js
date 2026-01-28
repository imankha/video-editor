import { generateClipName } from '../modes/annotate/constants/soccerTags';

/**
 * Get display name for a clip.
 * Uses the clip's name if set, otherwise generates from rating + tags.
 * Falls back to the provided fallback or empty string.
 *
 * @param {object} clip - Clip object with name, rating, tags
 * @param {string} fallback - Fallback name if no name can be generated
 * @returns {string} Display name
 */
export function getClipDisplayName(clip, fallback = '') {
  if (!clip) return fallback;
  return clip.name || generateClipName(clip.rating, clip.tags) || fallback;
}

/**
 * Get display name for a project.
 * For auto-created single-clip projects, returns the clip name (or auto-generated name).
 * For regular projects, returns the project name.
 *
 * @param {object} project - Project object with is_auto_created, clips, name
 * @returns {string} Display name
 */
export function getProjectDisplayName(project) {
  if (!project) return '';
  if (project.is_auto_created && project.clips?.[0]) {
    return getClipDisplayName(project.clips[0], project.name);
  }
  return project.name || '';
}
