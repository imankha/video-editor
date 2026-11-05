/**
 * T5740: per-recipient clip scope for the game share modal (Google-Docs-style).
 *
 * Picks WHICH clips a recipient receives. My-Athlete clips never cross under any
 * scope (EPIC decision 1/3). Values mirror the backend ShareClipScope enum
 * (app/constants.py) exactly — the string is the wire contract.
 *
 * The copy elsewhere in the modal quotes these labels, so keep them in step. T14640: a
 * recipient receives marked plays, so the labels say plays (copy glossary).
 */
export const SHARE_CLIP_SCOPE = {
  ALL_TEAM: 'all_team',
  TAGGED_ONLY: 'tagged_only',
  GAME_ONLY: 'game_only',
};

export const SHARE_CLIP_SCOPE_LABEL = {
  [SHARE_CLIP_SCOPE.ALL_TEAM]: 'All team plays',
  [SHARE_CLIP_SCOPE.TAGGED_ONLY]: "Only plays they're tagged in",
  [SHARE_CLIP_SCOPE.GAME_ONLY]: 'Game only (no plays)',
};

// Sub-label shown under each option in the dropdown menu.
export const SHARE_CLIP_SCOPE_SUBLABEL = {
  [SHARE_CLIP_SCOPE.ALL_TEAM]: 'Every team play from this game',
  [SHARE_CLIP_SCOPE.TAGGED_ONLY]: "Just the team plays they're tagged in",
  [SHARE_CLIP_SCOPE.GAME_ONLY]: 'Just the game, no plays',
};

// Default selection for a freshly added recipient (EPIC + user-confirmed).
export const DEFAULT_SHARE_CLIP_SCOPE = SHARE_CLIP_SCOPE.ALL_TEAM;

// Dropdown order.
export const SHARE_CLIP_SCOPE_OPTIONS = [
  SHARE_CLIP_SCOPE.ALL_TEAM,
  SHARE_CLIP_SCOPE.TAGGED_ONLY,
  SHARE_CLIP_SCOPE.GAME_ONLY,
];
