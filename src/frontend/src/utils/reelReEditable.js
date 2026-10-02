import { toast } from '../components/shared/Toast';

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
 * treated as editable; only a known count > 1 is blocked (`null/undefined > 1` is
 * already false, so a plain `> 1` check suffices), matching the backend.
 *
 * Shared by CollectionPlayer's in-player Re-edit gate, PublishedReelsPanel's card
 * folder button, and the useReEditReel action guard so the rule lives in one place.
 *
 * @param {{project_id?: number|null, clip_count?: number|null}} reel
 * @returns {boolean}
 */
export function canReEditReel(reel) {
  if (!reel?.project_id || reel.project_id === 0) return false;
  if (reel?.clip_count > 1) return false;
  return true;
}

/**
 * The clear, specific message shown when a user tries to RE-FRAME a legacy
 * multi-clip project (T11220) — shown instead of dropping into Framing (where
 * /render 400s generically). Names the affordances that DO still work.
 */
export const LEGACY_MULTICLIP_REFRAME_MESSAGE =
  'This highlight was made from multiple clips and can no longer be re-edited in Focus. ' +
  'You can still add a Spotlight, publish, and download it.';

/**
 * allowEnterFraming — the ONE guard every "enter Focus/Framing for this project"
 * gesture must pass through (T11220). Framing has several entry points that each
 * end in `setEditorMode(FRAMING)` — the header ModeSwitcher tab, the Overlay
 * completion screen's "Reapply Framing"/"Switch to Framing" tiles, App's
 * programmatic mode-switch, and DraftTile's card/strip clicks. Rather than trust
 * each caller to remember the check (exactly how the OverlayScreen + header gap
 * slipped past the first pass), they all call THIS helper first.
 *
 * A legacy multi-clip project (`clip_count > 1`) cannot be represented by the
 * single-clip Focus editor and would burn credits on a re-export that then 400s,
 * so entering Framing is refused with the clear message. Returns whether the
 * caller may proceed; on refusal it surfaces the toast and returns false. A
 * missing project or clip_count 0/1/undefined is allowed (never blocks normal
 * single-clip framing).
 *
 * @param {{clip_count?: number|null}|null|undefined} project the target project
 * @returns {boolean} true if the caller may enter Framing; false (and toasts) if refused
 */
export function allowEnterFraming(project) {
  if (project?.clip_count > 1) {
    toast.info(LEGACY_MULTICLIP_REFRAME_MESSAGE);
    return false;
  }
  return true;
}
