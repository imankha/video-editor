# T3605: Freeze game_ids on final_videos (Collections prerequisite)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-06-12
**Epic:** [Season Highlights & Collections](EPIC.md) — prerequisite, slots between T3600 and T3610

## Problem

T3600 froze `duration`/`aspect_ratio`/`tags` onto `final_videos` because publish
archives + deletes working data. It did **not** freeze the game association. Custom-project
reels resolve their games live via `working_clips -> raw_clips -> games`
([downloads.py:305-344](../../../../src/backend/app/routers/downloads.py)); for **published**
reels those `working_clips` are gone (`archive_project` deletes them,
[project_archive.py:122-124](../../../../src/backend/app/services/project_archive.py)), so
live resolution returns `[]` and the reel falls back to a "Month Year" group.

T3610 groups reels by game. Without frozen game ids, every already-published custom reel
would land in "Mixes & compilations" even when it belongs to a single game. This task
freezes the game association so Collections (and every downstream epic task) reads one
canonical, correct column — no live resolution, no fallback.

## Solution

Mirror T3600 exactly: add a frozen `final_videos.game_ids` **msgpack BLOB** (sorted distinct
game ids), stamp it at every export-finalize site, and backfill existing rows via a v008
profile_db migration that reads R2 archives for reels whose working data is gone.

**Why the backfill recovers archived reels:** `archive_project` serializes all `working_clips`
(incl. `raw_clip_id`) to `archive/{project_id}.msgpack` and `raw_clips` survive archival, so
`archived working_clips.raw_clip_id -> live raw_clips.game_id` reconstructs the distinct game
list. This is the same recovery path v007 used for tags.

After this ships + migrates on prod, the resolution is: **read `game_ids` only.** No
working-clips join, no fallback, no `unknown` handling (EPIC: no legacy data — we migrate
everything). T3610's summary endpoint consumes the frozen column directly.

### Encoding (msgpack on disk — user preference)

`game_ids` = `encode_data(sorted(distinct game ids))` (msgpack BLOB, same convention as
`tags`/`rating_counts`). `len == 1` -> game collection; `len > 1` -> mixes; NULL/empty ->
game-less (mixes). Decode via `utils/encoding.decode_data`.

## Schema change

`final_videos` gains one column:

| Column | Type | Source at stamp time | Backfill source |
|--------|------|----------------------|-----------------|
| `game_ids` | BLOB (msgpack `list[int]`) | distinct `game_id` of the reel's clips | `game_id` direct, else live working_clips, else R2 archive |

Routing (mirrors the live `elif` chain in [downloads.py:380-404](../../../../src/backend/app/routers/downloads.py), game_id wins, no fall-through):

| Row shape | game_ids |
|-----------|----------|
| `final_videos.game_id` set (brilliant_clip via auto_export, annotated_game) | `[game_id]` |
| `game_id` NULL, `project_id` set, working_clips live | distinct `raw_clips.game_id` via project's latest working_clips |
| `game_id` NULL, `project_id` set, project archived | distinct `game_id` via archived working_clips' `raw_clip_id` -> live `raw_clips` |
| nothing resolves | NULL (genuinely game-less; renders under mixes) |

## Implementation

### Files

- `src/backend/app/services/collection_metadata.py` — add `compute_project_game_ids`,
  `compute_archive_game_ids`, `_game_ids_blob` helpers (siblings of the existing tag helpers;
  stamping + backfill share them so they can't drift).
- `src/backend/app/routers/export/overlay.py` — stamp `game_ids` at `_finalize_overlay_export`
  (~93-98) and `export_final` (~1144-1149).
- `src/backend/app/services/auto_export.py` — stamp `game_ids = [game_id]` at
  `_export_brilliant_clip` INSERT (~208-215).
- `src/backend/app/database.py` — add `game_ids BLOB` to `final_videos` CREATE TABLE (~664-682)
  + ALTER shim (mirror the T3600 shim at ~684-693, so existing DBs have the column at deploy
  before `POST /api/admin/migrate` runs).
- `src/backend/app/migrations/profile_db/v008_freeze_game_ids.py` — NEW, mirrors v007.
- `src/backend/app/migrations/profile_db/__init__.py` — register `V008FreezeGameIds`.

### Scope guard

This task is **additive only**. It does NOT change how `GET /api/downloads` resolves games
today (still live) — T3610 switches the read path to the frozen column. Current UI behavior is
unchanged; only a new column + its data are added.

### Steps
1. [ ] `collection_metadata.py`: game_ids helpers
2. [ ] Stamp at all three export sites
3. [ ] `database.py`: column + shim
4. [ ] v008 migration + register
5. [ ] `from app.main import app` import check
6. [ ] Backend tests: stamp (custom single/multi-game, brilliant_clip), backfill (live, archive recovery, game_id-direct, idempotency)

### Deploy (collaborative — user hits migrate)
1. [ ] Merge to master -> staging auto-deploys
2. [ ] `POST /api/admin/migrate` on staging -> verify game_ids populated
3. [ ] Deploy prod -> `POST /api/admin/migrate` on prod -> verify

## Tests

`src/backend/tests/test_freeze_game_ids.py` (reuse `full_schema_db` + seed helpers from
`test_collection_metadata.py`):
- Custom project, clips from one game -> `game_ids == [g]`.
- Custom project, clips from two games -> `game_ids == [g1, g2]` (sorted).
- Brilliant clip (auto_export path) -> `game_ids == [game_id]`.
- Backfill, working_clips live -> resolves to game.
- Backfill, working_clips deleted + archive present (simulate `archive_project`) -> recovers
  game ids from archive. **This is the load-bearing case.**
- Backfill, `final_videos.game_id` set -> `[game_id]` without touching working data.
- Idempotency: re-run backfill, no change to already-set rows.
- Genuinely unresolvable -> stays NULL (no crash, one log line).

## Acceptance Criteria
- [ ] `final_videos.game_ids` stamped at all export-finalize sites
- [ ] v008 backfills existing rows incl. archived-reel recovery from R2
- [ ] Canonical schema + shim updated; `from app.main import app` clean
- [ ] All freeze tests pass
- [ ] Migrated on staging + prod; spot-check shows published custom reels carry their game ids
- [ ] No change to current `GET /api/downloads` behavior (additive only)
