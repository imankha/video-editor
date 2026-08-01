# T5810: Move-reels carries game attribution

**Status:** STAGING — merged to master 2026-08-01 (auto-deploys staging); run POST /api/admin/migrate after deploy
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-31
**Epic:** [Cross-Profile Game Attribution](EPIC.md) — task 2 of 4. Read EPIC.md for design decisions.

## Problem

`move_reels_to_profile` (`downloads.py:1031`, T4850) nulls `game_ids`/`game_id` in
`_build_moved_reel_row` (`downloads.py:987-1011`) because the target profile can't resolve
source-profile game ids — so every moved reel routes to Mixes in the target Gallery. This is
the direct cause of bug 37p.

## Solution

In the move flow, before inserting target `final_videos` rows:

1. For each distinct game id across the moved reels' `game_ids` blobs (decode msgpack; also the
   legacy scalar `game_id` when set), load the source profile's `games` + `game_videos` rows and
   call **T5800's `ensure_game_reference`** against the target DB. Build a
   `{source_game_id → target_game_id}` map. Chain collapse and moving-back-to-owner are handled
   inside the primitive (a reel moved back to the profile that owns the game maps to the real
   game; no reference is created).
2. `_build_moved_reel_row`: replace the null-outs — `game_ids` = remapped sorted-distinct list
   (re-encode msgpack), `game_id` = remapped scalar when it was set. `project_id` /
   `source_clip_id` stay NULL (editing lineage genuinely does not move).
3. **Orphan cleanup, gesture-driven only** (EPIC decision: never a reactive sweep):
   - Move phase 2 (source-side delete): after deleting source `final_videos` rows, delete any
     source-profile REFERENCE game (`source_profile_id IS NOT NULL`) that no remaining
     `final_videos.game_ids` in that DB references. (Only references — never real games.)
   - Reel delete (`downloads.py` delete endpoint / wherever published-reel delete lives):
     same cleanup for the profile the reel was deleted from.
4. Sync ordering unchanged (T4850 phases + invariant 6b): target DB written + explicitly synced
   FIRST (`sync_db_to_r2_explicit(user_id, target_profile_id)` — T5340 keys off the arg),
   source second under `durable_sync`. The new reference insert rides the existing phase-1
   target write; no new sync call sites.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/downloads.py` — `move_reels_to_profile`, `_build_moved_reel_row`, `_MOVED_REEL_CARRY_COLUMNS`, reel-delete endpoint (orphan cleanup)
- `src/backend/app/services/materialization.py` — call T5800's `ensure_game_reference` (no changes expected)
- `src/backend/app/utils/encoding.py` — msgpack encode/decode of `game_ids` (reference only)
- `src/backend/tests/` — extend the T4850 move tests

### Related Tasks
- Depends on: T5800 (`ensure_game_reference`, v030 columns)
- Blocks: T5830 (heal replays this remap logic for historical rows)
- Wire dependency: T4850's phase structure + T5340's arg-keyed `sync_db_to_r2_explicit`

### Technical Notes
- The gallery read path (`collections.py:route_collection` + summary) needs ZERO changes — that
  is the point of the design. Only single-clip reels group by game; multi-clip reels stay in
  Mixes regardless of `game_ids` (expected, matches source-profile behavior).
- Moved reels keep their tags, so smart collections (Top Plays etc.) behavior is unchanged —
  do not touch.
- The source `games` row can be missing (game deleted after publish — reels outlive games).
  Then no reference can be built for that id: drop that id from the remapped list, warn-log.
  This mirrors today's honest-unattributed behavior, not a silent fallback.

## Implementation

### Steps
1. [x] Remap logic + `_build_moved_reel_row` changes
2. [x] Orphan-reference cleanup in move phase 2 + reel delete
3. [x] Tests (see criteria)
4. [ ] Real-flow verification on staging: move 2 reels from one game into a kid profile, check
       Gallery grouping — **pending merge + deploy; this is the step that closes the unverified gap below**

### Progress Log

**2026-07-31 — implemented in container worker `t5800` (shared with T5800), pushed, CI green.**

Branch `feature/T5800-game-reference-attribution`, commit `4de9d65a`. Branch CI run 30650715376:
**green**. Merged into one worker with T5800 because of the hard dependency plus shared ownership of
`materialization.py`.

What landed:
- `move_reels_to_profile` resolves each moved reel's `game_ids` (msgpack, plus the legacy scalar
  `game_id`) through `ensure_game_reference` against the target DB and builds a
  `{source_game_id → target_game_id}` map.
- `_build_moved_reel_row` **remaps instead of nulling**. `project_id` / `source_clip_id` stay NULL
  by design (editing lineage genuinely does not move).
- Orphan cleanup is **gesture-driven only** — move phase 2 and reel delete. References only
  (`source_profile_id IS NOT NULL`); real games are never deleted by cleanup (test pins this).
- Missing source game → that id is dropped from the remapped list with a warn-log. Honest
  unattributed, not a silent fallback.
- **Zero `collections.py` changes**, as designed — the gallery read path was never the problem.

**Built ON the `a5ff3e48` durability fix, not around it.** The `require_fresh` target refresh +
`ProfileDBRefreshFailed` guard is intact (3 call sites verified present; the diff touches no
`require_fresh` line). No new sync call sites — the reference insert rides the existing phase-1
target write, preserving T4850's ordering and T5340's arg-keyed `sync_db_to_r2_explicit`.

**Perf guard added** (`test_t5810_perf_guard.py`, `query_counter` fixture) because per-reel
reference resolution is a natural N+1: the source game is resolved **once** for 6 same-game reels,
and there is **one** `profiles` read for 8 references.

**A pre-existing test was intentionally inverted.** `test_t4850_move_reels.py::
test_collection_attribution_cleared` asserted that moved reels route to Mixes — i.e. it *pinned bug
37p as correct behavior*. It is now `test_collection_attribution_carried` and asserts the remap plus
exactly one reference row. This is the intended behavior change, not a test weakened to pass; the
other 13 T4850 tests are unchanged and green.

Not verified: the live HTTP `POST /api/downloads/move-to-profile` over the network (no R2/auth stack
in the container). Every test drives the real handler functions end-to-end against real per-profile
SQLite DBs with R2 disabled, so the reference/remap/orphan/chain-collapse logic is exercised rather
than mocked. Step 4 above closes this on staging.

## Acceptance Criteria

- [ ] Move a single-clip published reel A→B: target Gallery groups it under the correct game
      header (same display name as in A); Games tab shows the reference card (T5820 renders it)
- [ ] Move a second reel from the SAME game A→B: still exactly one reference row in B (test)
- [ ] Move reels from one game into TWO different profiles: each gets its own reference (test)
- [ ] Move a reel back B→A: `game_ids` points at A's real game; no reference created in A;
      B's now-unreferenced reference row is deleted (test)
- [ ] Move B→C where B holds a reference: C's reference points at A (chain collapse, test)
- [ ] Deleting the last moved reel in B deletes B's orphaned reference; real games never
      deleted by cleanup (test)
- [ ] Source game missing → reel moves with that id dropped + warning, no crash (test)
- [ ] Existing T4850 move tests still green (media copy, all-or-nothing, durable sync ordering)
