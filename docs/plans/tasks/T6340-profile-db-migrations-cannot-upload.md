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
while master's head is **31** (see the updated stuck-migration list below).

> **Update 2026-08-02, after the Share the Game epic merged (`43728f77`).** Independently reproduced
> a fifth time while migrating staging for that epic. Nothing below contradicts the analysis above —
> it adds the current stuck list, a user-visible correctness consequence, and a sibling defect in the
> same runner family. See **"Update: state as of the Share the Game merge"** near the end.

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

---

## Update: state as of the Share the Game merge (2026-08-02, master `43728f77`)

### Reproduced a fifth time, with the CAS refusal captured in the same run

Ran `run_all_migrations()` on staging right after the epic deployed. Same outcome, and the log line
that proves the mechanism appeared in the same output:

```
[SYNC_CONFLICT] user=3ed03fb5… profile=9fa7378c loaded=v2696 r2=v2697 machine=d8933d5f417308
  — NOT uploading, NOT re-downloading (WAL-unsafe swap off the write lock)
[ExportWorker] R2 version conflict … refused (R2 at v2697), baseline frozen at v2696;
  scheduled re-pull on next access (T6160)
```
```json
"postgres": {"applied": [], "current_version": 22, "latest_version": 22, "error": null},
"users": {"total": 3, "migrated": 0, "skipped": 1, "errors": [ …6 profiles, all "sync_failed"… ]}
```

Note `loaded=v2696 r2=v2697` — a *confirmed* baseline one behind R2, not the `None` baseline of the
migration path. Both refusal shapes are live; the fix must satisfy the CAS guard, not dodge it.

### Stuck migrations — the list grew

| Track | Version | Task | Status on staging |
|---|---|---|---|
| profile_db | **v030** `games_source_reference` | T5800 | NOT applied (profiles at 29) |
| profile_db | **v031** `reclassify_teammate_clips_to_team` | T5725 | NOT applied |

profile_db head on master is now **31**. Every additional profile_db migration merged before this is
fixed widens the gap and lengthens the catch-up run once it works.

### ⚠️ This now has a user-visible correctness consequence (new — raises urgency)

T5725 (Share the Game epic) deliberately did **not** add a layer predicate to
`_filter_clips_for_tag`, on the explicit rule *"migration makes data correct, not a filter."* v031 is
the migration that was supposed to make it correct — it moves every teammate-tagged My-Athlete clip
onto the Team layer.

**Because v031 cannot run, that premise is false on staging and production right now.** The older
email-teammate share path still calls `_filter_clips_for_tag` with no layer predicate at
`routers/clips.py:2566`, `:2706`, `:2748`, and it is still reachable from the UI
(`AnnotateContainer.jsx:620` reads `teammate-shares`). So **a My-Athlete clip that carries a teammate
tag can still be shared to that teammate** — exactly the leak T5725 was written to close.

Not affected: the new epic share path. `resolve_scoped_clips`
(`services/materialization.py:~477`) intersects tagged clips with the Team layer explicitly and has a
test pinning it (`test_my_athlete_clip_never_crosses_on_any_scope`), so sharing through the
redesigned modal cannot cross layers regardless of v031.

Whoever picks this up should decide between:
- **(preferred)** fix this task → v031 runs → the epic's stated rule holds as designed; or
- add the layer predicate to those three legacy call sites as an interim guard — contradicts the
  epic rule, but stops depending on a migration that currently cannot execute.

### 🔴 Sibling defect found while migrating — SHOULD BE ITS OWN TASK

Different bug, same runner family, equally silent. **The postgres runner skips version gaps
permanently.**

`MigrationRunner.get_pending` (`app/migrations/base.py:38`) computes pending as
`version > MAX(applied)`. For postgres, `get_current_version` is `SELECT MAX(version) FROM
schema_migrations` — a **maximum, not a set membership test**. So a migration numbered *below* an
already-applied version is never applied, with no error and no log.

This actually happened. T5770 correctly numbered its migration **v022** because v020/v021 were
reserved by the then-unmerged Share the Game branches. T5770 merged and was migrated first. Result on
both dev and staging:

```
applied: [1 … 19, 22]     max: 22     GAPS: [20, 21]
```

`run_all_migrations()` reported success while applying nothing, and `shares.share_type` never gained
`'game_link'` — so every public-game-link creation would have 500'd on the CHECK constraint, on an
environment that reported itself fully migrated.

Fixed by hand on dev and staging (applied v020/v021 explicitly, then stamped `schema_migrations`);
both are now contiguous 1–22. **The runner defect is untouched and will recur** the next time
branches merge out of numeric order — which the branch-numbering discipline actively encourages.

Suggested fix: make `get_pending` compare against the applied *set*, not the max —
`SELECT version FROM schema_migrations` and return migrations whose version is not present. Guard it
with a test that seeds `[1..19, 22]` and asserts v020/v021 are still pending. Consider whether
`PRAGMA user_version` tracks (user_db/profile_db) can gap the same way — they store a single integer,
so they can only move forward, but a merge that lands a lower version has the same silent-skip shape.

### Verification recipes that work (cost me a failed attempt)

The Fly Postgres cursor returns **dict rows, not tuples** — `r[0]` raises `KeyError: 0`. Index by
name, or defensively:

```bash
fly ssh console -a reel-ballers-api-staging -C "python -c \"
from app.services.pg import init_pg_pool, get_pg
init_pg_pool()
with get_pg() as c:
    cur=c.cursor(); cur.execute('SELECT version FROM schema_migrations ORDER BY version')
    v=[(r['version'] if isinstance(r,dict) else r[0]) for r in cur.fetchall()]
    print('applied:', v, 'GAPS:', [n for n in range(1, max(v)+1) if n not in v])
\""
```

This probe is read-only and safe — prefer it over `run_all_migrations()` for checking state
(running the full migrator just to look iterates every user's R2 DB).

Also: a `game_link` row in a **dev** Postgres breaks any local test run that replays migrations from
v001, because v016 rebuilds the `share_type` CHECK without `'game_link'` and the existing row
violates it. Symptom is a wall of fixture errors that look environmental. Delete the stray row.
Harmless on staging/prod, where v016 is long applied and never replays.

## Acceptance Criteria

- [ ] `run_all_migrations()` on staging reports profiles migrated, not `sync_failed`
- [ ] Staging profile DBs reach schema head **verified in R2**, not only on the machine
- [ ] The T4315 CAS guard is unchanged (fix the caller, not the guard)
- [ ] `r2_version` is populated in migration error rows instead of null
- [ ] Integration test that fails on current code and passes after
- [ ] Prod profiles audited for below-head schema and brought to head
- [ ] Staging profiles reach **v031** (not just v030) — v030 T5800 and v031 T5725 are both stuck
- [ ] Confirm T5725's rule holds once v031 lands: no teammate-tagged clip remains on the My-Athlete
      layer, so `_filter_clips_for_tag`'s missing layer predicate is genuinely safe again
- [ ] The postgres gap-skip sibling defect is filed as its own task (see the update section) — do NOT
      silently fold it in here; it is a separate runner bug with its own regression test
