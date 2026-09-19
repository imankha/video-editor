// T9870 / T10670: the honest "your work is already saved" reassurance for the
// post-export completion bar (FocusPublishActionBar / OverlayPublishActionBar).
// T10670 renders the returned string as a one-word "Saved" chip beside the
// completion headline (was a green sentence above the grid); the deriver is
// unchanged -- it still returns the RESULT_RETENTION value for the project's state.
//
// AC1: the backend finalizer persists the working/final video at export completion,
// so the completion surface must confirm the result is durably retained privately --
// making the quiet exit link visibly redundant, not the thing that saves.
//
// Derived ONCE from real project state via draftStage.getDraftStatus (the single
// Draft/Private/Published source, T9860). This is a pure read; it triggers no write,
// so it never participates in persistence.
//
// AC4 guard: an already-published reel (a re-export of a shared reel) gets the
// PUBLISHED line -- it is never told "only you can see it", and this note never
// implies (let alone performs) any change to publication visibility.

import { getDraftStatus, DRAFT_STATUS } from './draftStage';
import { RESULT_RETENTION } from '../config/displayNames';

/**
 * @param {object|null} project - the project row (needs has_final_video / is_published).
 * @returns {string|null} the reassurance line, or null when there is nothing retained
 *   to reassure about (no project / nothing exported yet).
 */
export function resultRetentionNote(project) {
  if (!project) return null;
  const { status } = getDraftStatus(project);
  switch (status) {
    case DRAFT_STATUS.PUBLISHED:
      return RESULT_RETENTION.PUBLISHED;
    case DRAFT_STATUS.PRIVATE:
      return RESULT_RETENTION.PRIVATE_READY;
    case DRAFT_STATUS.DRAFT:
      // A framing (working-video) completion: exported and saved, still a private
      // draft (no final video yet). getDraftStatus only reads DRAFT before a final
      // video exists, which at a completion screen means exactly this case.
      return RESULT_RETENTION.PRIVATE_DRAFT;
    default:
      return null;
  }
}

export default resultRetentionNote;
