# T13260: Staging deploy never runs Postgres migrations, so staging's schema drifts behind its code

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** S (one workflow or fly config file)
**Created:** 2026-10-20
**Updated:** 2026-10-20
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Problem

Staging auto-deploys the backend on every master push (`.github/workflows/deploy-backend.yml`,
`flyctl deploy --config fly.staging.toml`), but nothing runs the Postgres migration track afterwards.
Postgres is the one track with no per-user JIT seam: it migrates only when someone calls
`POST /api/admin/migrate-postgres` or the fly-ssh `migrate_postgres()` fallback (deploy skill step 6a),
and that step is only in the prod `/deploy` procedure.

Found 2026-10-20: staging Postgres was at **v026** while its code expected **v035**. Running
`migrate_postgres()` by hand applied v027 to v035 cleanly (`error: None`). For the weeks before
that, staging served code against a schema missing `upload_failures` (v029), the payments ledger
(v030), the account-deletion audit (v031 to v033), the reconciliation marker (v034) and
`daily_counters.clips_uploaded` (v027). Any staging walk or gate run that touched those paths was
testing a broken environment, not the code. Prod was fine (v035) because `/deploy` runs step 6a.

## Solution

Make every staging backend deploy run `migrate_postgres()` and fail loudly if it errors. Two candidate
mechanisms; pick one in implementation:

1. **Fly `release_command` in `fly.staging.toml`** (`[deploy] release_command = "python -c '...migrate_postgres()...'"`).
   Runs on a temporary machine BEFORE the new version takes traffic, and a nonzero exit aborts the
   release. Needs the one-liner to exit nonzero when the result's `error` is not None (today
   `migrate_postgres()` returns the error in a dict and never raises).
2. **A post-deploy step in `deploy-backend.yml`** running `flyctl ssh console -a reel-ballers-api-staging -C ...`
   and failing the job when `error` is not None. Simpler, but the new code serves briefly against the
   old schema.

Prefer option 1 (migrate before traffic). Do NOT change prod in this task: prod's step 6a stays an
explicit operator step per CLAUDE.md "Migration System"; whether prod should adopt the same
release_command is a separate user decision.

## Context

### Relevant Files
- `.github/workflows/deploy-backend.yml` - staging backend auto-deploy
- `src/backend/fly.staging.toml` - staging Fly config (release_command lives here)
- `src/backend/app/migrations/__init__.py` - `migrate_postgres()` (returns `{applied, current_version, latest_version, error}`)
- `.claude/skills/deploy/SKILL.md` - step 6a and the run book's staging note (remove the "check staging by hand" line once this ships)
- `.claude/knowledge/backend-services.md` - migration tracks

### Related Tasks
- Found during the T12920 run book review (2026-10-20)

### Technical Notes
- `migrate_postgres()` is idempotent: it applies only versions missing from `schema_migrations`, so running it on every deploy is a no-op when nothing is pending.
- Do not touch `user_db`/`profile_db`: those migrate JIT per account and must never get an out-of-process sweep (T5087).

## Acceptance Criteria

- [ ] A staging backend deploy runs `migrate_postgres()` before (or immediately after) the new version serves
- [ ] A migration error fails the deploy visibly (red workflow or aborted release), never silently
- [ ] A deploy with nothing pending succeeds and logs `applied: []`
- [ ] Deploy skill step 6a and the run book's staging note updated to match
- [ ] Prod deploy behavior unchanged
