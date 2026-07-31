# T5800: Game-reference primitive + schema (profile_db v030)

**Status:** WAITING ON USER — branch pushed, Branch CI green; waiting on user to fetch/test/merge
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-31
**Epic:** [Cross-Profile Game Attribution](EPIC.md) — task 1 of 4. Read EPIC.md for design decisions.

## Problem

To keep game grouping on moved reels (bug 37p), the target profile needs a `games` row to
resolve `final_videos.game_ids` against. No primitive exists to create a metadata-only,
non-owning copy of a game in a sibling profile: the only cross-profile game copier is the
share materializer (`materialization.py:_copy_game`), which creates a REAL game (participates
in Games tab actions, storage refs via `_create_storage_refs`, clip copying).

## Solution

1. **Schema (profile_db migration v030)** — two nullable columns on `games`:

   | Column | Type | Meaning |
   |--------|------|---------|
   | `source_profile_id` | TEXT NULL | Owning profile's id (8-hex). NOT NULL ⇒ this row is a reference. |
   | `source_game_id` | INTEGER NULL | The game's id inside the owning profile's DB. |

   No `is_reference` boolean — referenceness is derived from `source_profile_id IS NOT NULL`
   (no-redundant-state rule). Update `_SCHEMA` in `database.py:ensure_database()` (games DDL
   ~L719-743) AND write `v030_games_source_reference.py`. Existing rows: both NULL (real games).

