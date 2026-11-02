import { toast } from '../components/shared/Toast';
import { ENABLE_PROBLEM_REPORT } from '../config';
import { ANNOTATE } from '../config/displayNames';
import { useProblemReportStore } from '../stores/problemReportStore';

/**
 * T14370: the ONE exit for every failure in the Mark play chain
 * (AnnotateContainer.handleAddClipFromButton -> handleFullscreenCreateClip ->
 * useAnnotate.addClipRegion -> useRawClipSave.saveClip).
 *
 * A prod report (gsarah, Android, 2026-11-01) tapped Mark play three times and
 * nothing happened, with zero trace anywhere. Every exit now (1) logs ONE
 * console.error tagged `[MarkPlay]` with the step and full context, which the
 * clientLogger ring buffer keeps for "Report a problem", and (2) shows a toast
 * whose action opens that form. Deduped per step so a double tap is one toast.
 *
 * @param {string} step - where the chain stopped, e.g. 'gameLoading', 'addClipRegion', 'saveClip'
 * @param {object} context - everything a reader needs to reproduce (game id, playhead, durations, response)
 * @param {{title?: string, message?: string}} [copy] - defaults to the not-saved copy
 */
export function reportMarkPlayFailure(step, context, copy = {}) {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  console.error(`[MarkPlay] ${step}`, { step, ...context, userAgent });

  const title = copy.title ?? ANNOTATE.MARK_PLAY_FAILED_TITLE;
  const message = copy.message ?? ANNOTATE.MARK_PLAY_FAILED_MESSAGE;
  const action = ENABLE_PROBLEM_REPORT
    ? { label: ANNOTATE.MARK_PLAY_REPORT_ACTION, onClick: () => useProblemReportStore.getState().requestOpen() }
    : undefined;
  toast.error(title, { message, dedupKey: `mark-play-${step}`, ...(action && { action }) });
}
