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
export function shouldPersistFramingForOverlayTransition() {
  return false;
}
