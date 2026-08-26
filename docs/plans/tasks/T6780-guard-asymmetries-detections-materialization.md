# T6780: Guard-asymmetry follow-up — `working_videos.detections_data` write + games materialization writes

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

T6550's sibling-asymmetry sweep (`.claude/knowledge/backend-services.md` § "Write-side sibling guard
(T6550, poster_marker_time v032)") checked every guarded READ that has a matching WRITE path.
Everything on `projects`/`intro_cards`/`downloads`/`clips` was already symmetric (503-guarded both
sides). Two asymmetries remain, on render/materialize paths rather than a simple gesture-write, which
is why T6550 filed them here instead of fixing them inline — each needs its own design call, not a
trivial mirror of the `column_exists` → 503 pattern.

**(A) `working_videos.detections_data` (profile_db v027).** The READ is guarded (GET overlay-data);
the WRITE (`upsert_working_video`, INSERT+UPDATE) is not. Unlike `poster_marker_time` (a single
user-gesture surgical write), `upsert_working_video` is on the render/finalize path — a bare 503
there may not be the right shape (a render job failing outright vs. a UI drag failing gracefully are
different UX). First confirm the working-video render path is actually REACHABLE against a
below-v027 profile in the deploy window (T6550's sweep didn't establish that, only that the write
isn't guarded) — if unreachable, this may resolve to "no guard needed, window already closed for
this path" rather than a code change, per CLAUDE.md's rule against guarding provably-impossible
states.

**(B) `games.shared_by` (v026) + `source_profile_id`/`source_game_id` (v030).** The READS are
guarded (`_read_games_for_list`, per `backend-services.md`'s T5970 audit and the T5800 game-reference
primitive work). The WRITE is `materialization.py`'s `copy-game` INSERT, which can target a
**recipient** profile DB that's below head (e.g. sharing a game into a profile that hasn't been
migrated yet) — a different shape of asymmetry than (A), since the writer and the below-head DB may
belong to different users/profiles, not the same gesture-originating session.

## Solution

Not prescribed — each asymmetry needs its own investigation before a fix shape is chosen (T6550's
kickoff explicitly deferred these rather than guessing). At minimum:
1. Confirm reachability of each write path against a below-head DB in the real deploy window (don't
   guard an impossible state).
2. For each reachable case, decide the guarded-write outcome (mirror T6550's 503 convention if it
   fits a single-gesture write; a render/materialize path may need a different shape — explicit
   deferred-job state, a loud log + skip, etc. — decide and document like T6550 did).
3. Extend `test_t6030_migration_window_structural_guard.py`'s `POST_V023_COLUMNS` coverage if new
   guard code is added, per the structural test's existing auto-extension contract.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/*` — wherever `upsert_working_video` lives (grep for it; T6550's sweep
  didn't record the exact file path, confirm at investigation time).
- `src/backend/app/services/materialization.py` — `copy-game` INSERT (games.shared_by,
  source_profile_id, source_game_id).
- `.claude/knowledge/backend-services.md` § "Write-side sibling guard (T6550...)" and § "Migration-
  window column guard audit (T5970)" — both asymmetries are described there with the exact column
  versions; read before re-deriving.
- `src/backend/tests/test_t6030_migration_window_structural_guard.py` — the structural guard test
  and its `POST_V023_COLUMNS` map, if new guard code needs coverage.
- `docs/plans/tasks/profile-game-attribution/T5800-game-reference-primitive.md` — owns the v030
  columns referenced in asymmetry (B); read for context on why source_profile_id/source_game_id
  exist before touching their guard.

### Related Tasks
- Follows: T6550 (poster-marker write guard) — this task is its filed sweep follow-up, not a
  standalone discovery.

## Implementation

### Steps
1. [ ] Investigate (A): confirm reachability against a below-v027 profile; if reachable, design +
       implement the guarded-write outcome; if not, document why in the knowledge doc and close.
2. [ ] Investigate (B): confirm reachability of a copy-game INSERT against a below-v026/v030
       recipient profile; if reachable, design + implement; if not, document and close.
3. [ ] Extend structural guard test coverage for whatever guard code is added.
4. [ ] Update `.claude/knowledge/backend-services.md` with the outcome (guarded, or provably
       unreachable) for both.

### Progress Log

## Acceptance Criteria
- [ ] Both asymmetries have a documented resolution (guarded, or confirmed unreachable — not left
      open).
- [ ] Any new guard code follows the sanctioned pattern (`column_exists`, explicit non-silent
      outcome) and is covered by the structural guard test.
- [ ] Knowledge doc reflects the final state.
