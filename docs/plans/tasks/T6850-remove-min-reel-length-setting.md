# T6850: Remove "Minimum reel length" setting + data (dead since explicit-intro pivot)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

`user_settings.intro_min_duration_seconds` ("Minimum reel length", T5215/v041) existed to
gate the *inherit-the-default-intro* path: don't prepend the profile's default intro card to
reels/collections shorter than the threshold. T6680 then removed the default/inherit concept
entirely (epic decision, 2026-08-09) — every intro card is now explicitly attached per
reel/collection, so there is no inherit path left for the threshold to gate. The setting
still renders in Manage Profile ("Minimum reel length", `ProfileIntroSection.jsx:277`), still
round-trips through two endpoints, and still occupies a NOT NULL column — pure dead weight
that confuses users ("what does this do?") and contradicts the explicit-attach model.

## Solution

Remove the setting end to end: UI, store state, endpoints, service helpers, schema column
(via migration), and stale design comments that still describe the duration gate.

## Context

### Relevant Files (REQUIRED)
Frontend:
- `src/frontend/src/components/ProfileIntroSection.jsx` — "Minimum reel length" field
  (~238-277): remove the control + draft/dirty state
- `src/frontend/src/stores/introCardStore.js` — `minDuration` state, fetch/update actions,
  `reset` entry (~150-186)
- `src/frontend/e2e/T5215-intro-attachment.qa.spec.js` — asserts the label (~21, ~434);
  prune those steps

Backend:
- `src/backend/app/routers/profiles.py` — GET/PUT intro-min-duration endpoints +
  `UpdateIntroMinDurationRequest` (~268-313) and the imports at ~28-30
- `src/backend/app/services/intro_cards.py` — `DEFAULT_INTRO_MIN_DURATION_SECONDS` (~159),
  `get_intro_min_duration` (~241), `validate_intro_min_duration` (~257); ALSO the stale
  resolution-order comment block (~340-360) that still documents the duration gate on the
  inherit path — rewrite to match the post-T6680 explicit-only model
- `src/backend/app/database.py` — `intro_min_duration_seconds` column in the
  `user_settings` fresh-schema DDL (~1254-1266); bump `PRAGMA user_version` head in step
  with the new migration
- NEW `src/backend/app/migrations/profile_db/v043_drop_intro_min_duration.py` — drop the
  column (SQLite `ALTER TABLE ... DROP COLUMN`; runtime is 3.35+) + register in
  `migrations/profile_db/__init__.py`. **Check unmerged sibling branches for a v043
  collision before pinning the number** (standing rule — v037->v041 and v039->v042
  renumberings both happened for exactly this reason).
- Tests: `src/backend/tests/test_t5215_intro_attachment.py` (min-duration helper/endpoint
  tests — delete those cases, keep the attachment/resolution ones), check
  `test_t5195_migration_v034.py` comment drift

### Related Tasks
- T5215 — introduced the setting (duration-gated default intro)
- T6680 — removed the default/inherit intro concept, making this setting dead
- Include the **Migration agent** in classification (schema change, profile_db track);
  migrations do NOT auto-run — `POST /api/admin/migrate` after deploy

### Technical Notes
- Verify before deleting: grep confirms `get_intro_min_duration` has no remaining
  resolution-path consumer (only `profiles.py` endpoints + tests import it post-T6680). If
  any consumer surfaces, that's a T6680 leftover to remove in the same pass, not a reason
  to keep the setting.
- Migration must be self-sufficient and tolerate the column already being absent (fresh DBs
  created after the DDL change) — same guard shape v041 used on ADD (`if col not in cols`).
- New-column/hot-path caution in reverse: dropping a column that old code still SELECTs
  breaks un-migrated-server/new-DB skew windows. Order: code stops reading the column
  FIRST (same deploy), migration drops it after. Since reads go through
  `column_exists()` guards today, dropping reads before the drop-migration is safe.

## Implementation

### Steps
1. [ ] Frontend: remove field from ProfileIntroSection + minDuration state/actions from
       introCardStore; prune e2e spec steps
2. [ ] Backend: remove both endpoints + request model + service helpers; rewrite stale
       duration-gate comments in intro_cards.py
3. [ ] Schema: remove column from fresh DDL; write + register v043 drop-column migration
       (collision-check the version number first)
4. [ ] Tests: delete min-duration cases, add migration test (column present -> dropped;
       already-absent -> no-op), run relevant set
5. [ ] Lint + `python -c "from app.main import app"` + relevant tests green

### Progress Log

**2026-08-11**: Task filed under Deploy Candidate milestone.

## Acceptance Criteria

- [ ] "Minimum reel length" no longer appears anywhere in Manage Profile
- [ ] `/api/profiles/...` intro-min-duration endpoints removed (404)
- [ ] `intro_min_duration_seconds` absent from fresh-DB schema AND dropped from migrated
      profile DBs via v043
- [ ] No remaining reference to `intro_min_duration` / `minDuration` in src (grep-clean,
      excluding archived docs)
- [ ] Migration is idempotent (re-run safe, absent-column safe); admin migrate step
      documented in the PR/deploy notes
- [ ] Tests pass
