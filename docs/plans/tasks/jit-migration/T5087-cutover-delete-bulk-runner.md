# T5087: Cutover — final batch, then delete the bulk runner

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-04
**Updated:** 2026-08-04

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
1. [ ] Re-verify orphan/head state on all three envs with the read-only probes
2. [ ] Final `run_all_migrations` on dev → staging → prod, clean counts at each
3. [ ] Restart prod machines after the batch (retires the stale-baseline residue of the last run)
4. [ ] Delete `run_all_migrations` + `POST /api/admin/migrate` + orchestration; keep `_migrate_user`,
       the versioned files, and the read-only probes
5. [ ] Rewrite CLAUDE.md § Migration System and every doc/skill/agent instruction that says
       "migrate after deploy" for user DBs
6. [ ] Document the long-tail property (inactive accounts migrate on return)
7. [ ] Update tests that exercised the bulk path

## Acceptance Criteria

- [ ] One final full batch run clean across dev/staging/prod (0 orphans, all at head)
- [ ] `run_all_migrations` and the admin migrate endpoint deleted; `_migrate_user`, versioned files,
      and read-only probes retained
- [ ] No doc, skill, agent, or script instructs an operator to migrate user DBs after a deploy
- [ ] CLAUDE.md § Migration System describes JIT, including the long-tail property
- [ ] Tests pass
