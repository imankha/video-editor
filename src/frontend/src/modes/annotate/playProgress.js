/**
 * playProgress (T10410) — derives the four "play progress" badge states the
 * Edit play editor shows beside the play name: rated, named, note added, clip
 * created. Pure: every badge is a read of state the editor already holds, so
 * nothing new is persisted and the badges can never drift from the fields.
 *
 * User rulings (2026-09-18, decision artifact):
 *   - RATED means the rating differs from the untouched default (4 stars).
 *     A deliberate 4 therefore reads as un-rated — accepted trade-off.
 *   - NAMED means a user-typed name: not blank, not the one-tap "Play N"
 *     default, and either changed in this session or stored as a custom name
 *     on the backend (`hasCustomName`, from `has_custom_name`). The loaded
 *     `name` alone cannot decide this — the API returns a DERIVED name for
 *     every clip (queries.derive_clip_name), which the frontend cannot
 *     reproduce (different truncation, TF-IDF titles), so a name compare
 *     against generateClipName would misreport.
 *   - The clip badge is DORMANT below 5 stars, NUDGES (amber) at 5 stars with
 *     no clip, is PENDING while the project is being created, DONE once the
 *     play has a project.
 */

/** Every visual state a badge can be in (PlayProgressBadges renders exactly these). */
export const BADGE_STATE = {
  UNDONE: 'undone',
  DONE: 'done',
  NUDGE: 'nudge',
  PENDING: 'pending',
  DORMANT: 'dormant',
};

/** The subset the clip badge cycles through (it is never plain "undone"). */
export const CLIP_BADGE = {
  DORMANT: BADGE_STATE.DORMANT,
  NUDGE: BADGE_STATE.NUDGE,
  PENDING: BADGE_STATE.PENDING,
  DONE: BADGE_STATE.DONE,
};

/** The rating that counts as "worth a clip" — the clip badge's nudge trigger. */
export const CLIP_NUDGE_RATING = 5;

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

/**
 * @param {object} p
 * @param {number} p.rating            current form rating
 * @param {number} p.defaultRating     the untouched default (DEFAULT_RATING)
 * @param {string} p.clipName          current form name
 * @param {boolean} p.isNameManuallyEdited  the editor's manual-edit flag
 * @param {string|null} p.loadedName   existingClip.name (edit mode) or null
 * @param {boolean} p.loadedHasCustomName  existingClip.hasCustomName (edit mode)
 * @param {string} p.notes             current form notes
 * @param {boolean} p.hasProject       existingClip.autoProjectId is set
 * @param {boolean} p.creating         a create-project call is in flight
 * @returns {{rated: boolean, named: boolean, noted: boolean, clip: string}}
 */
export function getPlayProgress({
  rating,
  defaultRating,
  clipName,
  isNameManuallyEdited,
  loadedName = null,
  loadedHasCustomName = false,
  notes,
  hasProject,
  creating,
}) {
  const trimmedName = (clipName || '').trim();
  const nameChangedThisSession = loadedName == null || trimmedName !== (loadedName || '').trim();
  const named =
    !!isNameManuallyEdited &&
    trimmedName.length > 0 &&
    !isDefaultPlayName(trimmedName) &&
    (nameChangedThisSession || !!loadedHasCustomName);

  let clip;
  if (hasProject) clip = CLIP_BADGE.DONE;
  else if (creating) clip = CLIP_BADGE.PENDING;
  else if (rating === CLIP_NUDGE_RATING) clip = CLIP_BADGE.NUDGE;
  else clip = CLIP_BADGE.DORMANT;

  return {
    rated: rating !== defaultRating,
    named,
    noted: (notes || '').trim().length > 0,
    clip,
  };
}
