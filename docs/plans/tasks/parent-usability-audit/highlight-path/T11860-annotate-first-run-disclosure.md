# T11860: First-run Annotate shows one obvious action

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (frontend only, ~4 files + tests, ~120 LOC)
**Created:** 2026-10-04
**Decision gate:** H4 (recommended option B + conditional phone zoom) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 3 of 3 in [Epic D](EPIC.md). Runs after T11750 and T11840 (same `AnnotateModeView.jsx`).
Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/03](../../../ux/2026-10-04-parent-usability-audit/desktop/03-upload-processing-conflicting-status.png),
[iphone/07](../../../ux/2026-10-04-parent-usability-audit/iphone/07-new-game-editor-overflow-and-hidden-title.png).
A parent opening a fresh game sees frame-step buttons, a video zoom, a timeline zoom chip reading
"300%", a scrollbar, and "My athlete / Team" filters around a single green button. They only need:
play the game, press Mark play after a great moment.

## Solution (option B + conditional zoom)

While the game has **no plays** (`hasAnnotateClips === false`, already computed in `AnnotateModeView`;
derived, nothing stored):

- **Hide:** frame-step buttons (keep play/pause, the 5s back/forward skips and the 1x speed), the
  timeline zoom chip and its scrollbar, and the My athlete / Team chips (nothing to filter yet).
- **Show** a **More controls** text button (`SlidersHorizontal` 14, `text-sm text-gray-300`) under the
  transport row. It reveals everything for the rest of the session, held in component memory only.
- **Promote the helper** (`ANNOTATE.MARK_PLAY_HELPER`, `config/displayNames.js:19`) to
  `text-base text-gray-200`: **Play the game. Right after a great moment, press Mark play. It keeps
  the 6 seconds before and 2 after.** Read the 6/2 numbers from `clipConstants.js:86-88`; never
  hardcode them.
- Once the first play exists, everything appears as today and never re-hides on that game.

**Phone timeline zoom:** 100% while the game has 0 plays, 300% from the first play (T10780's reason
for 300%, legible play bars, only applies once plays exist). When it switches, scroll so the new play
is centered. Also make `resetZoom` (`hooks/useTimelineZoom.js:59-62`) return to the current default,
not always 100. Desktop stays at 100%.

## Relevant Files (under `src/frontend/src/`)

- `modes/AnnotateModeView.jsx:345` (`useTimelineZoom(isMobile ? 300 : 100)`), `:1391-1395` (helper)
- `hooks/useTimelineZoom.js:15, 59-62` (MIN/MAX/STEP, read once at mount)
- `modes/annotate/components/AnnotateControls.jsx`, `components/Controls.jsx` (transport, frame step, video zoom)
- `modes/annotate/components/ClipsSidePanel.jsx:13-18` (My athlete / Team filter)
- `components/timeline/TimelineZoomChip.jsx`

## Implementation Steps

1. Add a `showAllControls` local state in `AnnotateModeView` (memory only, default false) and a
   derived `simplified = !hasAnnotateClips && !showAllControls`.
2. Pass `simplified` into the controls, the zoom chip and the side-panel filter, and hide those
   pieces when true.
3. Make the zoom default a function of `hasAnnotateClips`, and allow `useTimelineZoom` to accept a
   new default when the first play appears (today it reads the default once at mount). When it
   switches, scroll the new play to center.
4. Update the helper copy.

## Acceptance Criteria

1. Fresh game at 390 and 1440: video, transport (play/pause, skips, speed), Mark play, the helper and
   one action row; no zoom number, no scrollbar, no layer filters, no frame-step.
2. "More controls" reveals them until leaving the screen.
3. After the first Mark play, everything is visible; on phones the timeline is at 300% with the new play in view.
4. Games that already have plays look exactly as today.

## Tests (red first)

- `AnnotateModeView.timelineZoom.test.jsx`, `modes/annotate/AnnotateTimeline.mobileZoom.test.jsx`,
  `components/timeline/TimelineBase.mobileScrollbar.test.jsx`: add the 0-plays -> 100% and
  first-play -> 300% cases.
- New `AnnotateModeView.firstRunDisclosure.test.jsx`.
- E2E (local): `e2e/T10780-mobile-timeline-zoom.qa.spec.js` (start from a game with plays, or add a 0-play case).

## Landmines

- T10890 verdict: do not fake a minimum bar width; zoom is the fix for skinny bars. That is why 300%
  returns once plays exist.
- Never persist `showAllControls` (no persisted view state).
- Record the narrowing of T10780/T10930 in their task files (dated 2026-10-04 ruling H4).
- Tutorial T7630/T7640 must anchor on "Mark play", not on hidden controls; add that note to their files.
