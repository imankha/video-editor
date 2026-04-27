# T1950: Rename "Reels" → "Drafts" and "Gallery" → "My Reels"

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-27
**Updated:** 2026-04-27

## Problem

Users don't understand that finished reels move from the editing area to the gallery. The current "Reels" / "Gallery" labels don't signal a progression. "Reels" doesn't convey "in progress" and "Gallery" doesn't convey "final destination for your reels."

## Solution

Rename across all user-facing UI:
- **"Reels" → "Reel Drafts"** — signals incomplete, implies a next step, keeps domain context
- **"Gallery" → "My Reels"** — signals final collection, the payoff

This is a follow-up to T1390 (Rename Projects to Reels), further refining terminology based on user confusion.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/` — tab labels, headings, breadcrumbs, navigation
- `src/frontend/src/stores/` — store names/comments referencing "reels" or "gallery"
- `src/frontend/src/hooks/` — any user-facing strings
- `src/frontend/src/pages/` — page titles, empty states, tooltips

### Related Tasks
- T1390 (Rename Projects to Reels) — predecessor, DONE
- T1550 (Unified Navigation) — breadcrumbs/tab bar that will contain these labels

### Technical Notes
UI-only rename. No backend changes, no DB schema changes, no API changes. The internal code can keep using "project" / "gallery" — only user-facing strings change.

## Implementation

### Steps
1. [ ] Audit all user-facing strings containing "Reels" (tab labels, headings, empty states, tooltips, breadcrumbs)
2. [ ] Audit all user-facing strings containing "Gallery" (same scope)
3. [ ] Rename "Reels" → "Reel Drafts" in all user-facing contexts
4. [ ] Rename "Gallery" → "My Reels" in all user-facing contexts
5. [ ] Verify navigation breadcrumbs and tab bar reflect new names
6. [ ] Visual check of all screens for consistency

## Acceptance Criteria

- [ ] In-progress/editing items labeled "Reel Drafts" everywhere
- [ ] No user-facing UI says "Gallery" — replaced with "My Reels"
- [ ] Breadcrumbs, tabs, headings, empty states, tooltips all consistent
- [ ] Internal code variable names unchanged (no backend churn)
