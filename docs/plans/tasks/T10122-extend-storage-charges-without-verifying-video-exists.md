# T10122: "Extend storage" can charge credits for a game whose video is already gone

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Found as a byproduct of the T10120/T10121 expert investigation, not from a user report — filing
before it produces one.

`extend_game_storage` (`src/backend/app/routers/games.py:1901-1966`) deducts credits and writes a
future-expiry `game_storage` ref **without ever checking that `games/{hash}.mp4` still exists in
R2**. `can_extend` (the value that gates whether the "Extend storage" button even renders) is a
UI-only guard computed from ref/grace-window state, not a live existence check. If a user reaches
the Extend action on a game whose object is already gone by some other path (any of T10121's
mechanisms, or a manual admin action, or a future bug), they pay credits for a ref to nothing.

`_ensure_game_storage_refs` (`games.py:943`) already does the correct thing — a real R2 `HEAD`
check — for the normal ref-creation path. `extend_game_storage` should adopt the same check rather
than trusting `can_extend`'s UI-layer inference.

## Solution

In `extend_game_storage`, before deducting credits or writing the extended ref: `HEAD` the game's
video object(s) in R2 (same helper `_ensure_game_storage_refs:943` uses). If missing, return 410
Gone (or equivalent) and charge nothing, rather than silently accepting payment for an extension
that extends nothing.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py:1901-1966` (`extend_game_storage`, the fix target), `:943`
  (`_ensure_game_storage_refs`'s existing HEAD-check pattern to reuse)

### Related Tasks
- Found during T10120/T10121's investigation (2026-09-14 bug-report triage pass); independent of
  both, can ship on its own schedule

### Technical Notes
- Fail loud, no silent fallback: an extend request against a missing object should error clearly,
  not silently succeed or silently no-op.

## Implementation

### Steps
1. [ ] Add the R2 existence check to `extend_game_storage` before any credit deduction or write.
2. [ ] Return a clear error (410 or similar) when the video is missing; no charge.
3. [ ] Backend test: extending a game whose object is missing from R2 charges nothing and errors
   clearly.

### Progress Log

**2026-09-14**: Filed from the T10120/T10121 expert investigation.

## Acceptance Criteria

- [ ] `extend_game_storage` never deducts credits for a video that no longer exists in R2.
- [ ] Backend test covers the missing-object case.
