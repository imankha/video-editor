/**
 * Game constants - must match backend enums in app/constants.py
 */

/** Game type indicating venue/context */
export const GameType = {
  UNKNOWN: 'unknown',
  HOME: 'home',
  AWAY: 'away',
  TOURNAMENT: 'tournament',
};

// T8810: `VideoMode` (per_game / per_half) removed. Games now intake through the
// universal GameFootagePicker + useFootageIntake — an ordered N-video list, never
// a two-half toggle. No backend field was ever tied to it.

/** Status from POST /api/games (game management layer) */
export const GameCreateStatus = {
  ALREADY_OWNED: 'already_owned',
  CREATED: 'created',
};
