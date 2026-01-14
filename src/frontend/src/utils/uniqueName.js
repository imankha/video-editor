/**
 * Utility functions for ensuring unique clip names
 */

/**
 * Ensure a name is unique within a collection by appending " (n)" if needed.
 *
 * @param {string} name - The desired name
 * @param {string[]} existingNames - Array of existing names to check against
 * @returns {string} - Unique name (original or with " (n)" suffix)
 *
 * @example
 * ensureUniqueName("Goal", ["Goal", "Pass"]) // returns "Goal (2)"
 * ensureUniqueName("Goal", ["Goal", "Goal (2)"]) // returns "Goal (3)"
 * ensureUniqueName("Pass", ["Goal"]) // returns "Pass"
 */
export function ensureUniqueName(name, existingNames) {
  if (!name) return name;
  if (!existingNames || !existingNames.includes(name)) {
    return name;
  }

  let counter = 2;
  let uniqueName = `${name} (${counter})`;

  while (existingNames.includes(uniqueName)) {
    counter++;
    uniqueName = `${name} (${counter})`;
  }

  return uniqueName;
}

/**
 * Get existing clip names for a specific game (or no-game clips)
 *
 * @param {Array} clips - Array of raw clips with name and game_id fields
 * @param {number|null} gameId - Game ID to filter by (null for clips without a game)
 * @returns {string[]} - Array of existing names
 */
export function getExistingNamesForGame(clips, gameId) {
  if (!clips || !Array.isArray(clips)) return [];

  return clips
    .filter(clip => clip.game_id === gameId)
    .map(clip => clip.name)
    .filter(Boolean);
}

export default { ensureUniqueName, getExistingNamesForGame };
