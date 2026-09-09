/**
 * Gesture-rule decision for the Framing -> Overlay transition (T4020).
 *
 * Working clips are versioned; readers take MAX(version)
 * (`latest_working_clips_subquery`). An export produces the real exported
 * version (crop keyframes + trim + segment speed, `exported_at` set) via the
 * full-state save that fires on the export-button click, BEFORE render
 * (`ExportButtonContainer` -> `saveCurrentClipState`). Every individual edit is
 * also persisted surgically from its own gesture handler.
 *
 * The export -> overlay transition that follows is NOT a user gesture. By the
 * time it runs, the rendered working video's metadata has superseded the source
 * clip's, so `useCrop`/`useSegments` have re-initialized to defaults (empty crop
 * + default segments). Calling the full-state save again there would write that
 * empty/default state as a NEW MAX(version), shadowing the real exported version
 * and blanking the editor on the next load.
 *
 * Per the gesture rule in CLAUDE.md ("Full-state saves require explicit gesture:
 * saveCurrentClipState only runs on export button click, never reactively"), a
 * post-export transition must never persist full state. This predicate
 * centralizes that decision so the invariant is pinned by a unit test: it must
 * stay `false`.
 *
 * @returns {boolean} Whether the export -> overlay transition should persist
 *   full framing state. Always `false`.
 */
export function shouldPersistFocusForOverlayTransition() {
  return false;
}

/**
 * T9280: Decide whether a completed Focus export should SKIP the preview-first
 * completion screen (`FocusPublishActionBar`, T8390) instead of showing it.
 *
 * The completion callback (`FocusScreen.handleProceedToOverlayInternal`) compares
 * the project the export STARTED for (`exportedProjectId`, captured in the
 * ExportButtonContainer WS closure) against the project the store says is
 * selected NOW (`useProjectsStore.getState().selectedProjectId`). The ONLY
 * legitimate reason to skip the preview is that the user has deliberately moved
 * on to editing a DIFFERENT project — hijacking their screen with this project's
 * completion preview would be wrong.
 *
 * The bug this fixes: the old inline guard was `exportedProjectId &&
 * exportedProjectId !== currentlyViewingProjectId`, which treated a
 * null/absent `currentlyViewingProjectId` as a divergence and skipped the
 * preview. But `null` is NOT "the user went to another project" — it is a
 * transient no-project-selected blip (an in-flight selection clear, an app
 * auto-navigation, the clearSelection->resurrect race). Conflating "no project"
 * with "a different project" silently dropped the completion screen the whole
 * First Reel Funnel (T8390/T8520/T8530/T9110) was built around. Per CLAUDE.md
 * "no silent fallbacks for internal data": a missing selection must not be
 * quietly reinterpreted as a deliberate navigation.
 *
 * Skip ONLY when BOTH ids are truthy AND differ. A null/absent
 * `currentlyViewingProjectId` (or a missing `exportedProjectId`) is never a
 * skip — the caller proceeds to show the preview (harmless if the screen has
 * since unmounted; correct if it is still mounted for the exported project).
 *
 * @param {string|number|null|undefined} exportedProjectId - project the export ran for
 * @param {string|number|null|undefined} currentlyViewingProjectId - store's current selection
 * @returns {boolean} true => skip the completion preview (user is on a different project)
 */
export function shouldSkipFocusCompletionPreview(exportedProjectId, currentlyViewingProjectId) {
  return Boolean(
    exportedProjectId &&
    currentlyViewingProjectId &&
    exportedProjectId !== currentlyViewingProjectId
  );
}
