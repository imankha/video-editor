# T8970: Playback Annotations mode: blank video on exit, sidebar click routing, and mode clarity

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-07
**Updated:** 2026-09-07

## Problem

Live-testing feedback (2026-09-07), verbatim from the user:

1. "Found a bug: when I went to playback annotations, then back to annotate, the video was
   blank."
2. "Users can still click on the clips menu when in playback annotation mode."
3. "The playhead on the selected play[list item] should be synced with where it's at in
   playback."
4. "The UI should be more clear when the user is in Playback Annotations mode versus
   'Annotation' mode."

### Root cause of item 1 (located, not a guess)

`AnnotateModeView.jsx` has an explicit comment (L244-246) stating the component uses "a
single return tree... toggling fullscreen changes CSS classes, not DOM structure. This
prevents video elements from unmounting/remounting (which loses loaded source)" - but the
code immediately below it (L247-253) does an early `return (...)` when
`isPlaybackMode && playback`, producing a COMPLETELY SEPARATE JSX subtree from the
annotate-mode return (L421+). The comment describes an invariant the code no longer
upholds.

Concretely: the annotate `<video>` elements (L509/L523, `ref={videoController._renderRefs.videoARef/videoBRef}`)
are UNMOUNTED the instant `isPlaybackMode` becomes true (a wholly different tree with its
OWN dual `<video>` elements, `useAnnotationPlayback.js`'s `videoARef`/`videoBRef`, renders
instead - confusingly, both systems use the same "A/B" naming for unrelated ref pairs, easy
to conflate when reading). These annotate `<video>` elements have NO `src` JSX attribute -
`src`/`.load()` are set IMPERATIVELY on the ref'd DOM node, in an effect keyed on the video
URL (`useVideo.js`/`useVideoProxy.js`). When the user exits playback mode, a BRAND NEW
`<video>` DOM node mounts and gets assigned to `videoController._renderRefs.videoARef.current`
- but since the video URL never changed, the src-assignment effect's dependency array
doesn't fire again, so the new DOM node never receives a `src`. Result: blank video.

### Items 2-3: partially wired already - needs live verification, not a rewrite from scratch

Reading `AnnotateScreen.jsx` (L677-740, the two `ClipsSidePanel` mounts) shows this is more
subtle than "sidebar ignores playback mode": `selectedRegionId`/`activePlaybackClipId` are
already switched to `playback.activeClipId` during playback, and `onSelectRegion` is already
rerouted to `playback.seekToClip` (not the annotate select handler) when
`playback?.isPlaybackMode`. So clicking a clip during playback SHOULD already seek playback
there and highlight the active clip as it advances. Two possibilities, and the implementer
must check which (or both) by live-driving, not by re-guessing from a static read:
- The wiring is correct but a DOWNSTREAM affordance on the sidebar row (rename, delete,
  drag-reorder, the pencil/edit entry) is NOT gated on playback mode and lets the user open
  the edit overlay or mutate a clip while playback is running - this is what "users can
  still click on the clips menu" most likely means, distinct from "clicking selects/seeks."
- The visual highlight (`activePlaybackClipId`) may not be rendering distinctly from the
  normal `selectedRegionId` highlight in `ClipsSidePanel.jsx`/its row component, so it LOOKS
  unsynced even though the data is correct - check the render code, not just the props.

### Item 4: no existing visual distinction

The playback-mode return tree (L253-420) uses plain `bg-white/10 backdrop-blur-lg` /
`bg-gray-900` framing - no color/badge distinct from annotate mode's neutral chrome. Other
modes in this codebase already use a consistent color-coded convention for state (T8600:
green = create, yellow = edit, violet = angle-active) - reuse that convention rather than
inventing a new color.

## Solution

- **Item 1**: the implementer must choose between two fixes and should default to
  restoring the comment's original invariant (keep the annotate video elements mounted at
  all times; render the playback UI as an overlay/replacement panel within the SAME return
  tree rather than an early return) over patching the remount-loses-src symptom (e.g. a
  callback ref that reapplies src on mount) - the latter treats the symptom and leaves the
  early-return structure that will keep tripping this class of bug. If the audit finds the
  single-tree restructure has real layout/state tradeoffs (it touches both the multiVideo
  and single-video render branches, plus `isSourceExpired`), that is exactly the kind of
  architecture call CLAUDE.md's model policy wants escalated to the Expert agent BEFORE
  implementing, not guessed at.
- **Items 2-3**: live-drive Playback Annotations first (see QA below) to pin the EXACT
  observed behavior, then fix the specific gap found - don't rewrite the existing
  activeClipId/seekToClip wiring, which looks correct on a static read.
