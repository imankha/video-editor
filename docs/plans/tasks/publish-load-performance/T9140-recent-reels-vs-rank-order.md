# T9140: Decide: recency vs. rank order on the Publish list

**Status:** STAGING (decision closed; nothing to implement)
**Impact:** 4
**Complexity:** unknown pending direction (S if a "New" pin, M if the formula changes)
**Created:** 2026-09-08
**Updated:** 2026-09-08

## Epic Context

Epic 3/3 of [Publish Load Performance](EPIC.md). Independent of T9120/T9130 (product decision,
not a performance fix) — included in this epic because it came out of the same HAR-analysis
conversation and the same "front-load recently created items" request.

## Problem

The user asked whether recently-created reels could be front-loaded on the Publish screen. The
list currently orders by `ORDER_BY_RANK` (`src/backend/app/services/collection_metadata.py:53`,
T3630 — the Glicko ranking game):

```
(fv.rating IS NULL), fv.rating DESC,
(fv.quality_score IS NULL), fv.quality_score DESC,
fv.created_at DESC
```

Recency is only the third tiebreaker. A reel published minutes ago, seeded with an average
Glicko rating at export time (per the comment at that line: "seeded from the frozen star at
export, so it is sane even before any matchup"), can sort well below older, higher-rated reels.
This is a deliberate product decision from the ranking epic (T3630), not a bug — `created_at DESC`
being the last tiebreaker was chosen on purpose.

## Solution — not yet decided, needs your direction

This task is a decision doc, not a spec — do not implement before a direction is picked. Options
to weigh, from least to most invasive:

1. **Leave as-is.** The ranking game is the point of the Publish screen; if a fresh reel needs to
   "prove itself" via the same rating mechanism every other reel does, that's consistent, not
   broken. (Given all three collection read-paths — `list_downloads`, `collections_summary`, the
   T3620 resolver — plus the frontend's `utils/reelOrder.js` mirror all share `ORDER_BY_RANK`,
   "leave as-is" costs nothing and stays the default until you decide otherwise.)
2. **Time-boxed "New" pin.** Reels published in the last N hours (e.g. 24h) get pinned above the
   rank-ordered list in a small "New" section, without touching `ORDER_BY_RANK` itself — the
   ranking game stays pure, freshness is a presentation-layer addition. Lowest complexity, no
   migration, no change to the shared ordering constant used by 3 backend paths + 1 frontend mirror.
3. **Weight recency into the rating formula.** Changes `ORDER_BY_RANK` itself (or the seeded
   rating computation at export time) so a fresh reel's position reflects some decay-adjusted
   boost. Touches every consumer of the shared ordering (3 backend read-paths, `reelOrder.js`) —
   highest complexity, real risk of destabilizing the ranking game's existing behavior for
   everything else on the list.

## Context

### Relevant Files (once a direction is picked)
- `src/backend/app/services/collection_metadata.py:45-57` — `ORDER_BY_RANK`, the single source
  every consumer shares (per its own comment: don't let a fix drift into a second definition)
- `src/backend/app/routers/downloads.py:258` (`list_downloads`), `collections.py` (`/summary`), the
  T3620 resolver — the three backend read-paths
- `src/frontend/src/utils/reelOrder.js` — the frontend mirror of the same ordering (per the
  comment on `ORDER_BY_RANK`, must stay in sync if the SQL changes)
- Project memory: `project_t3630_ranking_game.md` — "don't deploy until UI done" note from the
  original ranking epic, useful context for how deliberate this ordering was

### Related Tasks
- Independent of T9120/T9130 (no shared code, purely coincidental origin in the same conversation)
- Predecessor: T3630 (the ranking game this task would be adjusting)

### Technical Notes
- Whatever direction is picked, preserve `ORDER_BY_RANK` as the ONE shared constant — don't let a
  quick fix duplicate the ordering logic into a second definition (the existing comment at
  `collection_metadata.py:45` already warns about this for the current 3+1 consumers).

## Implementation

### Steps
1. [x] Present the three options above to the user (or others they suggest) for a decision —
       **Option 1, leave as-is**, chosen 2026-09-08
2. [x] Once decided, scope + implement — leave-as-is means no code change; nothing to implement

### Progress Log

**2026-09-08**: Task filed from the HAR-analysis conversation. Awaiting direction — see options
above.

**2026-09-08 (later same day)**: User picked **Option 1, leave as-is** when presented the three
options via `/dotask`. The ranking game stays the sole ordering mechanism for the Publish list;
`ORDER_BY_RANK` and its 3 backend read-paths + `reelOrder.js` mirror are untouched. No code
change, no new tests. Task closed straight to STAGING (nothing to land).

## Acceptance Criteria

- [x] A direction is picked (including explicitly "leave as-is") — **leave as-is**, 2026-09-08
- [x] If changed: all consumers of `ORDER_BY_RANK` (3 backend read-paths + `reelOrder.js`) stay in
      sync — no duplicated ordering logic — N/A, nothing changed
- [x] If changed: existing ranking-game behavior for non-fresh reels is unaffected (regression test
      against T3630's existing ordering test coverage) — N/A, nothing changed
