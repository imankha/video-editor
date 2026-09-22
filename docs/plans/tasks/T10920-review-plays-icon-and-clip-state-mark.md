# T10920: Review plays: new icon + published/clipped mark on the play banner

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

User request from a Review-plays screenshot (2026-09-21):
1. The "Review plays" mode badge (and its launch buttons) needs a different icon than the
   plain play triangle.
2. The play banner (name + notes over the video) should say, in its upper-right corner,
   whether that play became a **published** clip (checkmark) or has been **clipped but not
   published** (a different sign).

## Solution

- Icon: `ListVideo` (lucide) for the playback-mode badge and both "Review plays" buttons in
  `AnnotateModeView.jsx` — a playlist glyph reads as "all plays in sequence".
- Banner mark: `NotesOverlay` takes a `clipStage` (a `CLIP_STAGE` value). `PUBLISHED` draws a
  green `CheckCircle2` ("Published clip"); `FOCUS`/`SPOTLIGHT`/`FINAL` (a clip exists, not
  published) draw a cyan `Film` glyph ("Clip created, not published yet"); `NO_PROJECT` draws
  nothing. The stage comes from the SAME `getClipStage(region, linkedProject)` +
  `useProjectsList` lookup the selected-region CTA already uses, so the banner can never
  disagree with the strip's stage CTA.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` (badge L~450, buttons L~1253/1315, banner props)
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx`
- `src/frontend/src/modes/annotate/components/NotesOverlay.clipState.test.jsx` (new)
- `src/frontend/src/modes/annotate/clipStage.js` (read only — single source of stage)

### Related Tasks
- T9330 (getClipStage single source), T8970 (playback-mode badge)

## Acceptance Criteria

- [x] Badge + both Review plays buttons use the new icon
- [x] Banner shows check for published, film glyph for clipped-not-published, nothing otherwise
- [x] `NotesOverlay.clipState.test.jsx` covers all three states
