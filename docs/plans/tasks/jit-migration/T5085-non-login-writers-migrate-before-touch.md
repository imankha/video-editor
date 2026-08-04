# T5085: Non-login writers migrate before touch

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-04
**Updated:** 2026-08-04

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
1. [ ] Audit and enumerate every non-login path that opens a user/profile DB
2. [ ] Assign and document a policy per path (migrate-before-touch vs tolerate + why)
3. [ ] Implement migrate-before-touch where chosen
4. [ ] Add/confirm column guards where "tolerate" is chosen, and note them as permanent
5. [ ] Grep out any remaining "all users are already migrated" assumption
6. [ ] Tests: each migrate-before-touch path migrates a behind-head DB before its first read; each
       tolerate path runs correctly against a behind-head DB

## Acceptance Criteria

- [ ] Definitive list of non-login writers exists, each with a stated policy
- [ ] Every migrate-before-touch path migrates before its first read of that DB
- [ ] Every tolerate path is guarded and documented as permanently version-tolerant
- [ ] No code path assumes accounts were pre-migrated by a sweep
- [ ] Tests pass
