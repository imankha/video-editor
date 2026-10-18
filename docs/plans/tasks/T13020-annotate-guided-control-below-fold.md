# T13020: Annotate guided control sits below the fold at 1440x900 and 1024x768

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M (frontend layout + guide)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

Annotate is taller than the viewport at 1440x900 and 1024x768, so the control the guide names is off-screen: Mark play (watch and playing steps), the Make highlight slots (selected play), Done (play editor) and Share plays (1024). The guide shade has no cutout for it, the card docks at the bottom or sits over the video, and at 1440 the "Scroll down to continue" pill overlaps the card's Got it button. This is why the parent-audit close fails: the full 1440 journey needs an unprompted scroll. Evidence: r2-annotate-watch-1440, r2-annotate-selected-1440, r2-annotate-editor-1440, r2-annotate-review-1440, r2-annotate-selected-1024.

## Solution

Keep the guided control inside the first viewport at 1440x900 and 1024x768 (fit the video to the remaining height, or move the action band up), and never let the scroll pill overlap the guide card.

## Context

### Relevant Files
- `src/frontend/src/` Annotate screen layout and action band
- `src/frontend/src/components/instructions/` (guide card, shade, scroll pill)
- `.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] At 1440x900 and 1024x768, Mark play, the Make highlight slots, Done and Share plays are fully on-screen with no scroll in every guided Annotate state
- [ ] The scroll pill never overlaps the guide card (geometry test)
- [ ] The full journey at 1440 completes with no unprompted scroll (re-check the T12590 audit close)
