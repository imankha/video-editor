# T6910: user.sqlite R2 restore silently skipped when local file is gone but version cache is stale

**Status:** WIP
**Impact:** 7
**Complexity:** 2
**Created:** 2026-08-12
**Updated:** 2026-08-12

## Problem

Root-caused while investigating imankh@gmail.com's dev account looking blank after a
prod->dev copy (`scripts/copy_user_between_envs.py`) followed by a manual
`rm -rf user_data/<user_id>` to force a fresh pull. Full incident narrative:
`docs/plans/tasks/SESSION-HANDOFF-2026-08-12.md` § ACTIVE ISSUE.

`ensure_user_database(user_id)` (`src/backend/app/services/user_db.py:122-217`) decides
whether to attempt an R2 restore using ONLY `get_local_user_db_version(user_id)` —
an in-process, memory-only cache (`database.py:1786-1802`, `_user_sqlite_versions`)
with no TTL and no tie to whether the local file it describes still exists:

```python
local_version = get_local_user_db_version(user_id)
if local_version is None:
    ...  # R2 restore logic — the ONLY place this runs
```

If a process has EVER loaded a user (setting `_user_sqlite_versions[user_id]` to some
version), and the local `user.sqlite` file is later deleted out-of-band (manual
`rm -rf`, disk cleanup, crash mid-write — anything that isn't the app's own delete-account
flow), `local_version` is still non-`None` on the next call. The R2-restore branch is
skipped entirely, control falls through to `is_fresh_db = not db_path.exists()` (True),
and a brand-new BLANK `user.sqlite` gets created with schema but no rows — silently
discarding the user's real profile list and creating a fresh default profile in its place.
This exactly matches the imankh@gmail.com symptom: profile `510b2c07` (blank,
`created_at` = restart time) replaced the real profiles `9fa7378c` + `b95eb93b`.

The app already has a correct answer for the SANE version of this (account deletion):
`forget_user_db(user_id)` (`user_db.py:303-314`) explicitly clears both
`_initialized_user_dbs` and the version cache, and is called from `auth.py:122-124`
alongside `invalidate_user_cache`. But nothing protects against the local file
disappearing WITHOUT going through that flow — and `_initialized_user_dbs`'s own
membership check already self-heals on a missing file (`user_db.py:130-136`, discards
and re-initializes), so the version cache is the only place this invariant is missing.

## Solution

Gate the R2-restore-skip decision on the local file actually existing, not just the
version cache being populated:

```python
local_version = get_local_user_db_version(user_id)
if local_version is None or not db_path.exists():
    ...
```

This makes `ensure_user_database` robust to the local file vanishing by ANY means, not
just the ones that remember to call `forget_user_db` — matching the project's
fail-loud/correct-data philosophy (CLAUDE.md § Coding Principles) rather than requiring
every future deletion path to independently remember cache invalidation.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/user_db.py:122-217` (`ensure_user_database`) — the fix
- `src/backend/app/database.py:1786-1802` (`get_local_user_db_version` /
  `set_local_user_db_version`) — the stale cache being read
- `src/backend/app/database.py:1525-1538` (`forget_local_db_state`) — existing correct
  invalidation for the account-delete path, referenced for contrast
- `src/backend/tests/` — add a regression test: populate the version cache, delete the
  local file out-of-band, call `ensure_user_database`, assert it restores from R2
  (mocked) rather than creating a blank DB

### Related Tasks
- Not part of T6900 (Draft tile aspect), but discovered and fixed in the same session
  while unblocking manual verification of T6900 against a real copied-down prod account.

### Technical Notes
- Immediate unblock for imankh@gmail.com is separate from this fix: pull the real
  `user.sqlite` down from R2 by hand (backend stopped first, WAL safety) OR — once this
  fix lands — do a genuinely clean backend restart and let `ensure_user_database`
  self-heal via the now-corrected gate.

## Implementation

### Steps
1. [ ] Add the `or not db_path.exists()` gate in `ensure_user_database`
2. [ ] Regression test: stale non-None cached version + missing local file -> restore
       path runs (not the blank-create path)
3. [ ] Confirm imankh@gmail.com's real profile list restores after a clean backend
       restart (no manual R2 pull needed once the fix is in place)
4. [ ] Lint + relevant backend test set green

### Progress Log

**2026-08-12**: Filed and fixed in the same session while unblocking T6900 manual
verification — see SESSION-HANDOFF-2026-08-12.md for the full incident trace.

## Acceptance Criteria

- [ ] A local `user.sqlite` deleted out-of-band (not via `forget_user_db`) is correctly
      re-restored from R2 on next access, never silently replaced with a blank DB
- [ ] Regression test passes
- [ ] imankh@gmail.com's dev account shows real profiles (`9fa7378c`, `b95eb93b`) after
      a clean restart, no manual intervention
