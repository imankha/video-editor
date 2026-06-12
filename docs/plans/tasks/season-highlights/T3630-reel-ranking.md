# T3630: Reel Ranking Model + Insertion UX

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-06-12

## Problem

The curation paradigm needs the user's quality judgment over published reels, but nobody will sort a 40-row list. We need a rank signal that is (a) cheap to express -- one decision at publish time, (b) global per profile so every collection consumes it, (c) functional at zero effort via quality-score fallback ordering.

## Solution

Sparse fractional rank on final_videos + insertion-at-publish UX. See [EPIC.md](EPIC.md) decisions #3 and #5.

### Schema (profile_db v008)

| Change | Detail |
|---|---|
| `final_videos.season_rank REAL NULL` | sparse fractional index; insert between 3.0 and 4.0 -> 3.5; never rewrites other rows. NULL = unranked (legitimate state, ordered by frozen quality score) |
| `collection_settings (key TEXT PRIMARY KEY, value TEXT)` | NEW table; per-profile knobs. T3640 stores `season_target_duration` here. Created in this migration so v008 is the epic's last profile_db migration |

No backfill -- existing reels start unranked by design. Update `ensure_database()` schema in the same PR.

### Surgical endpoint

`POST /api/downloads/{final_video_id}/rank` body `{rank: 3.5}` (or `{rank: null}` to unrank). Copy the `rename_download` pattern exactly ([downloads.py:770-786](../../../../src/backend/app/routers/downloads.py)): single parameterized UPDATE, `published_at IS NOT NULL` precondition in WHERE, 404 on rowcount 0. Middleware handles R2 sync.

### Ordering helper (single source of truth)

One shared comparator -- backend (SQL ORDER BY fragment) and frontend (JS selector) implementing: `season_rank ASC NULLS LAST, quality_score DESC, created_at DESC` where quality_score derives from frozen `rating_counts`. T3620's resolver and T3610's groups adopt it here (add `season_rank` to their ORDER BY).

### Insertion UX (only when `pref.seasonHighlightsChoice === 'enabled'`; T3640 ships the flag -- build behind it, coordinate so the paradigm release flips both)

1. **Single publish**: after `publishProject()` success ([ProjectManager.jsx:1762-1799](../../../../src/frontend/src/components/ProjectManager.jsx)), before gallery navigation, show insertion prompt: new reel slotted at suggested position (quality-score comparator) with 1-2 neighbors visible, up/down nudges, "Looks right" confirm. **Suggested position is memory-only; only confirm/nudge POSTs the rank.** Dismiss = stays unranked.
2. **Batch guard**: >= 3 publishes in one session -> suppress per-reel prompts; offer one "Rank your N new reels" swipe-through (same prompt component iterated).
3. **Repair tool**: "Edit ranking" drag list (full reordering, drag gesture -> rank POST per drop) reachable from the Season Highlights header (T3640 wires the entry point; component lives here).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/profile_db/v008_season_rank.py` - NEW
- `src/backend/app/migrations/profile_db/__init__.py` - register
- `src/backend/app/database.py` - ensure_database schema (column + table)
- `src/backend/app/routers/downloads.py` - rank endpoint + ordering in list/resolver queries
- `src/frontend/src/components/collections/RankInsertionPrompt.jsx` - NEW (single + batch modes)
- `src/frontend/src/components/collections/RankEditList.jsx` - NEW drag list
- `src/frontend/src/components/ProjectManager.jsx` - publish-success hook
- `src/frontend/src/hooks/useDownloads.js` - ordering selector + optimistic rank update
- `src/frontend/src/components/SharedCollectionView.jsx` / shares resolver - adopt ordering (small)

### Related Tasks
- Depends on: T3600 (quality score from frozen rating_counts; duration display in prompt), T3610 (panel the rank list lives in)
- Blocks: T3640 (budget consumes rank order; settings table; unlock enables prompts), T3670 (smart collections order by rank)
- Coordinates with: T3640 on `pref.seasonHighlightsChoice` gating (T3640 owns the flag)

### Technical Notes
- Persistence rules: EPIC.md decision #5 is load-bearing -- a reactive write here recreates the T350 corruption class. Every POST traces to confirm/nudge/drag.
- Rank is season-scoped by construction (new season's reels arrive unranked); no season column needed.
- Fractional exhaustion (repeated insertion between adjacent ranks) is theoretical at user scale; if gaps < 1e-6, renumber lazily in the endpoint (documented, tested).
- Include **Migration agent** (schema change). Sequencing: implement after T3620 but the v008 migration can ship with T3640's release.

## Implementation

### Steps
1. [ ] v008 migration + schema update
2. [ ] Rank endpoint + backend ordering helper; adopt in downloads list + collection resolver
3. [ ] Frontend ordering selector + optimistic update
4. [ ] RankInsertionPrompt (single + batch) behind the opt-in flag
5. [ ] RankEditList drag repair tool
6. [ ] Publish-success hook with batch detection
7. [ ] Tests: endpoint (preconditions, null rank), comparator (rank/unranked interleave), Vitest prompt logic, E2E publish->confirm->order changes in Collections

### Progress Log

## Acceptance Criteria

- [ ] Confirming an insertion persists rank; reload preserves order
- [ ] Unranked reels order by quality score below ranked ones, everywhere (panel, share viewer)
- [ ] Batch publish (>= 3) shows one swipe-through, not N prompts
- [ ] Drag repair list reorders with surgical writes per drop
- [ ] No rank write occurs without a user gesture (code-reviewed against decision #5)
- [ ] Tests pass
