/**
 * offerFocusCompletionPreview (T9285) — the decision FocusScreen's live
 * completion path makes once a preview URL has (or hasn't) resolved: open the
 * store-driven preview + record the funnel achievement, or fail loudly.
 *
 * Extracted out of `handleProceedToOverlayInternal` (review fix) so this
 * specific branch is unit-testable against the REAL implementation instead of
 * a verbatim copy living inside a test file — the same
 * abstract-for-testability move `handleOverlayExportCompletion.js` and
 * `resumeFocusCompletion.js` already make for their own decision logic.
 *
 * Pre-T9285 this compound render gate (`showExportCompletePreview &&
 * exportPreviewUrl`) just stayed false on a null preview URL — a silent
 * no-render, a no-silent-fallback violation. The `else` branch here is the fix.
 *
 * @param {Object} params
 * @param {number} params.projectId
 * @param {string|null} params.previewUrl
 * @param {string} params.openMode
 * @param {(payload:{projectId:number, previewUrl:string, openMode:string}) => void} params.openPreview
 * @param {(id:string) => void} params.recordAchievement
 * @returns {boolean} whether the preview was opened
 */
export function offerFocusCompletionPreview({ projectId, previewUrl, openMode, openPreview, recordAchievement }) {
  if (!previewUrl) {
    console.error('[FocusScreen] export completed but no preview URL for project', projectId);
    return false;
  }
  openPreview({ projectId, previewUrl, openMode });
  recordAchievement('overlay_offered');
  return true;
}
