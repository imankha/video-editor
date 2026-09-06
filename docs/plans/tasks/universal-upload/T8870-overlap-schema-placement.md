# T8870: Overlap schema: recorded_at + offset_seconds

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-06

## Problem

Overlapping footage needs every video of a game to carry a position on the game's
real-time axis. Today `game_videos` only has `sequence` (play order for concatenation);
there is no recorded-time or offset column anywhere, and the frontend never sends the
embedded creation time it can already read (T8800).

## Solution

Two new nullable columns on `game_videos` + a profile_db migration, threaded through
create/attach/load. Backend + data only - no timeline math (T8880) and no UI (T8890).
See [EPIC.md](EPIC.md) decision 7.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` - `game_videos` DDL in `ensure_database()` (~L1556-1570)
- `src/backend/app/migrations/profile_db/vNNN_game_video_placement.py` - NEW migration
- `src/backend/app/routers/games.py` - `create_game` (~L292), `add_game_videos` (~L493),
  `_insert_game_videos` (~L224-265), `_get_game_videos_response` (~L268-289),
  `load` (~L3134)
- `src/backend/app/services/collection_metadata.py` - `compute_unified_clip_start`
  (~L249-281) gains the offset-aware branch
- `src/frontend/src/services/uploadManager.js` - send `recorded_at` per video
- `src/frontend/src/components/GameFootagePicker.jsx` - include each item's creationTime
  in `onFootageChange`

### Related Tasks
- Depends on: T8800 (frontend now HAS creationTime per file), T8810 (uniform payload)
- Blocks: T8880, T8890, T8900, T8910
- Include the Migration agent (schema change). Also verify `_SCHEMA_DDL` in `pg.py` is
  NOT involved - game_videos is profile-db only; do not touch postgres.

### Technical Notes
- Columns (exact):
  - `recorded_at TEXT NULL` - ISO-8601 UTC (e.g. `2026-07-18T18:44:59Z`). Evidence only;
    never recomputed after insert, never user-edited.
  - `offset_seconds REAL NULL` - seconds from the game's time zero (time zero = offset 0
    = the earliest video). Canonical placement. Written at insert; afterwards ONLY the
    Fix-timing gesture (T8900) may update it.
- Offset computation at insert (helper `compute_video_offsets(videos)` in games.py,
  unit-tested):
  - All inserted videos carry recorded_at -> zero = min(recorded_at) across the game's
    videos INCLUDING existing rows; each offset = its recorded_at - zero. If any existing
    row has recorded_at and a SMALLER value than the batch's min, zero stays the existing
    one. If the new batch's min is EARLIER than the current zero, do NOT renumber existing
    rows (their offsets stay relative to the old zero); allow negative offset_seconds for
    the new row instead. Negative offsets are legal and mean "starts before the current
    backbone start" - T8880 handles rendering them.
  - Missing recorded_at -> offset = prefix-sum of durations by sequence (exactly the
    virtual position today's concatenation gives it: sum of durations of rows with lower
    sequence). This is also the sanity fallback when recorded_at exists but is >
    `PLACEMENT_WINDOW_H = 12` hours away from zero (garbage clock) - in that case store
    recorded_at anyway (evidence) but compute offset by prefix-sum and log a warning.
- MIGRATION vNNN (check the next free profile_db version at implementation time - v050
  was the latest MERGED as of 2026-09-05, and unmerged sibling branches may claim numbers;
  see the migration-version-collision memory): `ALTER TABLE game_videos ADD COLUMN` both
  columns, then backfill `offset_seconds` for every existing row via the prefix-sum rule
  (preserves current behavior EXACTLY - a migrated game renders identically). Migration
  gets tuple rows (runner row-factory note in reference docs). Bump `PRAGMA user_version`
  per the runner convention. Remember the window-tolerance guard for new-column hot paths
  (T5630 memory): readers must tolerate the column being absent until the JIT migration
  has run for that profile - use `SELECT *`-safe access or guard with a pragma check in
  any code path that can run before the seam migrates.
- API changes:
  - `create_game` + `add_game_videos` accept optional `recorded_at` per video entry
    (ISO string, validated: reject non-parseable with 422). Both call
    `compute_video_offsets`.
  - `_get_game_videos_response` + `load` include `recorded_at` and `offset_seconds` per
    video.
- `compute_unified_clip_start`: when the clip's source video row has a non-null
  offset_seconds, unified start = `offset_seconds + clip.start_time`; else keep the
  existing prefix-sum-by-sequence math byte-identical. (Backfilled rows have offsets equal
  to the prefix sums, so results do not change for existing data - assert this in a test.)
- Frontend: `uploadManager` passes each file's `creationTime` (from the picker payload)
  as `recorded_at` on create/attach calls. Send `null` when unknown - never a fabricated
  time.

## Implementation

### Steps
1. [ ] Add columns to the `ensure_database()` DDL; write migration vNNN with backfill;
   registry entry per `migrations/profile_db/__init__.py` convention.
2. [ ] Implement + unit-test `compute_video_offsets` (cases: full timestamps, none,
   mixed, garbage clock outside 12h window, later batch earlier than zero -> negative).
3. [ ] Accept/validate `recorded_at` in `create_game` and `add_game_videos`; wire both
   through the helper; extend responses.
4. [ ] Update `compute_unified_clip_start` with the offset branch + equivalence test
   (migrated fixture: old math == new math for sequence-only games).
5. [ ] Frontend: thread creationTime -> `recorded_at` in create + attach payloads.
6. [ ] Backend tests (curated set): insert 4 videos with the DJI fixture times -> offsets
   0 / 1411 / 2955 / 4368 (within float tolerance; from the EPIC evidence table);
   migration backfill on a pre-existing 2-video game -> offsets 0 / duration1; hardcoded
   migration-head fragility rule: derive expected head from the registry, never a literal.

### Progress Log

**2026-09-05**: Filed.

**2026-09-06**: Implemented by an automated worker (Reviewer approved, 81 backend + FE
tests green). Branch CI first came back red on a real regression: the `video_sequence <=
1` early-return in `compute_unified_clip_start` had moved after two new per-clip queries
(`column_exists` PRAGMA + `offset_seconds` SELECT), doubling query count for the common
single-video-game case (2 -> 4 statements/clip per
`test_recap_data_query_count_linear_slope_one_per_clip`). Fixed by collapsing everything
into one combined query (LEFT JOIN + correlated prefix-sum subquery) per clip. Supervisor
verified the red -> green transition directly against the real dev Postgres (not just the
worker's offline harness) before merging. Merged via PR #353 (merge commit be6b2d85).

## Acceptance Criteria

- [ ] Fresh DBs and migrated DBs have identical schema (DDL-equivalence test pattern)
- [ ] Existing games' offsets backfill to exact prefix sums; `compute_unified_clip_start`
      output unchanged for them
- [ ] DJI fixture times produce the offsets above; garbage timestamps fall back with a
      logged warning, never an exception
- [ ] `recorded_at` flows from a real browser upload into the DB (manual check, one game)
- [ ] Curated backend test set green
