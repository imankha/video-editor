/**
 * canReEditReel — the single predicate for "can this published reel be re-opened
 * as an editable draft?" (T11220).
 *
 * Two independent conditions must both hold:
 *  - the reel has an editable project (`project_id` present and non-zero — a
 *    project_id of null/0 is a non-editable export, the pre-existing T8540 gate);
 *  - the reel is NOT a legacy multi-clip reel (`clip_count > 1`). The single-clip
 *    editor cannot represent a multi-clip project, so re-editing one is refused
 *    (R4). `restore-project` refuses these on the backend too — this predicate
 *    hides the Re-edit affordance so the user never hits that refusal.
 *
 * `clip_count` NULL/undefined (unknown — a possible legacy single-clip) and 1 are
 * treated as editable; only a known count > 1 is blocked, matching the backend.
 *
 * Shared by CollectionPlayer's in-player Re-edit gate, PublishedReelsPanel's card
 * folder button, and the useReEditReel action guard so the rule lives in one place.
 *
 * @param {{project_id?: number|null, clip_count?: number|null}} reel
 * @returns {boolean}
 */
export function canReEditReel(reel) {
  if (!reel?.project_id || reel.project_id === 0) return false;
  if (reel.clip_count != null && reel.clip_count > 1) return false;
  return true;
}

/**
 * The clear, specific message shown when a user tries to RE-FRAME a legacy
 * multi-clip DRAFT (T11220) — DraftTile intercepts the Focus/Framing gesture and
 * shows this instead of dropping into Framing (where /render 400s generically).
 * Mirrors the published-reel Re-edit refusal copy in useReEditReel but names the
 * affordances a draft actually still has (Spotlight + publish + download).
 */
export const LEGACY_MULTICLIP_REFRAME_MESSAGE =
  'This reel was made from multiple clips and can no longer be re-edited in Focus. ' +
  'You can still add a Spotlight, publish, and download it.';
