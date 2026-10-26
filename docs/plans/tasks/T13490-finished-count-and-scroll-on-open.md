# T13490: Finished tab count says 3 for an account with 4 finished highlights, and the tab opens scrolled to the bottom (verify)

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** S/M (frontend)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844 (report bugs 9 and 12, `report-390.png`). The count discrepancy is unsure: the earlier tester reported four finished highlights; the fourth may be a collection or a game highlight.

## Problem

1. The Finished badge shows 3 and the coach says "You have 3 highlights. Tap one to share it or download it, or open a game to mark another play." The account was reported to have four finished highlights. Check whether the count excludes something it should include, or the brief was wrong.
2. Opening the Finished tab with Guidance on lands scrolled to the bottom (Ranking Progress card) with a "Scroll up to continue" pill, instead of at the top where the highlights are.

## Solution

1. Compare the badge/coach count source with the highlights the tab lists for this account; fix the count if it is wrong, otherwise close as not a bug.
2. Find what scrolls the page on open (likely the coach scrolling to a pulse target in the lower cards) and keep the tab at the top.

## Context

### Relevant Files
- Finished tab (`/home/published`) components, `FloatingCoach.jsx` (scroll pill)
- `.claude/knowledge/guidance.md`

## Acceptance Criteria

- [ ] Badge and coach count match the highlights listed
- [ ] Finished tab opens at the top