2. **Primitive** — `ensure_game_reference(target_conn, target_profile_id, source_profile_id, source_game_row, source_game_videos) -> int`
   in `src/backend/app/services/materialization.py` (same module as `_copy_game`; extract shared
   insert logic rather than duplicating it — this is the 2nd copier, don't build a 3rd later).

   Resolution order (returns an existing game id when possible, else inserts):
   1. Row with matching `(source_profile_id, source_game_id)` → reuse (dedup across repeat moves).
   2. **Reference-chain collapse**: if the source game row is ITSELF a reference, resolve
      through ITS `source_profile_id`/`source_game_id` first — references never point at
      references (EPIC decision 6).
   3. Real game with matching video hashes (`_find_existing_game_by_hashes` pattern) → reuse
      the real game (e.g. the same game was share-materialized into this profile earlier).
   4. Else insert a reference row.

   Column mapping for an inserted reference (from the source `games` row):

   | Copied verbatim | Set explicitly | 
   |---|---|
   | `name, opponent_name, game_date, game_type, tournament_name, blake3_hash, video_duration, video_width, video_height, video_size, video_fps, created_at` | `video_filename=NULL`, `status='ready'`, `source_profile_id=<owner>`, `source_game_id=<owner's id>`, `shared_by=NULL`, `recap_video_url=NULL`, `viewed_duration=0`, `last_playhead_position=NULL`, `auto_export_status=NULL`, `auto_export_attempts=0` |

   Also copy the source's `game_videos` rows (`blake3_hash, sequence, duration, video_width,
   video_height, video_size, fps`) — needed for hash dedup and effective-duration display in
   `list_games`. Do NOT touch `game_storage`, Postgres `game_storage_refs`, or
   `game_ref_counts` (EPIC decision 4).

3. **`list_games` exposes references** (`games.py:_list_games_impl` ~L872-903): include
   reference rows in the response with `is_reference: true`, `source_profile_id`, and the
   source profile's display name (from `user_db.get_profiles`). Skip storage-expiry
   computation for references (they have no `game_storage` row and must not show expiry
   chips). Athlete stats will naturally be zero (no local `raw_clips`).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — games DDL in `ensure_database()` (add 2 columns)
- `src/backend/app/migrations/profile_db/v030_games_source_reference.py` — NEW (Migration agent; tuple row-factory gotcha)
- `src/backend/app/services/materialization.py` — `ensure_game_reference` + extraction from `_copy_game`
- `src/backend/app/routers/games.py` — `_list_games_impl` response fields
- `src/backend/tests/` — new test file (see below)

### Related Tasks
- Blocks: T5810 (move flow calls the primitive), T5820 (UI consumes `is_reference`), T5830 (heal uses it)
- Reuses: share-materialization copier (`_copy_game`, T2830-era)

### Technical Notes
- **New-column hot-path window** (memory: feedback_new_column_hotpath_migration_window): if the
  new columns land on a SELECT that runs before the migration does, un-migrated DBs break. Keep
  reads window-tolerant (PRAGMA column check like T5630's `_has_stage_columns`) OR ensure the
  only readers ship in the same deploy as the migration and the migration is run immediately
  post-deploy. State the choice in the PR.
- Migration `up(conn)` gets a TUPLE row factory — index positionally (memory:
  reference_migration_runner_rowfactory).
- The primitive takes an already-open target connection — callers (move flow, heal) own
  cross-profile DB opening and R2 sync ordering.

## Implementation

### Steps
1. [x] Add columns to `ensure_database()` DDL + write v030 migration
2. [x] Extract shared game-insert from `_copy_game`; add `ensure_game_reference` with the 4-step resolution order
3. [x] `list_games` reference fields + expiry skip
4. [x] Backend tests
5. [ ] Migration run on staging after deploy (admin endpoint) — **pending merge + deploy**

### Progress Log

**2026-07-31 — implemented in container worker `t5800`, pushed, CI green.**

Branch `feature/T5800-game-reference-attribution`, commit `1206dfcc` (T5810's `4de9d65a` rides the
same branch). Branch CI run 30650715376: **green**. 14 files, +1178/−63 across both commits.

What landed:
- `games.source_profile_id` / `source_game_id` in `ensure_database()` DDL (fresh DBs) +
  `migrations/profile_db/v030_games_source_reference.py`. No `is_reference` boolean — derived.
- `ensure_game_reference` in `materialization.py`. The shared game-insert was **extracted out of
  `_copy_game`** rather than duplicated (2nd copier, per the task's own instruction). `_copy_game`
  behavior proven unchanged by the 46-test share-materialization suite.
- 4-step resolution implemented and each step separately tested: existing `(source_profile_id,
  source_game_id)` pair → chain collapse → hash dedup against a real local game → insert.
- `list_games` emits `is_reference`, `source_profile_id`, `source_profile_name`; expiry computation
  skipped for references (`storage_status`/`storage_expires_at` None, `can_extend` False).
- `game_storage` / `game_storage_refs` / `game_ref_counts` never touched (test pins this).

**Hot-path window decision: PRAGMA `column_exists` guard** (not same-deploy). This was the right
call and it mattered — the new columns land on `_read_games_for_list`, which backs
`list_games_metadata`, which runs on **`/api/bootstrap` on every app load**. Migrations run manually
post-deploy, so naming the columns unconditionally would have 500'd every bootstrap in the
deploy→migrate window (T5970/T6030 class). The guard projects `NULL AS source_profile_id/
source_game_id` on a pre-v030 DB, which is *correct* rather than a fallback: nothing can create a
reference before v030 exists. The T6030 structural window guard was extended to v030 so the alarm
stays live. **Still run `POST /api/admin/migrate` promptly after deploy.**

Tests: 309 green across affected modules, exit 0. No new known-failures.

Not verified: live HTTP round-trip (the container has no R2/auth stack). Tests drive the real
handler functions against real per-profile SQLite DBs, so logic is exercised rather than mocked —
but the network path is unproven until staging.

## Acceptance Criteria

- [ ] v030 migrates an existing profile DB; real games keep NULL source columns
- [ ] `ensure_game_reference` is idempotent on `(source_profile_id, source_game_id)` (called twice → one row)
- [ ] Chain collapse: referencing a reference resolves to the original owner (test)
- [ ] Hash-dedup: a share-materialized real copy of the same game is reused, no reference inserted (test)
- [ ] `GET /api/games` marks references and never emits expiry state for them (test)
- [ ] Backend test evidence (actual output) attached
