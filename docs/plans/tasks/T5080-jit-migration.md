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
