/**
 * playProgress (T10410, trimmed T11150 / T11130) — the play-progress badge ROW
 * and its derivation (`getPlayProgress`, `CLIP_BADGE`, `CLIP_NUDGE_RATING`) are
 * gone: T11150 dropped the named/noted/clip badges (rating moved to
 * `PlayRatingRow`), and T11130 removed the clip badge + its 5-star nudge entirely
 * (a play becomes a highlight via the rating + Done -> Highlight popup, not a
 * nudge). What survives is `BADGE_STATE` (the `Disc` primitive's visual states,
 * still used by `FramingHeaderStatus`) and the default-play-name helpers.
 */

/** Every visual state the `Disc` primitive (PlayProgressBadges) can render. */
export const BADGE_STATE = {
  UNDONE: 'undone',
  DONE: 'done',
  NUDGE: 'nudge',
  PENDING: 'pending',
  DORMANT: 'dormant',
};

/**
 * The one-tap default name the create form persists when nothing else derives
 * a name (T8140). Single source for the template AND its recognizer: the name is
 * stored as a real name on the backend, so it comes back as a custom name, and
 * `isDefaultPlayName` excludes it so a one-tap play never reads as "named".
 */
export function defaultPlayName(clipNumber) {
  return `Play ${clipNumber}`;
}

export function isDefaultPlayName(name) {
  return /^Play \d+$/.test((name || '').trim());
}
