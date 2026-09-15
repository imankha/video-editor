# T10080: Exported 16:9 reels block Overlay menu options due to layout

**Status:** SUPERSEDED (2026-09-15, user-confirmed)
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

**Investigated 2026-09-14 (Explore agent, code-only pass, not live-reproduced): appears already
superseded, recommend closing.** The actual Overlay layout lives in
`src/frontend/src/modes/OverlayModeView.jsx` (not `components/overlay/`, which only holds
sub-panels), with the desktop settings rail in `src/frontend/src/components/settings/SettingsRail.jsx`.

This exact bug class was hit and fixed **twice** before this 2026-09-14 report:
- **T9150** (2026-09-08/09, commit `869f7a16`) first added an explicit `calc(100%-22rem)` cap on
  the video column to keep it from overlapping the rail.
- **T9270** step 2 (2026-09-09, commit `e5499473`) removed that cap and switched to the current
  flexbox layout: the desktop row (`OverlayModeView.jsx:954-985`) has the video column as
  `lg:flex-1 lg:min-w-0` and `SettingsRail` as a sibling that is `shrink-0` with a fixed
  `width: 300px` (`SettingsRail.jsx:152-163`). Flexbox guarantees the rail's width; the video
  column absorbs remaining space and is capped by `max-w-full` — it cannot mathematically overlap
  or push the rail off-screen under this layout.

The 2026-09-14 bug report (viewport 2224x1277, well above the `lg` breakpoint) reads as describing
**pre-T9270 behavior** — the fix landed 5 days before the report. **T9860 (today's copy sweep) did
not touch this file's layout**, only a `MODE_NAMES` import — confirms its own "no layout change"
claim, ruling it out as a regression source.

**One stale artifact found, unrelated to whether the bug is live:** the comment at
`OverlayModeView.jsx:385-392` still references the removed `lg:max-w-[calc(100%-22rem)]` cap, and
the e2e harness (`t9100diag/main.jsx`, `T9100-overlay-detection-alignment.qa.spec.js`) still tests
the old cap-based approach instead of the real component. Minor cleanup, not evidence the layout
bug itself is live.

**Not live-reproduced against a real 16:9 export** — this is a code-reading verdict, not a
Playwright confirmation. Recommend the user either (a) accept this as closed/superseded given the
flexbox layout mathematically rules out the reported overlap, or (b) ask for a quick live-drive
confirmation before closing. Leaving status as TODO pending that call — AI does not close tasks
unilaterally.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/OverlayModeView.jsx:373-398` (aspect-ratio video sizing), `:954-985`
  (desktop row layout), `:385-392` (stale comment referencing the removed cap)
- `src/frontend/src/components/settings/SettingsRail.jsx:152-163` (fixed-width rail, `shrink-0`)
- `t9100diag/main.jsx`, `T9100-overlay-detection-alignment.qa.spec.js` — e2e harness still
  exercises the old cap-based approach, not the current component (stale, minor follow-up)

### Related Tasks
- Related to T10070 (same reporter, same email, unrelated bug)
- May be superseded or absorbed by the in-progress Overlay/Focus redesign (T9860 and siblings)

## Implementation

### Steps
1. [x] Check against current Overlay redesign work before investigating further — done 2026-09-14,
   see Solution above: superseded by T9150/T9270, appears already fixed.
2. [ ] (Optional, low priority) Live-reproduce with a real 16:9 export to fully confirm before
   closing — not yet done, code-only verdict so far.
3. [ ] (Optional, small follow-up) Clean up the stale `calc(100%-22rem)` comment and the
   cap-based e2e harness in `t9100diag`/`T9100-overlay-detection-alignment.qa.spec.js`.

### Progress Log

**2026-09-14**: Filed from reporter's email. Investigated same day (Explore agent, code-only):
the layout fix (T9150 -> T9270, both 2026-09-09) already replaced the fixed-width cap with a
flexbox layout that cannot overlap the settings rail; the 2026-09-14 report reads as describing
pre-fix behavior. Recommend closing as superseded; awaiting user confirmation (AI does not close
tasks unilaterally) before removing from PLAN.md.

**2026-09-15**: User confirmed closing as superseded. Marked SUPERSEDED in place (not deleted),
same convention as T6430. The stale comment at `OverlayModeView.jsx:385-392` (references the
removed cap) and the cap-based e2e harness (`t9100diag`/`T9100-overlay-detection-alignment.qa.spec.js`)
remain as minor, low-priority cleanup debt — not filed as a separate task given how small they are.

## Acceptance Criteria

- [ ] 16:9 exported reels no longer block/overlap Overlay menu options, or task is closed as
      superseded by the redesign with a note explaining why.
