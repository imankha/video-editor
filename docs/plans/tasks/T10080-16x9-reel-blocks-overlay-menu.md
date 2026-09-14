# T10080: Exported 16:9 reels block Overlay menu options due to layout

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

sarkarati@gmail.com (2026-09-14 email) separately flagged: a 16:9 exported reel's layout blocks
some of the Overlay menu's options. Lower priority than T10070 — reporter himself noted the
Focus/export/Overlay flow is actively being redesigned and this may already be addressed or moot
once that lands. Filing so it isn't lost, not because it needs to jump the queue.

Reporter's words: "wanted to make sure you saw the bug that exported 16:9 reels block the options
in the Overlay menu due to the layout. Since you're actively redesigning the focus/export/overlay
flow, this might not be as important, but still wanted you to be aware since it exists on Live."

### Found in `bug_reports` (2026-09-14, T10090 restored connectivity)

Bug 56, 06:28 UTC, build `d9621161`, viewport 2224x1277: "Unable to access Overlay options for
16:9 exported reel. Video covers up the part of the screen where the overlay options are located."
`editor_context`: game 13 "Mission Viejo Classic: Vs Downey United Blue Aug 29", project 47
(16:9), clip 76, `overlay: {effectType: "dark_overlay", highlightShape: "body", ...}`. Screenshot
(Spotlight player-detection review screen) shows the video canvas spanning the full viewport width
with no visible side panel for overlay controls — consistent with a 16:9 aspect ratio pushing the
options panel off-screen or below the fold rather than reflowing next to a wide video. Console logs
also show `[ReportProblem] Video frame capture failed: ... Tainted canvases may not be exported`
around the same time — likely an unrelated CORS/canvas issue triggered by his own bug-report
screenshot capture, not the layout bug itself, but worth a glance if reproducing.

## Solution

Not yet investigated. Before spending time on this:
1. Check whether the in-progress Overlay/Focus redesign work (T9860 copy/concept sweep and
   related evaluation-2026-09-13 tasks) already changes this layout.
2. If still relevant after that work lands, reproduce with a 16:9 export in the Overlay menu and
   find the CSS/layout cause (likely an aspect-ratio-dependent width/overflow in the Overlay
   toolbar or menu container).

## Context

### Relevant Files (REQUIRED)
- Overlay menu/toolbar components — not yet located, needs a repro pass first
  (`src/frontend/src/components/overlay/` per the bug-triage skill's mode->directory mapping)

### Related Tasks
- Related to T10070 (same reporter, same email, unrelated bug)
- May be superseded or absorbed by the in-progress Overlay/Focus redesign (T9860 and siblings)

## Implementation

### Steps
1. [ ] Check against current Overlay redesign work before investigating further.
2. [ ] If still live, reproduce with a 16:9 export and identify the layout cause.
3. [ ] Fix.

### Progress Log

**2026-09-14**: Filed from reporter's email. Not started.

## Acceptance Criteria

- [ ] 16:9 exported reels no longer block/overlap Overlay menu options, or task is closed as
      superseded by the redesign with a note explaining why.
