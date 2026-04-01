import { RATING_ADJECTIVES } from '../components/shared/clipConstants';

/**
 * Generate a clip name from rating, tags, and notes.
 * Single source of truth for clip name derivation (frontend).
 * Backend equivalent: queries.py derive_clip_name()
 *
 * Priority: notes > rating+tags > empty string
 *
 * @param {number} rating - Clip rating (1-5)
 * @param {string[]} selectedTags - Tags assigned to the clip
 * @param {string} notes - Clip notes text
 * @returns {string} Generated clip name
 */
export function generateClipName(rating, selectedTags, notes = '') {
  const MAX_TITLE_LENGTH = 40;

  // Notes take priority over tags
  if (notes && notes.trim()) {
    const trimmed = notes.trim();
    if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;

    // Truncate at word boundary
    const words = trimmed.split(/\s+/);
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = result + ' ' + words[i];
      if (next.length > MAX_TITLE_LENGTH) break;
      result = next;
    }
    return result;
  }

  // Fallback: rating + tags
  if (!selectedTags || selectedTags.length === 0) return '';

  const adjective = RATING_ADJECTIVES[rating] || 'Interesting';
  const tagPart = selectedTags.length === 1
    ? selectedTags[0]
    : selectedTags.slice(0, -1).join(', ') + ' and ' + selectedTags[selectedTags.length - 1];

  return `${adjective} ${tagPart}`;
}

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
  return clip.name || generateClipName(clip.rating, clip.tags, clip.notes) || fallback;
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
