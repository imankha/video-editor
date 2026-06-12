# T3670: Smart Collections: Top Goals / Assists / Dribbles

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-06-12

## Problem

Tag-themed highlight videos ("Top Goals") are high-value shareables parents would otherwise hand-build with the demoted Custom Mix flow. With tags frozen on final_videos (T3600) and rank established (T3630), these are pure derivation -- and near-miss visibility ("0:22 / 0:30") motivates the publish loop.

## Solution

SMART COLLECTIONS section in the Collections tab between SEASON and GAMES. See [EPIC.md](EPIC.md) decisions #1, #2, #6.

### Eligibility + content (pure functions, no stored state)

- Candidate tags: from T3610's summary endpoint per-tag duration sums (EPIC decision #13 -- do NOT reduce over the full reel list client-side), intersected with a curated display config (icon + "Top {Tag}" naming) for the initial set: Goal, Assist, Dribble. Config-extensible -- adding a tag is one entry.
- Per (tag, ratio): **exists** when matching published reels total >= 30s of stamped duration. Single-game and multi-game reels both count (tag theme transcends games) -- decided here, differs deliberately from Season Highlights (EPIC #11); note the difference in code comments via the comparison below.
- **Locked near-miss**: 15s <= total < 30s renders a locked row with progress ("Top Assists - 0:22 / 0:30 - almost!") using T3640's locked-card pattern. Below 15s: hidden (avoid a wall of empty locks).
- Ordering: T3630 comparator (rank, then quality). Content capped at ~2min (greedy-with-skip via T3640's shared budget function with a fixed 120s budget).
- Verbs: same CollectionHeader -- Play all (T3610 player), Share (T3620 pipeline with `{filter: {tags:[tag]}, ratio}`), Video slot (T3680).

### Season Highlights vs smart collections (what's shared vs different)

| Aspect | Season Highlights (T3640) | Smart (T3670) |
|---|---|---|
| Scope | current season | all-time |
| Filter | none | single tag |
| Budget | user slider (collection_settings) | fixed 120s |
| Multi-game reels | excluded | included |
| Eligibility | unlock gate (30s total published) | per-(tag,ratio) 30s matching |
| Components | CollectionHeader, budget fn, locked card, share pipeline | same -- reuse all four |

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/SmartCollectionsSection.jsx` - NEW
- `src/frontend/src/config/smartCollections.js` - NEW tag display config
- `src/backend/app/routers/collections.py` - per-tag sums already shaped in T3610's summary; membership = list endpoint with tag filter
- `src/frontend/src/hooks/useDownloads.js` - eligibility from summary fields; lazy member fetch on expand (same pattern as game groups)
- `src/frontend/src/components/collections/CollectionHeader.jsx` - reuse
- `src/backend/app/routers/shares.py` - resolver already evaluates tag filters if T3620 implemented filter support; otherwise extend evaluation to `filter.tags` here
- `src/backend/app/routers/downloads.py` - ensure tags arrive decoded in list payload

### Related Tasks
- Depends on: T3600 (tags column), T3610 (header/player/tab), T3620 (share pipeline + filter evaluation), T3630 (ordering), T3640 (budget function, locked-card pattern)
- Blocks: nothing (T3680 consumes any collection definition generically)

### Technical Notes
- Eligibility reads summary-endpoint per-tag sums (server-side GROUP BY; tags decoded once per row there). If T3620 deferred tag-filter evaluation in the share resolver, add it here.
- Gated behind `pref.seasonHighlightsChoice === 'enabled'`? **No** -- smart collections render regardless (they don't require ranking); only the ordering improves with rank. Locked Season card and smart sections coexist for declined users.
- Tags display: tag strings come from the sport tag registry; display names should pass through existing tag-label helpers if present (check `tagRegistry.js` from T1620).

## Implementation

### Steps
1. [ ] Tag display config + eligibility from summary sums (unit-tested: thresholds 14s/15s/29s/30s, per-ratio independence)
2. [ ] SmartCollectionsSection with locked-progress rows
3. [ ] Share verb wiring with tag-filter definitions (+ resolver filter evaluation if not done in T3620)
4. [ ] Vitest: selectors; E2E: publish tagged reels past 30s -> section appears -> share link plays
5. [ ] Verify quest `copied_collection_link` records from smart headers too (T3660 step)

### Progress Log

## Acceptance Criteria

- [ ] Tags with >= 30s in a ratio show an unlocked collection; 15-30s show locked progress; < 15s hidden
- [ ] Membership ordered by rank comparator, capped at 120s greedy-with-skip
- [ ] Share links evaluate live with tag filter (new tagged publish appears on next visit)
- [ ] Works for declined-opt-in users (no ranking dependency)
- [ ] Tests pass
