# T14420: Annotate play editor at 768: guide card parks 638 px from Done and the trim bar is shaded

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** S (frontend guide placement)
**Created:** 2026-11-02
**Updated:** 2026-11-02
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-11-02 ([RESULTS.md section 12](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r4-annotate-editor-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk). Residual of T13160, which fixed 1440 (18 px), 1024 (12 px) and 390 (56 px).

## Problem

At 768x1024 (iPad portrait, touch), after Edit play the guide says "Drag the green ends so the play starts and stops where you want. Tap Play to confirm you have the full play. Rate the play and optionally add tags and notes, then tap Done." Two things are wrong:

- The card docks at the top of the screen (x 176, y 56, 416x145), over the top of the video, while the pulsing Done button is at y 839 to 883: 638 px away. The `annotate.editor` rule's `keepClear` list (controls, scrub track, both handles, rating, Add details) leaves no slot near Done at this layout, so placement falls back to the top dock.
- The trim bar holding the green ends (around y 580 to 610) is shaded, although the sentence starts with "Drag the green ends". At 1440 the same bar is cut out of the shade. The touch layout's trim track is probably a different element from the one `shadeClear`/`keepClear` name.

## Solution

Make the editor rule place the card next to Done at 768 (below it, where the screen has about 140 px of empty space, or beside it), and keep the trim bar the copy names out of the shade on the touch layout.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js` (`annotate.editor` rule: `pulse`, `avoid`, `shadeClear`, `keepClear`)
- `src/frontend/src/components/instructions/FloatingCoach.jsx` (slot search, dock fallback, shade cutouts)
- `src/frontend/src/modes/AnnotateModeView.jsx` (the 768 trim track markup)
- `.claude/knowledge/guidance.md`

### Related Tasks
- Residual of T13160; found by T12590

## Acceptance Criteria

- [ ] At 768x1024 with the play editor open, the card is within 250 px of Done and does not cover it (live geometry, as in RESULTS.md)
- [ ] At 768 the trim bar with the green ends is not shaded
- [ ] 1440, 1024 and 390 still pass
- [ ] A unit test pins the placement and the cutout
