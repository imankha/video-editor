# T11570: Spotlight Guided Athlete Pick (auto-advance through every green marker)

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Problem

In Spotlight, after the user taps their athlete at one green detection marker, the "Tap your
athlete" prompt disappears and the panel says "Your player is selected. Add another only if you
want to" — but the `select_players` quest step only completes once **every** marker is assigned.
Finding the next marker is left entirely to the user: on a phone the markers are a dense 24px row
under their thumb, and nothing points at the next unpicked one. User-reported directly, asking for
a foolproof, automatic walk through every marker.

User-approved design/mockup: https://claude.ai/artifact/Qpji171nS2AK5xsCWfTou5 (interactive mock +
full spec, checked across 7 screen sizes; user said "i like it").

## Solution

A short, repeating guide loop drives the whole pick flow:

1. **Entry park** — opening Spotlight with unpicked markers auto-parks on the first one, boxes
   already visible, guide says "Tap your athlete · Step 1 of N".
2. **Pick → confirm → advance** — tapping a box (or dragging the circle onto an unboxed athlete)
   shows a brief green "Got it" confirmation (650ms, 0ms under `prefers-reduced-motion`), then the
   playhead glides to the next **unpicked** marker (forward from the one just picked, wrapping to
   the start) and parks there with "Step N+1 of N".
3. **Away** — playing or scrubbing off the active marker shrinks the guide to "Step N of N still
   needs your athlete" + a "Go to step N" button; tapping any marker directly also re-parks.
4. **Done** — once every marker is picked: "All N done. The spotlight follows your athlete." +
   "Play spotlight"; the styling panel's step checklist takes over from the per-tap guide.

No skip button — "Not boxed? Drag the circle" always produces a pick, so the walk always
terminates and the quest always completes. Decisions already made with the user (see artifact
§ "Your call on three things"): no skip, auto-park on entry, 650ms confirm pause.

**Reverses part of T9960 (2026-09-15):** T9960's "Add another only if you want to…" copy read
extra picks as optional. This task makes walking every marker the default path; Spotlight as a
*whole* stays optional (Publish without spotlight, T10660, is untouched) — the two only conflicted
because the old copy blurred "more markers of the same athlete" with "more athletes".

Related, narrower-scope task already on the board: T10880 (pulsating-guidance audit) flagged the
same gap as a to-be-triaged observation; this task supersedes it for the Spotlight pick flow
specifically — T10880 can stay open for any other funnel screens it finds.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/utils/detectionAssignment.js` — add `orderedDetectionMarkers`
  (single ordering source) and `nextUnpickedMarker` (forward-then-wrap); `detectionAssignmentStates`
  derives from the same ordering.
- `src/frontend/src/containers/OverlayContainer.jsx` — pull marker-click body into a
  `parkOnDetection(marker)` method; wire post-pick auto-advance (ref-held 650ms timer) into
  `handlePlayerSelect` / `handleHighlightComplete`; entry-park on mount when unpicked markers exist.
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx` — marker clicks call the new
  `parkOnDetection` path instead of duplicating seek logic.
- `src/frontend/src/modes/OverlayModeView.jsx` — replace the inline banner (~line 665) with a new
  `SpotlightPickGuide` component; `placement="overlay" | "strip"` per the responsive spec.
- `src/frontend/src/components/settings/OverlaySpotlightPanel.jsx` — swap
  `SELECT_PLAYER_DONE`/`SELECT_PLAYER_ADD_MORE` for a step checklist read from
  `questStore.detectionAssignProgress` (data already exists, no new source).
- `src/frontend/src/config/displayNames.js` — new `EDITOR_PANELS` copy keys (see artifact §
  "Copy"); retire `SELECT_PLAYER_DONE` / `SELECT_PLAYER_ADD_MORE`, keep `SELECT_PLAYER_OPTIONAL`.
- New: `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx` (presentational view).

### Related Tasks
- Supersedes (for this flow): T10880 (pulsating-guidance audit)
- Touches copy last changed by: T9960 (single-athlete completion copy), T9620/UX-10
  (player-selection-first sequencing), T5610 (tap-the-circle override), T5430 (44px touch hit-pads)

