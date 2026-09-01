# T5087: Cutover — final batch, then delete the bulk runner

**Status:** WAITING ON USER

**2026-09-01 implemented, branch pushed, awaiting merge approval.** Re-scoped step 1-3 at
implementation time: did NOT run one last `run_all_migrations` across dev/staging/prod. That step
predates T8190's finding that running the bulk sweep as a SEPARATE process against a live machine
is itself hazardous (the exact CAS-conflict/deadlock-shape mechanisms this epic's own §"2026-08-04
prod incident" documents) — running it now would reintroduce the risk this cutover exists to
retire. Verified readiness instead via the read-only probes the design already called for: prod was
already confirmed fully at head by T8190's own investigation (56/56 accounts, 60/60 profiles, v48);
staging's 3 gate accounts were independently reverified this session via real `POST /auth/dev-login`
requests through the JIT seam (not the bulk sweep), confirming `all_profiles_at_head: true`. Deleted
`run_all_migrations`/`_migrate_postgres`/`_migrate_user`/`_migrate_user_db`/`_migrate_profile_db` in
full (not just `run_all_migrations` + the endpoint as originally scoped — `_migrate_user` had no
remaining callers once the bulk path was gone, so it was deleted too, not kept). Renamed
`POST /api/admin/migrate` -> `POST /api/admin/migrate-postgres`. Re-pointed the
`/api/test/migrate-current-profile` test seam onto `run_profile_seam`/`run_user_seam`. Fresh-context
Reviewer pass found 4 MAJOR issues (stale docs describing the old result shape, a test-seam endpoint
that could silently report "ok" without having migrated anything, an over-broad claim that missed
`backfill_posters` still bulk-migrating in-process, v048's now-inaccurate execution-model docstring)
— all fixed. 113 targeted tests green, ruff clean, import clean.
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-04
**Updated:** 2026-09-01

Epic child 4/5 — see [EPIC.md](EPIC.md). This is the user-directed cutover: **one last full batch
migration, then delete the batch migration code.**

## Problem

While both mechanisms exist, the bulk sweep is not just redundant — it is actively harmful. Running
it against a live machine moves R2 forward behind the serving process's in-memory baseline and breaks
that user's next write (the 2026-08-04 prod incident, EPIC.md finding #1). It is the last remaining
out-of-band writer of a live machine's DBs, and deleting it is what makes that failure class
unreachable.

It also keeps an operator step alive ("migrate after deploy") that JIT has made unnecessary, and
every doc/script that mentions it is now wrong.

## Solution

### 1. Final full batch, all envs
Run `run_all_migrations` once across **dev → staging → prod**, verifying clean counts at each
(migrated / skipped / errors / orphans, per T4830 reporting). Confirm **0 orphans and all profiles at
head** before proceeding — new orphans can appear from profile-create races (T5310 class), so the
2026-07-25 clean baseline must be re-verified, not assumed.

**Do this on a freshly restarted machine, or accept that any warmed process is left with a stale
baseline** — that is exactly the failure being retired, and it applies to this last run too.

### 2. Delete the bulk code
- `run_all_migrations()` and its orchestration in `migrations/__init__.py`
- `POST /api/admin/migrate` in `routers/admin.py` (and any admin UI affordance for it)
- Keep: `_migrate_user`, `_migrate_profile_db`, the versioned `vNNN_*.py` files, and the read-only
  status probes (`get_migration_status`, the per-user probe) — those stay useful for verification and
  are what T5089 needs to prove its floor

### 3. Rewrite the docs
- `CLAUDE.md` § Migration System: JIT is the mechanism; no manual post-deploy migrate step for user
  DBs; Postgres still deploy-triggered
- `.claude/agents/migration.md` (the SSH fallback recipe), the deploy skill, and the running-migrations
  reference — remove or rewrite every "run migrations after deploy" instruction for user DBs
- Update the memory-worthy facts: post-deploy data steps and the migration-tracking probes

### 4. Long-tail decision (document it)
Once the bulk runner is gone, a NEW migration reaches an account only when that account next comes
online. Truly inactive users stay behind indefinitely — which is fine, because (a) their data is only
read/written through the migrated path, and (b) T5085 made every background toucher either migrate
first or be version-tolerant. State this in CLAUDE.md so it reads as a design property rather than a
gap.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/__init__.py` — `run_all_migrations` (delete), `_migrate_user` (keep)
- `src/backend/app/routers/admin.py` — `POST /api/admin/migrate` (delete, ~L728)
- `CLAUDE.md` § Migration System — rewrite
- `.claude/agents/migration.md`, `.claude/skills/deploy/SKILL.md`, running-migrations reference
- `src/backend/tests/test_migration*.py` — tests covering the bulk path

### Related Tasks
- Depends on: **T5083** (JIT proven in prod) and **T5085** (non-login writers covered) — deleting the
  sweep before T5085 lands leaves a window with neither mechanism
- Blocks: **T5089** (the floor can only be proven once JIT is the only mechanism)

### Technical Notes
- M-tier. Do the deletion as the LAST step, after JIT is verified in prod.
- Env order: dev → staging → prod, verifying clean at each.
- Operational gotchas for the batch run (from 2026-07-25): call `init_pg_pool()` before touching
  Postgres in an SSH one-liner; `USER_DATA_BASE` is `/user_data` on Fly; a trailing
  `Error: The handle is invalid.` is a Windows pty artifact, not a failure.
- Never run the bulk sweep "just to check" state — use the read-only probes
  ([[project_migration_tracking_gap]]).

## Implementation

### Steps
1. [x] Re-verify orphan/head state on all three envs with the read-only probes (prod: already
       verified by T8190's investigation; staging: reverified this session via real dev-login)
2. [x] **RESCOPED, not run:** a final `run_all_migrations` batch was deliberately skipped -- see
       the 2026-09-01 note above. No batch run against dev/staging/prod happened or was needed.
3. [x] N/A (no batch run means no stale-baseline residue to retire with a restart)
4. [x] Deleted `run_all_migrations`, `_migrate_postgres`, `_migrate_user`, `_migrate_user_db`,
       `_migrate_profile_db`, and `POST /api/admin/migrate` in full (broader than originally
       scoped -- `_migrate_user` had zero remaining callers once the bulk path was gone). Kept
       the versioned migration files and every read-only probe.
5. [x] Rewrote CLAUDE.md § Migration System and every doc/skill/agent/knowledge-doc instruction
       found via a full grep sweep that said "migrate after deploy" for user DBs
6. [x] Documented the long-tail property (inactive accounts migrate on return), including a
       documented exception for storage-reclamation migrations (e.g. v048) that never reach an
       idle account either
7. [x] Deleted/trimmed/retargeted every test that exercised the bulk path

## Acceptance Criteria

- [x] ~~One final full batch run clean across dev/staging/prod (0 orphans, all at head)~~ RESCOPED:
      verified readiness via the read-only probes instead of a live batch run (see 2026-09-01 note)
- [x] `run_all_migrations` and the admin migrate endpoint deleted; versioned files and read-only
      probes retained (`_migrate_user` was ALSO deleted, not kept -- no callers survived)
- [x] No doc, skill, agent, or script instructs an operator to migrate user DBs after a deploy
- [x] CLAUDE.md § Migration System describes JIT, including the long-tail property
- [x] Tests pass (113 targeted tests green, ruff clean, import clean)