- **Item 4**: give the playback-mode container a distinct color treatment (propose: cyan or
  blue family, since green/yellow/violet are taken by create/edit/angle) plus a persistent
  label/badge ("Playback Annotations" - already the button's own label, promote it into a
  header chip visible for the whole time the mode is active, not just as the entry button).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` - the two return trees (L244-420 vs
  L421-end); item 4's container framing
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` - playback's own dual
  video elements + all playback actions (`enterPlaybackMode`, `exitPlaybackMode`,
  `seekToClip`, `activeClipId`)
- `src/frontend/src/hooks/useVideo.js` / `src/frontend/src/hooks/useVideoProxy.js` - the
  annotate video's src-assignment effect (confirm exactly where it's gated on URL, not on
  ref/mount identity) and `_renderRefs` (`videoARef`/`videoBRef` for multi-video, `videoARef`
  alone for single-video - trace BOTH paths, the bug likely affects both)
- `src/frontend/src/screens/AnnotateScreen.jsx` (L677-745) - both `ClipsSidePanel` mounts
  (desktop + mobile overlay), already switch `selectedRegionId`/`onSelectRegion` on
  `playback?.isPlaybackMode`
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` (row click ~L310) - trace
  every row affordance (not just the primary click) for a playback-mode gate

### Related Tasks
- Touches the same `AnnotateModeView.jsx`/`clipEditBounds` territory as T8960 (play editor
  strip feedback) but a DIFFERENT render branch (playback-mode vs the add/edit overlay) -
  file-adjacent, not file-identical; check T8960's diff before starting to avoid a conflict
  on `AnnotateModeView.jsx` if both are in flight
- No known epic; standalone bug + UX clarity fix

### Technical Notes
- `useAnnotationPlayback`'s own dual-video ping-pong system is UNRELATED machinery to the
  annotate video's multi-video ping-pong (`useVideoProxy.js`) despite both using "A/B"
  video-ref naming - do not conflate them or assume a fix in one applies to the other.
- Persistence untouched: playback mode is pure ephemeral view state (already documented
  this way for angle switching, T8890 - same principle applies here).
- If the item-1 fix restructures the return tree, run the FULL existing playback test suite
  (not just new tests) since this is exactly the kind of structural change most likely to
  silently break the `isSourceExpired`/`multiVideo`/single-video branch matrix.

## Implementation

### Steps
1. [ ] Code Expert or manual audit: confirm the src-assignment effect's exact dependency
   array in `useVideo.js`/`useVideoProxy.js` and whether it fires on ref/mount change vs URL
   change only - this determines whether item 1's fix is a remount-avoidance restructure or
   a narrower reapply-on-mount fix.
2. [ ] If the restructure has real tradeoffs (layout, state ownership across the two former
   trees), escalate to the Expert agent for a design call before implementing (CLAUDE.md
   model policy) - do not guess.
3. [ ] Fix item 1; write a regression test that would have failed before (blank `src` after
   an enter->exit playback cycle) and passes after.
4. [ ] Live-drive Playback Annotations end-to-end to pin items 2-3's exact gap (which sidebar
   affordance is wrongly active, and/or whether the active-clip highlight actually renders
   distinctly) before writing the fix.
5. [ ] Fix items 2-3 per what the live drive found.
6. [ ] Item 4: distinct color treatment + persistent mode label on the playback container.
7. [ ] Tests: item 1 regression (src survives an enter/exit cycle); items 2-3 per the actual
   gap found; item 4 - a render test asserting the distinct treatment/label is present only
   in playback mode. E2E via dev-verify: enter playback, exit, confirm video plays (not
   blank); click a clip in the sidebar during playback, confirm the intended behavior;
   visually confirm the mode is unambiguous.

### Progress Log

**2026-09-07**: Filed from live-testing feedback. Root cause of item 1 located precisely
(early-return contradicts the component's own "single return tree" comment, plus the src
effect is URL-gated so a remounted video element never gets a src). Items 2-3 found to be
PARTIALLY wired already on a static read (`AnnotateScreen.jsx` already routes
`onSelectRegion`/`selectedRegionId` through playback state) - flagged for live verification
rather than blind reimplementation.

## Acceptance Criteria

- [ ] Entering then exiting Playback Annotations leaves the annotate video playable, not blank
- [ ] Whatever the live-drive finds broken in the sidebar during playback (item 2) is fixed,
      with the exact before/after behavior documented in the Progress Log
- [ ] The clip list's active-clip highlight visibly tracks the playing segment in real time
- [ ] Playback Annotations mode is visually unambiguous vs Annotation mode (color + label)
- [ ] Curated test set + e2e green