### Technical Notes
- **No new persistence.** The only DB write stays the existing keyframe write from
  `addHighlightRegionKeyframe` on each pick. Guide phase/active-marker/confirm-timer are ephemeral
  view state (component state or a ref-held timeout), never a `useEffect` watching state to
  trigger the advance — the advance is scheduled synchronously inside the pick gesture handler,
  per the project's gesture-based persistence rule.
- Cancel the pending auto-advance timer on: play, scrub-away (existing clicked-detection clear
  effect already does this), a direct marker tap, mode switch, and unmount.
- Entry-park must coordinate with the existing T5658 "Reset to start" / T11420 (timeline scroll
  reset on Spotlight entry) behavior so they don't fight over the initial seek.
- Guide placement rule: never overlap a detection box. Full placement table (desktop/tablet/phone
  inline/small phone/phone fullscreen/landscape) is in the artifact spec.

## Implementation

### Steps
1. [ ] Add `orderedDetectionMarkers` + `nextUnpickedMarker` to `detectionAssignment.js`; re-derive
   `detectionAssignmentStates` from the shared ordering (unit tests for wrap-around).
2. [ ] Extract `parkOnDetection` in `OverlayContainer`; repoint `DetectionMarkerLayer`'s click body
   at it.
3. [ ] Wire auto-advance (650ms, cancelable) into the pick handlers; add entry-park on mount.
4. [ ] Build `SpotlightPickGuide` (overlay + strip placements) and wire it into `OverlayModeView`.
5. [ ] Replace the done-state copy in `OverlaySpotlightPanel` with the step checklist.
6. [ ] Add the new `EDITOR_PANELS` keys; remove the retired ones (grep for other callers first).
7. [ ] Playwright responsive check across the 10 viewports listed in the artifact's "Done when"
   section — assert the guide's bounding box never intersects a detection box's bounding box.

### Progress Log

**2026-10-01**: Task filed from a direct user request; design mocked up and approved ("i like it")
before implementation. Not yet started.

**2026-10-03**: Landed (PR #554, squash `d1b52fbd`) after 5 full review rounds — the first 4 each
found a real BLOCKING or MAJOR issue (entry-park never firing in the real app; a `forcedCompact`
infinite-loop crash; an auto-advance misattributing an in-progress drag's keyframe to the wrong
marker; that fix cancelling only on first drag-move instead of pointerdown). Round 5 found the
fix had structurally converged at the gesture's source (pointerdown, across all three entry
points in `HighlightOverlay.jsx`). Proof Verifier: VERIFIED, with one non-blocking suggestion —
the `OverlayScreen`/`OverlayModeView` prop-forwarding hops (`onHighlightDragStart`/`onDragStart`)
are correct at this head but verified only by reading the code, not a dedicated test; the same
bug class as round 1's BLOCKING finding (a wiring gap invisible to jsdom-only coverage). Fast-
follow suggestion for a future task: add an `OverlayModeView`-level test with a spy
`onHighlightDragStart`, firing `pointerDown` on `highlight-body`/`highlight-enter-hit`, asserting
the spy fires, plus a check that `OverlayScreen` forwards the container handler.

## Acceptance Criteria

- [ ] Entering Spotlight on a clip with N unpicked markers parks on marker 1 with "Tap your
      athlete · Step 1 of N".
- [ ] Tapping a box shows "Got it", then within ~1s the playhead is on the next unpicked marker
      with its boxes visible and "Step 2 of N" shown.
- [ ] After the Nth pick: "All N done", the `select_players` quest step completes, styling panel
      shows. No extra network writes beyond the one keyframe write per pick.
- [ ] Jumping to marker 3 first, then picking, routes to 4, then wraps to 1 and 2.
- [ ] "Not boxed? Drag the circle" assigns that marker on release and advances the same way.
- [ ] Playing or scrubbing during the 650ms confirm window cancels the pending jump.
- [ ] The guide never overlaps a detection box and every guide control is ≥44px tall, verified at
      all 10 viewports in the Playwright check above.
