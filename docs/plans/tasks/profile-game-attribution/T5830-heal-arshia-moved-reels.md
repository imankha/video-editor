# T5830: Heal arshia's already-moved reels (restore game attribution)

**Status:** WIP — dry run done + user sign-off obtained 2026-08-02; migration v033 in a container worker
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
1. [x] Download his profile DBs from prod R2; dry-run matcher; produce mapping table
2. [x] User sign-off on the exact mapping (which reel → which game) — approved 2026-08-02, all 14
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

**2026-08-02 — dry run complete, user signed off, migration in progress.**

Prod deploy + migrations landed (15/15 profiles at schema 31; his DBs read at v32), clearing gate 1.
Gate 2 (dry run + sign-off before any write) is now also cleared. **Nothing has been written to his
data yet.**

Matcher run READ-ONLY against downloaded copies of his 5 prod profile DBs. Key =
`final_videos.clip_game_start_time` == default-profile `raw_clips.start_time`, compared at full
float precision (~15 significant digits).

**Result: 14 matched · 0 ambiguous · 7 unmatched → 6 reference rows.**

| Target profile | Source game (in `b95eb93b`) | Reels |
|---|---|---|
| Maddie U13 `b0a81fe1` | 1 Swallows Cup: Vs Culver City CCFC | 1, 2, 3, 4 |
| Maddie U13 | 7 Pats Cup: Vs DPL vs Legends FC Black | 6 |
| Maddie U13 | 8 Pats Cup: Vs DPL vs City SC GA Aspire | 7 |
| Ella U13 `6ff007e6` | 1 Swallows Cup: Vs Culver City CCFC | 1 |
| Ella U13 | 5 Pats Cup: Vs DPL vs Beach RL Behind Goal | 5, 7, 9, 11 |
| Ella U13 | 6 Pats Cup: Vs DPL vs Beach RL Trace | 3, 4, 10 |

Zero ambiguity: no `start_time` collided anywhere across the default profile's 87 raw clips, so no
reel could be attributed to the wrong game.

**The 7 unmatched stay untouched permanently** — 6 have no surviving source clip (deleted after
publish), 1 has a NULL `clip_game_start_time`. Guessing them is forbidden by the correct-data rule.

**Two matches flagged and accepted by the user**: Maddie reel 1 and Ella reel 1 differ from their
clip by exactly one tag (Goal vs Assist). Read as post-publish re-tagging, not a mismatch — the
start_times are exact and Maddie's reel name is character-identical to its clip name.

**Open question from the task file — CLOSED.** The 5 clobber-lost `final_videos` rows were restored:
all 21 reel rows across the two kid profiles have their mp4 present in prod R2 (0 missing). No
separate restoration is needed.

**Migration is v033**, not v031 as previously noted — head moved to v032
(`add_poster_marker_fields`) while this task sat blocked.
