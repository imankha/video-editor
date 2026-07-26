# T5080: Just-in-time per-user migration (retire the bulk migration sweep)

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

DB migrations run today as an admin-triggered sweep over **every** user: `run_all_migrations()` loops all users calling `_migrate_user(user_id)` ([migrations/__init__.py:30-66](../../src/backend/app/migrations/__init__.py#L30)). Migrations do NOT auto-run on deploy/startup; an admin has to hit `POST /api/admin/migrate` (or fly ssh) after each deploy that adds a migration. This is operationally fragile (T4820/T4830 both traced bugs to users/profiles silently stuck at old schema versions when the sweep was missed or partial) and it does not scale — it touches R2 for every user on every run regardless of who is active.

User direction (2026-07-13): move to **just-in-time (JIT) per-user migration**, triggered as part of the update/refresh flow (T5070) — a user's DBs are migrated to head when they come online on the new version. And as the cutover: **run one last full batch migration, then delete the batch migration code.**

## Dependency

Depends on **[T5070](T5070-blocking-update-gate.md)** (blocking update gate + cache flush + frontend state sync). JIT is designed against the concrete sync/flush/resync paths T5070 establishes and slots into **step 5 of T5070's ordered update flow** (client on new version -> flush state up -> caches flushed -> **JIT migrate here** -> resync down). Do not start until T5070's seam exists; the design should be finalized once those paths are concrete.

## Current State (investigation, 2026-07-13)

- **JIT primitive already exists.** `_migrate_user(user_id)` migrates one user's `user.sqlite` + all registered profiles ([migrations/__init__.py:85](../../src/backend/app/migrations/__init__.py#L85)); the bulk runner is just `for user in users: _migrate_user(...)`. JIT is largely *relocating* that call to the per-user DB-load seam, not new migration logic.
- **Natural seam:** `ensure_user_database(user_id)` ([user_db.py:122](../../src/backend/app/services/user_db.py#L122)) / session-init — already R2-restores a user's DB on access; the migrate call belongs here, before first DB read.
- **Two version axes stay independent:** `PRAGMA user_version` (schema) vs R2 `x-amz-meta-db-version` (sync). JIT must respect both.
- **T4830 hardening to preserve per-user:** registry join (only registered profiles), force-download canonical R2 copy (local-ahead guard), verify-at-head, fail-loud. JIT must keep these; it must NOT regress to optimistic local-only migration.
- **Postgres is shared/once** — cannot be per-user; it stays deploy-time/admin-triggered. JIT applies to `user_db` + `profile_db` only.

## Solution

### 1. Design (Architect, gated)
Produce `docs/plans/tasks/T5080-design.md` covering:
- **Trigger & seam:** call `_migrate_user(user_id)` at `ensure_user_database`/session-init, before first DB read; how it composes with T5070's flow (first authed request after refresh migrates the user).
- **Concurrency & idempotency:** two concurrent requests from the same user / overlapping profiles must not double-migrate or corrupt R2. Migration is idempotent at the SQL level (`user_version` gate) — confirm, and add a per-user in-process lock (or advisory lock) if needed to serialize the R2 download->migrate->upload cycle.
- **Failure handling:** a failing JIT migration fails loud (T4830), blocks that user's data access rather than serving a half-migrated DB, surfaces a clear error — no silent fallback to unmigrated data (project rule).
- **Performance:** first post-refresh request per user pays a version-check (+ actual migrate only when behind); at-head must be a cheap no-op. Because it rides T5070's gated refresh, the one-time cost is expected, not surprising.
- **Split:** Postgres stays deploy/admin-triggered; `user_db`/`profile_db` go JIT. State clearly.

### 2. Implement JIT
Wire `_migrate_user` into the seam per the approved design, preserving T4830 guarantees. Add tests: at-head no-op, behind-head migrates to head, concurrent-request safety, fail-loud on a broken migration (blocks access, no half-migrated serve).

### 3. Cutover — final batch, then delete the bulk code
- **Run one last full `run_all_migrations`** across all envs (dev/staging/prod) so every existing user + profile, including long-inactive ones, is at head at the moment of cutover. Verify counts (migrated/skipped/errors/orphans) are clean per T4830 reporting.
- **Then delete the bulk migration code:** `run_all_migrations`, its admin endpoint (`POST /api/admin/migrate`) / the bulk orchestration, and any docs/scripts pointing operators at "run migrations after deploy." Keep the per-user `_migrate_user` and the versioned `vNNN_*.py` migration files — those are what JIT runs. Update CLAUDE.md "Migration System" to describe JIT as the mechanism (no more manual post-deploy migrate step for user DBs).
- **Long-tail after cutover (design decision, document it):** once the bulk runner is gone, a NEW migration added later reaches a user only when they next come online (JIT). Truly-inactive users stay behind until they return. Decide + document the acceptable handling: (a) JIT-on-access is sufficient because data is only read/written through the migrated path anyway; and (b) any batch-touching background job (e.g., the expiry sweep) must `_migrate_user` before operating on that user's data, so no un-migrated DB is ever processed. Confirm no remaining code path assumes "all users already migrated by the sweep."

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/__init__.py` — `_migrate_user` (keep, wire in), `run_all_migrations` (delete at cutover)
- `src/backend/app/services/user_db.py` — `ensure_user_database` (JIT seam)
- `src/backend/app/session_init.py` — session-init path
- `src/backend/app/routers/admin.py` — `POST /api/admin/migrate` (delete at cutover)
- Any background job that iterates users/profiles (expiry sweep) — must migrate-before-touch post-cutover
- `CLAUDE.md` "Migration System" section — rewrite for JIT
- Knowledge: [backend-services.md](../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../.claude/knowledge/persistence-sync.md), running-migrations reference

### Related Tasks
- Depends on: **T5070** (update flow + sync/flush/resync paths; JIT slots into step 5)
- Builds on: T4830 (hardened runner — preserve its guarantees per-user), surfaced by T4820 (missed-sweep corruption is the motivation)

### Technical Notes
- L-tier, Architect design gate. Migration agent NOT needed (no new schema; this changes *when/how* existing migrations run). This task deletes orchestration code and moves a call — the versioned migration files are untouched.
- Do the final batch + deletion as the LAST step, after JIT is verified in prod, so there's never a window with neither mechanism active.
- Env order for the final batch + cutover: dev -> staging -> prod, verifying clean at each.

## Implementation

### Steps
1. [ ] Wait for T5070's sync/flush/resync seam to exist
2. [ ] Architect design doc (trigger/seam, concurrency, failure, perf, split, long-tail) — **user approval gate**
3. [ ] Implement JIT `_migrate_user` at the seam, preserving T4830 guarantees
4. [ ] Tests: at-head no-op, behind migrates, concurrency-safe, fail-loud blocks access
5. [ ] Verify JIT in staging then prod (users migrate on access; no missed-sweep bugs)
6. [ ] Ensure background jobs migrate-before-touch; remove any "all users migrated" assumption
7. [ ] Final full `run_all_migrations` across dev/staging/prod (clean counts)
8. [ ] Delete bulk code (`run_all_migrations`, admin migrate endpoint, orchestration); rewrite CLAUDE.md Migration System for JIT

### Progress Log

**2026-07-13**: Task created by splitting from T5070 (user decision). Motivation: retire the fragile per-deploy admin sweep (missed/partial sweeps caused T4820/T4830 corruption). Key enabler: `_migrate_user` already exists as the single-user primitive. Cutover = one last batch then delete the bulk runner (user directive).

## Acceptance Criteria

- [ ] User DBs (`user_db` + `profile_db`) migrate to head just-in-time at the per-user load seam, riding T5070's refresh flow
- [ ] T4830 guarantees preserved per-user (canonical R2 copy, verify-at-head, fail-loud); no half-migrated DB ever served
- [ ] Concurrency-safe (no double-migrate / R2 corruption on concurrent same-user requests)
- [ ] Postgres migration path unchanged (deploy/admin-triggered)
- [ ] One final full batch migration run clean across dev/staging/prod
- [ ] Bulk migration code deleted (`run_all_migrations`, admin migrate endpoint); `_migrate_user` + versioned files retained; CLAUDE.md updated to JIT
- [ ] No remaining code path assumes users were pre-migrated by a sweep (background jobs migrate-before-touch)
- [ ] Tests pass

## Field findings from the 2026-07-25 staging+prod migration (feed these into the design)

Real data gathered while migrating both envs by hand. These change the *rationale* for JIT and add
requirements the current draft does not cover.

### 1. The real argument for JIT is CORRECTNESS, not runtime
Prod: **10 registry users / 14 profiles.** Staging: **7 users / 11 profiles.** The bulk sweep is
cheap at this size and finished in seconds. Do NOT justify this task on sweep duration — justify it
on the two correctness holes below, both observed live.

### 2. Orphan profiles are skipped FOREVER by the bulk sweep
`run_all_migrations` discovers profiles by LISTING R2, then intersects with the profile registry read
from the user's own `user.sqlite` (`app.services.user_db.get_profiles`, NOT Postgres —
`migrations/__init__.py:94,107`). Anything on disk/R2 but not registered is logged
`Orphan profile <pid> ... not in registry; skipping` and never migrated — so it is frozen at its old
version permanently. Observed: prod had `imankh@gmail.com/b95eb93b` stuck at **v25 while head was
v29**; staging had one at v25 and another at v10.

**JIT implication (and a genuine advantage):** JIT keys off *the profile actually being opened*, so
an orphan that is never opened never needs migrating, and one that IS opened gets migrated at the
seam — closing the hole by construction. **The design must state explicitly what happens when a
request opens a profile that is not in the registry**: migrate-then-serve, refuse, or repair the
registry. Silently serving an unmigrated profile is the failure mode to avoid.

### 3. Stale-profile + new-column is an active hazard
A profile several versions behind head is exactly what breaks hot-path reads when a migration adds a
column ([[feedback_new_column_hotpath_migration_window]], T5630's `_has_stage_columns` window
guard). Today a stale/orphan profile can be served without ever being migrated. JIT must guarantee
**migrate-before-first-read**, not merely migrate-before-write, or the same class of breakage moves
from "un-migrated env" to "un-migrated profile".

### 4. Profile ids are NOT globally unique — scope everything by (user_id, profile_id)
Verified on prod: `b95eb93b` existed under BOTH `imankh@gmail.com` (v25, empty, orphan) and
`arshia.kalantari@gmail.com` (v29, 53 clips / 32 projects / 6 games). Any JIT bookkeeping —
migration state, locks, caches, metrics, cleanup — must key on the PAIR. A profile-id-only key would
collide across users and, for anything destructive, could destroy another user's data.

### 5. Concurrency surface JIT inherits
The existing sweep is single-threaded and admin-triggered. JIT runs on the request path, so the
already-listed concurrency criterion is the hard part: two concurrent requests for the same
(user, profile) must not both migrate or both upload. Reuse the existing per-user upload lock rather
than inventing one, and note that a migration REWRITES the file — see the WAL hazard T4315 hit
(swapping/rewriting a SQLite file under a live connection loses committed-but-uncheckpointed frames;
checkpoint or quiesce first).

### 6. Operational notes for the final batch run (acceptance criterion 5)
- `init_pg_pool()` must be called before anything touches Postgres in an SSH one-liner.
- `USER_DATA_BASE` is `/user_data` on Fly (not `/data/user_data`).
- `Error: The handle is invalid.` after correct output is a Windows pty artifact, not a failure.
- Cleanup done 2026-07-25: staging and prod are now **0 orphans, all profiles at head (v29)** — so
  the "one final full batch run clean" criterion starts from a clean baseline. Re-verify before
  deleting the bulk path, since new orphans can appear from profile-create races (T5310 class).
