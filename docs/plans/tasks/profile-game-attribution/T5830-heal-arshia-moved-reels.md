# T5830: Heal arshia's already-moved reels (restore game attribution)

**Status:** TODO — hard-blocked (see Progress Log); deliberately not started
**Impact:** 4
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-31
**Epic:** [Cross-Profile Game Attribution](EPIC.md) — task 4 of 4. Read EPIC.md for design decisions.

## Problem

The reporter (arshia.kalantari@gmail.com, prod) already moved reels into his kids' profiles
BEFORE T5810 — those `final_videos` rows have `game_ids = NULL` and the source rows were
deleted by the move's phase 2, so attribution cannot be auto-derived from live data. The
"Assign to game" gesture that would let users fix this manually was explicitly DEFERRED
(user decision); instead we heal his data directly (user: "we will want to write a migration
for arshia to heal his data").

## Solution

Reconstruct attribution by matching moved reels against the default profile's surviving
`games` + `raw_clips`, then write it via a versioned profile_db migration (precedent:
account/data-specific heals v012, v018, v019) or the edit-user-db script path — decide at
kickoff, defaulting to the **versioned migration** since the user asked for one, with the heal
gated on data shape (no-op for every other user).

**Matching (single-clip reels only** — multi-clip reels route to Mixes regardless, skip them):
moved reels retained `name`, `tags`, `created_at`, `clip_start_time`, `clip_game_start_time`,
`clip_count`, `filename`. In the default profile, `raw_clips.start_time` == the reel's
`clip_game_start_time` (same value frozen at publish) plus name/tag agreement identifies the
source clip → its `game_id` → the game. Require an UNAMBIGUOUS match (exactly one candidate);
ambiguous or unmatched reels are reported, never guessed (correct-data rule — no heuristic
that can attribute a reel to the wrong game).

**Write path per healed reel**: `ensure_game_reference` (T5800) into the kid profile +
set `game_ids` (msgpack single-id list) — i.e. exactly the state T5810 would have produced.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/profile_db/v0XX_heal_moved_reel_attribution.py` — NEW (version = head+1 at implementation time)
- `src/backend/app/services/materialization.py` — `ensure_game_reference` (read/call)
- `scripts/edit-user-db.py` playbook (memory: reference_changing_env_data) — for the dry-run phase
- `src/backend/tests/` — migration test with a reconstructed two-profile fixture

### Related Tasks
- Depends on: T5800 + T5810 deployed to prod (heal produces T5810-shaped state; T5820 renders it)
- Related history: memory `project_arshia_lost_reels_move_clobber` — 5 of his moved reels lost
  their `final_videos` rows entirely (T5340-era clobber; mp4s intact in R2). CHECK during
  dry-run whether those rows were ever restored; if not, that's a separate restoration
  (report findings, don't silently fold it in).

### Technical Notes
- **Dry-run first, on downloaded R2 copies** of his default + kids' profile DBs: print the
  proposed reel→game mapping table and get user sign-off BEFORE any write (data-safety rule:
  confirm exact scope).
- Migration `up(conn)` sees ONE profile DB with a tuple row factory; cross-profile matching
  needs the default profile's DB — open it via the materialization helpers
  (`ensure_profile_db_local`/`_open_profile_db` pattern) with profile ids resolved from
  `user_db.get_profiles`, NOT ContextVars.
- Prod execution order (memory: copy-to-live-env clobber + user-sqlite-local-authoritative):
  deploy → restart/stop machines as needed → run migration via admin endpoint → verify
  R2 versions bumped → check his gallery.
- His kid-profile ids from the T5310 repair notes: profiles `6ff007e6`/`22c7616a` were the
  REPAIRED pair — re-derive current ids from prod `user.sqlite` at dry-run time, do not trust
  stale ids.

## Implementation

### Steps
1. [ ] Download his profile DBs from prod R2; dry-run matcher; produce mapping table
2. [ ] User sign-off on the exact mapping (which reel → which game)
3. [ ] Write migration (gated: only acts on rows matching the signed-off shape) + fixture test
4. [ ] Deploy, run migration on prod, verify in his account's gallery + Games tab
5. [ ] Report to the user; user tells arshia / resolves bug 37p

### Progress Log

**2026-07-31 — NOT STARTED, deliberately.** No worker was spawned for this task during the
`/dotask` wave that implemented T5800/T5810/T5820. Two gates must clear first, and neither is
AI-clearable:

1. **T5800 + T5810 must be merged AND deployed to prod.** The heal writes T5810-shaped state via
   `ensure_game_reference`, so the primitive and the v030 columns have to exist on prod first. As of
   today they are on a pushed, CI-green branch awaiting the user's merge.
2. **Dry-run mapping table + explicit user sign-off before any write** (data-safety rule: confirm
   the exact scope of a data change). The matcher runs against *downloaded copies* of his prod R2
   profile DBs and prints the proposed reel→game mapping; nothing is written until the user approves
   that exact table. Ambiguous or unmatched reels get reported, never guessed.

**Version number moved: use v031, not v030.** T5800 claimed v030 (`v030_games_source_reference.py`).
This task's migration is head+1 at implementation time — re-check the head then rather than trusting
this line.

**Still to re-derive at dry-run time:** his kid-profile ids. The T5310-era ids `6ff007e6`/`22c7616a`
are stale — pull current ids from prod `user.sqlite`, do not trust the numbers in Technical Notes.

**Open question this task must still answer:** whether the 5 clobber-lost `final_videos` rows were
restored. Per memory `project_arshia_lost_reels_move_clobber` they were re-inserted from
authoritative source data, so this check will likely close cleanly — but it must be confirmed
during the dry-run and reported, not assumed.

## Acceptance Criteria

- [ ] Dry-run mapping table reviewed and approved by user before any write
- [ ] Every unambiguously-matched single-clip moved reel groups under its game in the kid
      profiles' galleries on prod
- [ ] Unmatched/ambiguous reels listed in the final report (left untouched)
- [ ] No other user's data modified (migration no-ops elsewhere — test proves it)
- [ ] Status of the 5 clobber-lost reels (final_videos rows) reported
