# T3930: Ranking Card Game Minute — Apply 2nd-Half Offset

**Status:** DONE
**Impact:** 4
**Complexity:** 2
**Created:** 2026-06-24
**Updated:** 2026-06-24

## Problem

The pairwise ranking card ([ReelMatchCard.jsx](../../../src/frontend/src/components/ranking/ReelMatchCard.jsx)) shows a clip's in-match minute (`33'`) computed by [rank.py `_minute()`](../../../src/backend/app/routers/rank.py#L165-L169) directly from `final_videos.clip_start_time`. That column is **file-relative**: a clip 5 minutes into the second half is stored as `start_time≈300, video_sequence=2`, so the card shows `6'` instead of the correct `~50'`. No first-half offset is applied.

This was discovered during T3920 (Reel Draft cards), which fixed the same bug on the DownloadsPanel card by introducing a frozen, offset-corrected column.

## Solution

T3920 added **`final_videos.clip_game_start_time`** — the unified two-half in-match start (file-relative `clip_start_time` + sum of prior-half `game_videos` durations), frozen at export and backfilled by migration v016 for all existing reels. It is computed by `compute_unified_clip_start()` in [collection_metadata.py](../../../src/backend/app/services/collection_metadata.py).

Switch the ranking pool query + `_minute()` to read `clip_game_start_time` instead of `clip_start_time`:
- [rank.py `_rankable_pool()`](../../../src/backend/app/routers/rank.py#L104-L118) SELECT: add/swap to `fv.clip_game_start_time`.
- [rank.py `_side()` / `_minute()`](../../../src/backend/app/routers/rank.py#L165-L183): feed `clip_game_start_time`.

Keep `_minute()`'s `floor(sec/60)+1` "Nth minute" convention (the ranking card shows minute only, no seconds) — only the *input seconds* change from file-relative to unified.

## Acceptance Criteria

- [ ] Ranking card shows the correct game minute for 2nd-half clips (unified, not file-relative)
- [ ] First-half / single-video clips unchanged
- [ ] Reuses the frozen `clip_game_start_time` column from T3920 (no new derivation)
- [ ] Tests cover a 2nd-half clip's minute

## Context

### Dependency
- **Depends on T3920**: `final_videos.clip_game_start_time` column, `compute_unified_clip_start()` helper, and migration v016 backfill. All already landed.

### Related Files
- `src/backend/app/routers/rank.py` — `_rankable_pool`, `_side`, `_minute`
- `src/frontend/src/components/ranking/ReelMatchCard.jsx` — renders `side.minute` (no frontend change expected; it just receives a corrected value)

### Technical Notes
- Display-only; no new persisted field (the column already exists).
- This is a small, surgical swap — the hard part (the unified-time derivation + backfill) was done in T3920.
