# T13480: At 390 the Annotate play-info overlay covers most of the video, and shows while the clock reads 0:00

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844, game "Vs Carlsbad QA" (4 plays) (report bug 10, `annotate-390.png`).

## Problem

On opening the game, the play-info card ("0'00" QA first play" plus its note "QA test: team passing sequence") sits over the video and covers most of the visible pitch at phone width. The transport clock reads 00:00:00.000 while the timeline places that play at 0:04, so the card appears to belong to a moment the user is not on.

## Solution

At narrow widths shrink the card (single line, smaller type, or below the video), and only show it while the playhead is inside the play's range. Confirm what "0'00"" means on the card versus the 0:04 timeline label and make them agree.

## Context

### Relevant Files
- Annotate video overlay / play info component in `src/frontend/src/modes/annotate/`
- `.claude/knowledge/annotate.md`

## Acceptance Criteria

- [ ] At 390 the card covers no more than a small band of the video
- [ ] The card time matches the timeline, and it shows only while the playhead is inside the play
