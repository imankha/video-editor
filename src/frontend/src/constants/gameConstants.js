/**
 * Game constants - must match backend enums in app/constants.py
 */

/** Game type indicating venue/context */
export const GameType = {
  HOME: 'home',
  AWAY: 'away',
  TOURNAMENT: 'tournament',
};

/** How video files are organized for a game */
export const VideoMode = {
  PER_GAME: 'per_game',
  PER_HALF: 'per_half',
};

/** Status from POST /api/games (game management layer) */
export const GameCreateStatus = {
  ALREADY_OWNED: 'already_owned',
  CREATED: 'created',
};
