/**
 * Utility functions for game name lookups and clip display formatting
 */

/**
 * Create a game ID to name lookup map
 *
 * @param {Array} games - Array of game objects with id and name
 * @returns {Map<number, string>} - Map of game_id -> game_name
 */
export function createGameLookup(games) {
  if (!games || !Array.isArray(games)) return new Map();
  return new Map(games.map(g => [g.id, g.name]));
}

/**
 * Format clip display name with game prefix
 *
 * @param {string} clipName - The clip's name
 * @param {number|null} gameId - Game ID (null if uploaded without game)
 * @param {Map} gameLookup - Map from createGameLookup()
 * @returns {string} - Formatted as "Game Name > Clip Name" or just "Clip Name"
 *
 * @example
 * const lookup = createGameLookup([{ id: 1, name: "Finals 2024" }]);
 * formatClipDisplayName("Brilliant Goal", 1, lookup) // "Finals 2024 > Brilliant Goal"
 * formatClipDisplayName("My Upload", null, lookup) // "My Upload"
 */
export function formatClipDisplayName(clipName, gameId, gameLookup) {
  if (!clipName) return '';
  if (!gameId || !gameLookup || !gameLookup.has(gameId)) return clipName;

  const gameName = gameLookup.get(gameId);
  return `${gameName} > ${clipName}`;
}

/**
 * Get the game name for a given game ID
 *
 * @param {number|null} gameId - Game ID
 * @param {Map} gameLookup - Map from createGameLookup()
 * @returns {string|null} - Game name or null if not found
 */
export function getGameName(gameId, gameLookup) {
  if (!gameId || !gameLookup) return null;
  return gameLookup.get(gameId) || null;
}

export default { createGameLookup, formatClipDisplayName, getGameName };
