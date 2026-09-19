# T10430: Play progress badges - undone state reads as disabled, should be amber

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

T10410 shipped the four play-progress badges (rated/named/noted/clip) with the UNDONE
state styled gray-dashed — a deliberate choice in that task's decision artifact, kept
visually distinct from the clip badge's amber "nudge" treatment. User screenshot
(2026-09-18, after a hard refresh) shows the named/noted badges reading as disabled
rather than as an actionable "still needs filling in" prompt; user confirmed they want
ALL undone badges (rated/named/noted) amber, while the clip badge keeps its existing
rule (amber only at 5 stars via NUDGE; faded/gray via DORMANT below that).

## Solution

Changed `DISC_STATE[BADGE_STATE.UNDONE]` in `PlayProgressBadges.jsx` from
`border-dashed border-gray-500 text-gray-500 hover:border-gray-300 hover:text-gray-300`
to `border-dashed border-amber-500 bg-amber-500/10 text-amber-400 hover:border-amber-300
hover:text-amber-300`. Kept the dashed border (vs. NUDGE's solid) and no pulse animation,
so the clip badge's 5-star nudge still reads as the more urgent of the two amber
treatments. The clip badge never uses BADGE_STATE.UNDONE (it cycles DORMANT/NUDGE/
PENDING/DONE), so this change cannot affect it.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - `DISC_STATE` map + docstring

### Related Tasks
- Follow-up to T10410 (play progress badges), overrides its gray-undone ruling per
  fresh user feedback the same day.

## Implementation

### Steps
1. [x] Update `DISC_STATE[BADGE_STATE.UNDONE]` colors
2. [x] Update component docstring to describe the new treatment
3. [x] Lint + targeted tests, commit

### Progress Log

**2026-09-18**: Lint clean. Targeted run (`vitest related` on the two changed-relevant
files) 220/220 green across 33 files, including `AnnotateFullscreenOverlay.*` suites
that render `PlayProgressBadges`. Live-browser visual check skipped — Playwright was
already in use by another concurrent session on this shared machine (same known
constraint as T10380/T10360); low risk since `amber-500`/`amber-400`/`amber-300` are
the exact Tailwind tokens already proven live by the clip badge's NUDGE state in this
same file. Committed directly to master (single-file, well under 10 LOC, Tier S).

## Acceptance Criteria

- [x] Undone rated/named/noted badges render amber-dashed instead of gray-dashed
- [x] Clip badge's dormant/nudge/pending/done states unchanged
