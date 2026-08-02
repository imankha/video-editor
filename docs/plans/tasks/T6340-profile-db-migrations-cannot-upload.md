# T6340: profile_db migrations can NEVER reach R2 - the migration runner destroys its own sync baseline

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-08-02
**Found by:** running staging migrations after the T5770/T6310 merge (2026-08-02)

## Problem

**No profile_db migration can be applied on any R2-enabled deployment.** Not staging, not
production. The migration applies to the local SQLite file, then the upload to R2 is refused every
single time, and the local change is subsequently discarded by the T6160 re-heal.

This is why **profile_db v030 (`v030_games_source_reference`, T5800) is still not applied on
staging** even though T5800 merged to master some time ago. Staging profiles sit at schema **29**
while master's head is **30**.

### Reproduced deterministically (staging, 2026-08-02)

Ran `run_all_migrations()` four times. Identical result each time:

```json
"users": {"total": 3, "migrated": 0, "skipped": 1, "errors": [
  {"profile_id": "22c7616a", "reason": "sync_failed", "r2_version": null},
  ... 6 profiles, all sync_failed ...
]}
```

Postgres migrated fine (v022 applied). Only the profile_db track fails.

### Root cause

`_migrate_profile_db` (`src/backend/app/migrations/__init__.py:~215`) does its own download and
**file swap**, bypassing `ensure_database`:

```python
found = _download_profile_db(user_id, profile_id, tmp_path)   # canonical R2 copy
...
shutil.move(str(tmp_path), str(db_path))                      # overwrite local with R2 copy
...
applied = PROFILE_DB_RUNNER.run(conn, "sqlite")               # schema 29 -> 30, locally
if applied and client:
    if not sync_db_to_r2_explicit(user_id, profile_id):       # <-- ALWAYS REFUSED
        return MigrateResult(status="sync_failed", applied=applied)
```

**The R2 object does not contain a `db_version` row** - the sync version lives in R2 object metadata
(`x-amz-meta-db-version`), not inside the SQLite file. So `shutil.move` replaces the local file with
one that has **no `db_version` row**.

`get_local_db_version` (`database.py:426`) reads `SELECT version FROM db_version WHERE id = 1` and
therefore returns `None`. The upload path's CAS guard (`storage.py:1197`) then hits its
"unconfirmed baseline" branch:

```python
if r2_version > 0 and (current_version is None or r2_version > current_version):
    logger.critical("[SYNC_CONFLICT] ... NOT uploading, NOT re-downloading ...")
    return False, r2_version
```

`current_version is None` -> refuse. R2 always has content, so `r2_version > 0` is always true.
**The refusal is unconditional and guaranteed**, not a race.

### Why pre-healing does not work

`schedule_profile_db_reheal` (T6160, `database.py:~1541`) deliberately clears the `db_version` row so
the next `ensure_database` performs a WAL-safe first-access restore. Running `ensure_database` for
every profile DOES heal the baseline - verified on staging:

```
937e5e54 b95eb93b  baseline None -> 3337
3ed03fb5 9fa7378c  baseline None -> 2697
```

But the very next `run_all_migrations()` fails identically, because `_migrate_profile_db`
re-downloads and re-swaps the file **in its own process**, wiping the freshly-confirmed baseline
again. The two safety systems deadlock:

| System | Intent | Effect here |
|---|---|---|
| T4315 CAS "unconfirmed baseline" | never force-push an unconfirmed local DB over real R2 data | refuses the migrated upload |
| T6160 re-heal | clear `db_version` so next access restores from R2 | guarantees `current_version is None` |
| `_migrate_profile_db` file swap | migrate the canonical R2 copy | re-creates the `None` baseline every run |

Both guards are behaving correctly. The defect is that the migration runner never establishes a
confirmed baseline for the copy it just downloaded.

## Solution

After `shutil.move(tmp_path -> db_path)`, `_migrate_profile_db` must **record the sync version it
just downloaded** as the confirmed local baseline, before migrating and uploading. It already has
everything needed - `get_db_version_from_r2(user_id, profile_id=...)` returns the version of the
object it fetched.

Sketch (the implementor must verify against real code, not copy this):

```python
shutil.move(str(tmp_path), str(db_path))
r2_sync_version = get_db_version_from_r2(user_id, profile_id=profile_id)
set_local_db_version(user_id, profile_id, r2_sync_version)   # memory cache
_persist_db_version(db_path, r2_sync_version)                # the db_version row
```

so the later `sync_db_to_r2_explicit` sees `current_version == r2_version` -> no conflict -> uploads
as `r2_version + 1`.

**Do NOT weaken the CAS guard.** The `current_version is None` branch is doing exactly its job
(T4315 exists because force-pushing an unconfirmed DB over real user data caused prior data loss).
Fix the caller that creates the unconfirmed state, never the guard.

### Also fix: `r2_version` is reported as null

Every error row reads `"r2_version": null` even though the log line carries a real version
(`r2=v2697`). `sync_db_to_r2_explicit` returns a bool, so `_migrate_profile_db` cannot propagate the
conflicting version into `MigrateResult`. Thread it through - the null made the failure look like an
R2 outage when it was a CAS refusal, which cost real diagnosis time.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/__init__.py` - `_migrate_profile_db` (~215, the file swap + upload),
  `_migrate_user_db` (~185, check whether `user.sqlite` has the same defect - it uses
  `ensure_user_database` + `sync_user_db_to_r2_explicit`, a different path)
- `src/backend/app/storage.py` - CAS guard `:1197` (profile) and `:1470` (user.sqlite); do NOT weaken
- `src/backend/app/database.py` - `get_local_db_version` `:415`, `_clear_persisted_db_version` `:505`,
  `schedule_profile_db_reheal` `:~1541`, `ensure_database` `:676`
- `.claude/knowledge/persistence-sync.md` - CAS / SyncResult, T4315

### Verification (this is the important part)
A unit test is not sufficient - the bug only appears with a real R2 object whose version metadata is
ahead of a file with no `db_version` row. Required evidence:

- [ ] An integration test that seeds a profile in R2, clears the local `db_version` row (simulating a
      T6160 re-heal), runs `_migrate_profile_db`, and asserts the R2 object's `PRAGMA user_version`
      reaches head. This test must FAIL on today's code.
- [ ] After deploying, run migrations on staging and confirm profiles reach schema 30 **in R2**
      (`_read_r2_profile_user_version`), not just locally.

### Blast radius
- **Production is affected identically.** Any profile_db migration since this defect appeared has
  silently not been applied to R2. Audit which prod profiles are below head before/after fixing.
- Postgres and (probably) user_db tracks are unaffected - postgres v022 applied normally.
- Not a data-loss bug: the guards prevented the bad write, and T6160 restores the local copy from R2
  on next access. Verified on staging - game counts intact (6/2/10), `local_sync == r2_sync` after heal.

## Acceptance Criteria

- [ ] `run_all_migrations()` on staging reports profiles migrated, not `sync_failed`
- [ ] Staging profile DBs reach schema head **verified in R2**, not only on the machine
- [ ] The T4315 CAS guard is unchanged (fix the caller, not the guard)
- [ ] `r2_version` is populated in migration error rows instead of null
- [ ] Integration test that fails on current code and passes after
- [ ] Prod profiles audited for below-head schema and brought to head
