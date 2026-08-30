# T8080: Reel Drafts classification toggle (By Game / By Phase)

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-29
**Updated:** 2026-08-29

## Problem

The Reel Drafts screen always groups drafts by game, with stage sub-rows inside each game
(T6810). The user wants to choose the primary classification: **By Game** (today's behavior)
or **By Phase** (primary grouping is pipeline stage, renamed from "Status" to "Phase" for this
control), defaulting to **By Phase**.

## Solution

Add a session-only (never persisted, per `feedback_no_persisted_view_state`) view-mode toggle
above the drafts list: **By Game** | **By Phase**, default `phase`.

- **By Game** (existing): unchanged — `CollapsibleGroup` per game, `DraftStageRows` inside
  (one carousel row per stage present, aspect sub-split).
- **By Phase** (new): one section per pipeline stage present (Not Started -> In Focus ->
  In Overlay -> Ready, same `DRAFT_STAGE_ORDER`), each sub-grouped by game (a small game-name
  label + one carousel row per aspect present within that game+phase bucket), ungrouped drafts
  fold into an "Other reels" bucket per phase. Resolved with the user 2026-08-29: sub-group by
  game, not a flat mixed carousel.
- Games tab is explicitly OUT of scope (confirmed with user) — stays a wrapping poster grid.
- The carousel-on-overflow behavior the user asked for already exists via `CardCarousel` in
  the stage rows; the By-Phase view reuses the same primitive for its game rows, so no new
  carousel behavior is needed, just a new grouping shape.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — `groupedProjects` memo (~line 608),
  `DraftStageRows` component (~line 80), render block (~line 1493-1544): add classification
  toggle UI + `groupedByPhase` memo + render switch
- `src/frontend/src/utils/draftStage.js` — extract the stage-aware aspect-split branch out of
  `stageRowsFor` into a reusable `aspectRowsForStage(stage, projects)` helper so the new
  phase-then-game grouping can reuse it instead of duplicating the not-started-landscape
  special case
- `src/frontend/src/stores/settingsStore.js` — add `projectFilters.classification` session-only
  field (`'phase' | 'game'`, default `'phase'`) + `setClassification` setter, same pattern as
  `statusFilter`/`aspectFilter`
- `src/frontend/src/components/ProjectManager.grouping.test.jsx` (new or existing) — unit tests
  for the phase-then-game grouping function

### Related Tasks
- Builds on: T6810 (game-group stage rows), T6800 (stage derivation, source-aspect tiles)

### Technical Notes
- Reuse `getDraftStage`, `DRAFT_STAGE_ORDER`, `DRAFT_STAGE_LABELS`, `splitByRenderedAspect`
  from `draftStage.js` — do not re-derive stage buckets inline.
- Filters (`statusFilter`/`aspectFilter`/`creationFilter`) still apply to `filteredProjects`
  BEFORE either grouping, same as today.
- No persistence changes — pure view/grouping, matches the T6810 epic's own constraint.
- The existing `DraftStageRows` renderer is stage-major game-agnostic; generalize its row
  renderer (label + tint + byAspect) so both By-Game's per-game stage rows and By-Phase's
  per-phase game rows share one JSX implementation instead of duplicating markup.

## Implementation

### Steps
1. [x] `draftStage.js`: extracted `aspectRowsForStage` from `stageRowsFor`, added pure
       `phaseRowsFor(orderedGameGroups)` (takes game ordering as input rather than deriving it)
2. [x] `settingsStore.js`: added `classification` to `projectFilters` + `setClassification`
       setter, same session-only pattern as the other filters
3. [x] `ProjectManager.jsx`: `groupedByPhase` memo (built from `groupedProjects.sortedKeys` +
       `ungrouped`), classification toggle UI (default Phase), generalized `DraftStageRows`
       into a shared `DraftCarouselRows` renderer with `DraftStageRows`/`DraftGameRows` thin
       wrappers, render switch between By Game / By Phase
4. [x] Unit tests: 6 new `phaseRowsFor` tests (mixed games/phases, ungrouped fold-in, empty
       phases/games dropped, aspect-split parity) in `draftStage.test.js`
5. [x] Real-browser check: toggled between views against real account (imankh@gmail.com
       dev-login), verified counts/order/carousels, confirmed reload resets to By Phase
       (session-only, not persisted)

### Progress Log

**2026-08-29**: Implemented + live-verified. Reviewer (fresh-context) found 1 MAJOR issue —
the toggle's `role="group"` aliased `CardCarousel`'s `role="group"`, silently voiding 3
assertions in 2 existing e2e specs (`T5672-drafts-tiles-carousel.spec.js`,
`t5672-carousel-chevrons-auto-badge.spec.js`) that locate carousels via an unqualified
`[role="group"]`. Fixed by dropping the role from the toggle (matches this file's existing
filter-chip groups, which also carry no ARIA group role) — re-verified live that all 7
`role="group"` elements on the screen are now genuine carousel rows. Also addressed reviewer
MINOR findings: hoisted the `tint` default into `DraftGameRows` instead of a silent
fallback in the shared renderer, corrected an overstated "views can never disagree on
ordering" comment (the "Other reels" bucket's position legitimately differs: first in By
Game, last in By Phase — a placement choice, not a disagreement), fixed stale "In Framing"
wording in a new comment, added `type="button"`. Also fixed a pre-existing, unrelated stale
"In Framing" label (T7700 renamed it to "In Focus") in the same e2e spec my By-Game click
now reaches, so those aspect-split assertions actually run instead of silently matching
nothing. 103 targeted unit tests green (7 files), lint clean (pre-existing warnings only).
Merged to master (PR [#312](https://github.com/imankha/video-editor/pull/312), squash, CI
green — frontend job passed, backend job correctly skipped per the layer-scoped Branch CI
diff, no backend files touched).

## Acceptance Criteria

- [x] Toggle control switches between By Game and By Phase, defaulting to By Phase
- [x] By Phase groups drafts into Not Started / In Focus / In Overlay / Ready sections, each
      sub-grouped by game, in pipeline order; empty phases/games not rendered
- [x] By Game view is visually/functionally unchanged from today
- [x] Games tab unchanged
- [x] No persisted view state; filters still apply before grouping
- [x] Tests pass
