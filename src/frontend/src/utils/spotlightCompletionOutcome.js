/**
 * spotlightCompletionOutcome (T16525) -- what OverlayScreen shows when a spotlight
 * render completes, decided from the project it re-read after the render.
 *
 * - 'none':  Focus's one-tap Finish fallback (App.jsx owns that completion, T9110), or
 *            no final video to show.
 * - 'finished': the render put it in Highlights itself (T16520 publishes every spotlight
 *               render; `is_finished`), so there is no Finish tap: land on the highlight.
 * - 'panel': the completion panel (OverlayPublishActionBar) with its Finish card, for a
 *            render that did not finish it.
 *
 * @param {Object|null} refreshed - the project detail re-read after the render
 * @param {{isFocusOneTapPublish:boolean}} opts
 * @returns {'none'|'finished'|'panel'}
 */
export function spotlightCompletionOutcome(refreshed, { isFocusOneTapPublish }) {
  if (isFocusOneTapPublish || !refreshed?.final_video_id) return 'none';
  return refreshed.is_finished ? 'finished' : 'panel';
}
