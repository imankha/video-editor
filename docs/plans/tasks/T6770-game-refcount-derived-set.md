# T6770: Replace `game_ref_counts.ref_count` with a derived ref-set

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

`game_ref_counts.ref_count` (Postgres) is a hand-maintained counter gating IRREVERSIBLE R2
game-video deletion. It has already drifted out of sync with the real per-profile `game_storage`
rows at least once and caused a live prod incident — see
[project_game_video_refcount_drift.md memory] and
`.claude/retrospectives/game-video-refcount-drift-incident.md` (root cause, fix, and the still-open
follow-up checklist item this task formalizes: *"Consider replacing the bare counter with a derived
ref-set table (one row per referencing profile) so `ref_count = COUNT(*)` can never drift — larger
change, follow-up task."*). The 2026-07-24 point-fixes (floor on decrement, live-ref recount before
delete, T5850's authoritative-recount hardening) make the counter SAFER but do not remove the class
of bug: it is still a counter that can independently disagree with reality, just with more guards
around reading it.

**New evidence, 2026-08-11:** during the derisk-plan full-sweep account repair (see
`docs/testing/derisk-plan-2026-08-11.md`), dev Postgres was found with **NO `game_ref_counts` row at
all** for the imankh account's games 2, 3, and 5, while their per-profile `game_storage` rows are
active. This is a different drift shape than the 2026-07-23 incident (negative counts) — here the
row is simply MISSING rather than wrong — but it's the same underlying class: the counter table and
the per-profile source of truth can independently diverge, and nothing currently guarantees they
stay reconciled outside of the sweep-time recount guard. A missing row presumably reads as
`ref_count` NULL/0 wherever it's queried outside the sweep's own recount path (e.g. admin
tooling, `/api/admin/migration-status`-adjacent views) — worth confirming as part of this task's
investigation, not assumed.

**New evidence, 2026-08-24 (prod, drop-off investigation):** the sibling table
`game_storage_refs` in PROD Postgres is effectively DEAD: 8 rows total, all belonging to one team
account, newest 2026-05-15. Recent real uploaders (cschwartz78 2026-08-19, jordark91330 2026-08-20)
have active `game_storage` rows in their profile SQLite but NO Postgres ref row at all. So the
missing-row drift shape found on dev 2026-08-11 is the NORM on prod: the Postgres side has been
blind to every upload since May. Anything reading `game_storage_refs` for storage accounting or
expiry scheduling has been operating on 3-month-stale data. Scope this task's audit to establish
which writers stopped populating it (and when), and whether `game_ref_counts` shares the same gap
for post-May uploads.

## Why now, not before

The prior fixes made the DELETE path safe (it recounts from source-of-truth `game_storage` rows
before an irreversible delete, per the retrospective). This task is about the READ/DISPLAY paths and
the counter's existence as an independent, driftable piece of state at all — lower urgency than the
prod-data-loss incident that prompted the point-fixes, which is why it was correctly deferred as a
"larger change, follow-up task" rather than bundled into the emergency fix.

## Solution (per the retrospective's proposal — validate, don't just implement blindly)

Replace the bare `game_ref_counts.ref_count` integer with a derived ref-set: one row per
(game, referencing profile), so the count is always `COUNT(*)` over real rows rather than a value
that can independently drift from them. Read the retrospective's full writeup first — this task
formalizes and scopes that proposal into actual implementation work; it does not re-derive the
design from scratch.

## Context

### Relevant Files (REQUIRED)
- `.claude/retrospectives/game-video-refcount-drift-incident.md` — full incident writeup, the
  proposal this task implements, and the other still-open checklist items (one-time reconciliation
  of existing drift, admin/monitoring alert on negative counts) that may be worth folding in here or
  splitting out — decide during design, don't silently drop them.
- Postgres `game_ref_counts` table + whatever module owns its schema (`app/services/pg.py` §
  `_SCHEMA_DDL` per CLAUDE.md's migration table — this is a `postgres` track change, uses the
  `schema_migrations` table, NOT a SQLite `PRAGMA user_version` migration).
- `auth_db.delete_ref` / `insert_game_storage_ref` and wherever else `game_ref_counts` is
  read/written (sweep scheduler's `_count_refs_all_profiles`, `count_refs_in_profile`,
  `heal_ref_count`) — grep for `game_ref_counts` and `ref_count` across `src/backend/app/` before
  scoping the diff; the retrospective names some call sites but may not be exhaustive.
- `docs/testing/derisk-plan-2026-08-11.md` — source of the 2026-08-11 missing-row observation.

### Related Tasks
- Follows: the 2026-07-24 point-fixes (commit `1678145a`, hardening `03d2d03b`/T5850) — already on
  master, do not re-implement or revert any of that; this task is additive/structural on top of it.
- Depends on: read the retrospective's full incident history before starting — T5850's
  authoritative-recount logic in particular must keep working under whatever new schema lands here.

### Technical Notes
- This is a Postgres schema change (new table, likely a migration to backfill existing rows from
  current `game_storage` state) — include the Migration agent in classification per CLAUDE.md.
- The retrospective also lists two smaller open items (one-time reconciliation, negative-count
  monitoring alert) that are cheaper than the full derived-set rework — worth a design-time decision
  on whether they're prerequisites, can ship independently first, or get absorbed here.

## Implementation

### Steps
1. [ ] Read the full retrospective + confirm the derived-set proposal still fits current code
       (schema, call sites may have moved since 2026-07-24).
2. [ ] Design: new table shape, backfill migration, and every read/write call site's new form.
3. [ ] Investigate the 2026-08-11 missing-row observation specifically — confirm whether a missing
       `game_ref_counts` row currently causes any user-visible symptom today (before this task's fix
       lands) so it's not silently left unexplained.
4. [ ] Implement + migrate + update all call sites.
5. [ ] Verify against the existing sweep/live-ref-guard tests (`test_sweep_scheduler.py`
       `TestGraceDeletionLiveRefGuard`, `TestDeleteRefCounterDrift`, T5850's authoritative-recount
       tests) — they must still pass or be deliberately superseded, not silently broken.

### Progress Log

## Acceptance Criteria
- [ ] `game_ref_counts` (or its replacement) can no longer disagree with the real per-profile
      `game_storage` rows by construction — `ref_count = COUNT(*)`, not a maintained integer.
- [ ] Existing sweep/delete-guard tests pass against the new shape.
- [ ] The 2026-08-11 missing-row-for-games-2/3/5 observation is explained (root cause identified,
      even if the fix here structurally prevents recurrence rather than root-causing that specific
      instance).
- [ ] Migration backfills existing data with no game losing its live refs mid-migration.
