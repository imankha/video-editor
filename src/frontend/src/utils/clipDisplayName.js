import { formatInstant } from './timeFormat';

/**
 * Generate a play name from its notes, tags or time.
 * Single source of truth for play name derivation (frontend).
 * Backend equivalent: queries.py derive_clip_name()
 *
 * Priority: notes > tags > time > empty string. T14550: a rating word is never part
 * of a default name.
 *
 * @param {object} play - Play with tags, notes, startTime (and _actualStartTime on a
 *   virtual region, the file time the backend names the play from)
 * @returns {string} Generated play name
 */
export function generateClipName(play) {
  const MAX_TITLE_LENGTH = 40;
  const { tags, notes } = play;

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

  if (tags && tags.length > 0) {
    return tags.length === 1
      ? tags[0]
      : tags.slice(0, -1).join(', ') + ' and ' + tags[tags.length - 1];
  }

  const startTime = play._actualStartTime ?? play.startTime;
  return startTime == null ? '' : `Play at ${formatInstant(startTime)}`;
}

/**
 * Get display name for a clip.
 * Uses the clip's name if set, otherwise generates from notes, tags or time.
 * Falls back to the provided fallback or empty string.
 *
 * @param {object} clip - Clip object with name, tags, notes, startTime
 * @param {string} fallback - Fallback name if no name can be generated
 * @returns {string} Display name
 */
export function getClipDisplayName(clip, fallback = '') {
  if (!clip) return fallback;
  return clip.name || generateClipName(clip) || fallback;
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
  return project.name || '';
}
