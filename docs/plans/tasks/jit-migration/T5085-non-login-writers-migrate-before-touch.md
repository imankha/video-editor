# T5085: Non-login writers migrate before touch

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-04
**Updated:** 2026-08-31

Epic child 3/5 — see [EPIC.md](EPIC.md) for goal, settled decisions, and field findings (2026-08-04
finding #5 is this task's charter).

## Problem

JIT (T5083) migrates a profile when **its owner comes online**. Plenty of code reaches a profile DB
with no login involved, and after the bulk sweep is deleted (T5087) those paths are the only remaining
way an un-migrated DB gets touched. Each one is a live instance of the stale-profile + new-column
hazard: a hot-path SELECT naming a column that a behind-head DB does not have.

Known non-login writers:

| Path | How it reaches a DB with no login |
|---|---|
| Expiry sweep | Walks every user on a timer |
| Share-page materialization | The viewer is not the owner |
| Export worker / Modal completion callbacks | Outlive the originating session |
| Admin grants | Admin acts on another user's DB |
| Payment webhooks | No session at all (the T4315 restore-if-newer path) |

The audit must confirm this list is complete — anything that opens a profile DB it did not get from
the request's own session/profile context belongs here.

## Solution

1. **Audit** every code path that opens a `user.sqlite` or `profile.sqlite` outside a logged-in
   request for that user. Produce the definitive list (the table above is the starting point, not the
   answer).
2. **Assign each path one of two policies, explicitly:**
   - **migrate-before-touch** — call the same JIT routine T5083 wired at the seam, before the first
     read. Preferred default.
   - **tolerate** — the path is allowed to run against any schema version, and therefore must carry a
     column/PRAGMA-window guard forever (T5630 `_has_stage_columns` pattern). Only choose this where
     migrating is genuinely wrong (e.g. a sweep that must not rewrite every user's DB on a timer), and
     write down why.
3. **Implement** the chosen policy per path.
4. **Remove the "already migrated" assumption.** Grep for any code or comment that assumes the sweep
   pre-migrated everyone, and fix it.

The tolerate choice has a real cost worth stating in the review: it makes the PRAGMA-window guard a
permanent requirement for that path rather than a deploy-window crutch. That is acceptable if it is a
decision, not an accident.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/sweep_scheduler.py` — expiry sweep (walks users/profiles)
- `src/backend/app/routers/shares.py` — share materialization for a non-owner viewer
- `src/backend/app/routers/export/` — export worker completion paths that write after the session ends
- `src/backend/app/routers/admin.py` — grants and any other cross-user write
- Payment/webhook handlers (the T4315 restore-if-newer callers)
- `src/backend/app/migrations/__init__.py` — the JIT routine T5083 exposes
- Knowledge: [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md) § T4315,
  [backend-services.md](../../../../.claude/knowledge/backend-services.md)

### Related Tasks
- Depends on: **T5083** (the JIT routine these paths call)
- Blocks: **T5087** — this must land before the bulk runner is deleted, or there is a window where
  neither mechanism migrates a non-login-reached DB
- Related: T5630 (`_has_stage_columns` window guard, the "tolerate" pattern), T4315 (restore-if-newer
  for writers resolving a DB they do not hold)

### Technical Notes
- M-tier. Backend-only. No schema change.
- Migrating inside the sweep means the sweep can now rewrite user DBs — think about blast radius and
  the per-user write lock before choosing that policy for it.
- Everything keys on `(user_id, profile_id)`; profile ids are not globally unique (EPIC decision 4).

## Implementation

### Steps
1. [x] Audit and enumerate every non-login path that opens a user/profile DB
2. [x] Assign and document a policy per path (migrate-before-touch vs tolerate + why)
3. [x] Implement migrate-before-touch where chosen
4. [x] Add/confirm column guards where "tolerate" is chosen, and note them as permanent
5. [x] Grep out any remaining "all users are already migrated" assumption
6. [x] Tests: each migrate-before-touch path migrates a behind-head DB before its first read; each
       tolerate path runs correctly against a behind-head DB

### Definitive list of non-login writers + policy (step 1/2 deliverable)

A Code Expert audit (read-only) enumerated every non-login opener; an Expert (Opus) agent then
validated/refined it against the actual code before implementation. Full detail lives in
`.claude/knowledge/persistence-sync.md` § T5085 — summary here:

**Already migrate-before-touch via the T5083 seam** (the seam sits *inside* `ensure_database()` /
`ensure_user_database()`, so every non-login path that reaches a DB through the normal
`get_db_connection()`/`get_user_db_connection()` helpers inherited it for free): the expiry sweep
(Phase 1 + Phase 2 helpers), auto-export, the export worker + Modal queue, the poster warmer,
`record_milestone`/`record_impression`/`record_session_exit`/`update_session`/`share_view_counts`
(analytics.py), admin cross-user `user.sqlite` reads, profile create/switch.

**Genuine gaps, fixed (migrate-before-touch, code changed):**
- `materialization.ensure_profile_db_local` + `materialization._open_profile_db` — the two raw
  openers used by share materialization/claim, admin clip-phase inventory, admin stuck-uploads,
  public share/collection/intro resolution, and cross-profile reel moves. Neither called the seam
  before this task; both now do (via the extracted `migrations.run_profile_seam`).
- `user_db.ensure_user_database_fresh` — ran the seam, then did its own restore-if-newer swap
  AFTER it that could reintroduce a below-head file without re-triggering the seam. Now re-runs the
  seam after any actual swap.
- `storage.sync_database_from_r2_if_newer` / `sync_user_db_from_r2_if_newer` — the shared
  low-level swap primitives every download-and-swap goes through. Both now clear
  `migrations._seam_verified` for the scope they just swapped, closing the swap-hazard class
  structurally rather than trusting every future caller to remember it.
- `poster.backfill_posters` — was calling `_migrate_profile_db`, the bulk-runner primitive T5087
  deletes; re-pointed to `migrate_local_profile_db_at_seam`. Its `ensure_database()` call (and the
  equivalent unguarded calls in `sweep_scheduler.do_sweep` and `auto_export.backfill_hiq_recaps`)
  was also unguarded — a single `MigrationBlocked` would have aborted the entire bulk pass; all
  three now catch it per-profile and continue.
- `credit_ledger._has_live_export_job` — reads through `_open_profile_db`, which can now raise
  `MigrationBlocked`; caught and treated as "possibly live, do not release" (the existing
  conservative-on-ambiguity contract).

**Tolerate, permanent (documented, not migrated):**
- `privacy.py` CCPA data export (`export-data`) — legal export must never 500 or surprise-write;
  existing `sqlite_master` guard kept, now stated as permanent rather than a deploy window.
- `credit_backfill.py` (T5840 cutover tool) — reads pre-migration-shape base-schema tables on
  purpose; one-shot tool, candidate for deletion alongside T5089.
- Graceful shutdown sync, logout `VACUUM`, WAL checkpoint, `db_version` bookkeeping — schema-
  agnostic, open no application table.

**The ~40 `column_exists`/`_has_stage_columns` request-path guards** (T5630-pattern, previously
justified as "the deploy->migrate window"): kept, not deleted (~40 sites, and deleting them removes
the only protection against additive-migration rolling-deploy skew — EPIC decision 8). Re-justified
via ONE shared rewrite of `column_exists`'s docstring in `database.py` (now: permanent defence in
depth against a machine on old code serving a DB a newer machine just migrated), with the handful of
assertion-bearing comments that stated the now-false "ensure_database never runs versioned ALTERs"
claim rewritten to point at it (`poster.py` x2, `materialization.py`'s `RecipientProfileBelowHead`
x2, `credit_backfill.py`). One user-facing string (`clips.py` set_rotation 503) no longer names the
deleted `POST /api/admin/migrate` endpoint. Two comments (`migrations/base.py`, `test_seams.py`)
were left as-is on review — both still factually accurate today (Postgres migrations stay
admin-triggered per EPIC decision 7; the test seam still correctly calls the still-existing bulk
primitives) — re-pointing them is T5087's job when it actually deletes those primitives.

## Acceptance Criteria

- [x] Definitive list of non-login writers exists, each with a stated policy
- [x] Every migrate-before-touch path migrates before its first read of that DB
- [x] Every tolerate path is guarded and documented as permanently version-tolerant
- [x] No code path assumes accounts were pre-migrated by a sweep
- [ ] Tests pass
