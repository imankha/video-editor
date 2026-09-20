/**
 * playProgress (T10410) — derives the four "play progress" badge states the
 * Edit play editor shows beside the play name: rated, named, note added, clip
 * created. Pure: every badge is a read of state the editor already holds, so
 * nothing new is persisted and the badges can never drift from the fields.
 *
 * User rulings (2026-09-18, decision artifact):
 *   - RATED (T10690, 2026-09-19): true exactly when the play has a rating ON
 *     RECORD — `rating != null`. `raw_clips.rating` is NULLABLE (migration
 *     v054): a play created by Mark-play carries NO rating until the user
 *     picks one, and NULL is a legitimate state, never an anomaly.
 *     History, so this does not get re-litigated a fourth time:
 *       T10520  "differs from the untouched default 4" -> rejected live by the
 *               user: "green doesn't mean not 4, it just means it's been set."
 *       T10610  create-at-tap seeded rating=4, so `rated` was hardcoded true ->
 *               rejected: the badge claimed credit before the user touched it.
 *       T10690  the seed was removed and the column made nullable, so the
 *               predicate is finally a real read of real data. A session-only
 *               "touched" flag was explicitly considered and REJECTED by the
 *               user in favour of the schema change.
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
 * @param {string} p.clipName          current form name
 * @param {string|null} p.loadedName   existingClip.name
 * @param {boolean} p.loadedHasCustomName  existingClip.hasCustomName
 * @param {string} p.notes             current form notes
 * @param {boolean} p.hasProject       existingClip.autoProjectId is set
 * @param {boolean} p.creating         a create-project call is in flight
 * @returns {{rated: boolean, named: boolean, noted: boolean, clip: string}}
 */
export function getPlayProgress({
  rating,
  clipName,
  loadedName = null,
  loadedHasCustomName = false,
  notes,
  hasProject,
  creating,
}) {
  const trimmedName = (clipName || '').trim();
  const nameChangedThisSession = loadedName == null || trimmedName !== (loadedName || '').trim();
  const named =
    trimmedName.length > 0 &&
    !isDefaultPlayName(trimmedName) &&
    (nameChangedThisSession || !!loadedHasCustomName);

  let clip;
  if (hasProject) clip = CLIP_BADGE.DONE;
  else if (creating) clip = CLIP_BADGE.PENDING;
  // T10690: `rating === CLIP_NUDGE_RATING` is already false for `null` — an
  // unrated play does not nudge. No change needed, just no longer reachable
  // with an invented rating.
  else if (rating === CLIP_NUDGE_RATING) clip = CLIP_BADGE.NUDGE;
  else clip = CLIP_BADGE.DORMANT;

  return {
    // T10690: `!=` is deliberate — covers null AND undefined.
    rated: rating != null,
    named,
    noted: (notes || '').trim().length > 0,
    clip,
  };
}
