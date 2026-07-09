# T4830 — Design: Migration runner leaves some profiles stuck at old schema versions

**Status:** DESIGN PROPOSAL (design-gated) — awaiting supervisor approval before implementation.
**Tier:** L (Backend + Database; migration-runner + R2-sync robustness).
**Scope of this doc:** Stage 1 code analysis (per-suspect verdicts from code) + Stage 2 target design.
No prod credentials in this worker — all reproduction is against **synthetic SQLite fixtures + mocked R2**.
The supervisor owns real-data reproduction (`1b842983`) and prod verification.

---

## 1. Stage 1 — Code Analysis (per-suspect verdicts)

Traced: `run_all_migrations` → `_migrate_user` → `_migrate_profile_db` / `_get_profile_ids` /
`_download_profile_db` (`app/migrations/__init__.py`), `MigrationRunner.run` / `get_pending`
(`app/migrations/base.py`), `sync_db_to_r2_explicit` (`app/database.py:1207`),
`sync_database_to_r2_with_version` + the `x-amz-meta-db-version` guard (`app/storage.py:829`),
and the profile registry `get_profiles` (`app/services/user_db.py:718`).

### How "applied" and "migrated" are decided today

- `get_pending` reads schema version from `PRAGMA user_version` **of whatever SQLite connection it is
  handed** (`base.py:39` → `get_current_version` → `base.py:36`). It never consults R2.
- `_migrate_profile_db` (`__init__.py:104`) opens `USER_DATA_BASE/<user>/profiles/<profile>/profile.sqlite`.
  It only downloads from R2 **`if not db_path.exists()`** (`__init__.py:110`). An existing machine-local file
  is migrated **in place, un-checked against R2**.
- Sync is attempted **only `if applied:`** (`__init__.py:126`). The **return value of
  `sync_db_to_r2_explicit` is discarded** — a failed upload does not change the outcome.
- `_migrate_user` returns `any_applied` (bool); `run_all_migrations` counts a **user** as
  `migrated` when ANY of its profiles applied ≥1 migration (`__init__.py:37-40`). Counts are per-user,
  not per-profile, and a profile can be "part of a migrated user" while itself never advancing or never
  persisting.

### Suspect 1 — Stale machine-local `profile.sqlite` migrated instead of the canonical R2 copy

**Verdict: CONFIRMED as a real code defect. Confidence HIGH (code) / MEDIUM that it is the operative
cause for `1b842983` (needs the supervisor's prod trace).**

`__init__.py:110` only refreshes from R2 when the local file is absent. On Fly, machines have persistent
volumes and a user's requests are machine-pinned (T1190), so a machine-local `profile.sqlite` can survive
across runs and **diverge from the canonical R2 object**. If a prior run downloaded R2 (v6), migrated the
local copy to head (v23), and the upload did not persist (see Suspect 2), the local file is left at v23
while R2 stays at v6. Every subsequent run then reads `PRAGMA user_version = 23` from the **local** file →
`get_pending` returns `[]` → `applied` empty → `sync` never attempted → **R2 is frozen at v6 forever**.
This exactly reproduces the observed re-run (`migrated: 0, skipped: 8`) with R2 still at v6/empty-metadata/May-27.
The runner has **no reconciliation path** that pushes local→R2 when local is already ahead.

### Suspect 2 — R2 sync **version guard** rejects the upload

**Verdict: the "version guard rejects" mechanism is REFUTED. But a closely-related "applies locally,
never persists, still reported migrated" defect is CONFIRMED. Confidence HIGH (pure code).**

`sync_db_to_r2_explicit` calls `sync_database_to_r2_with_version(..., skip_version_check=True)`
(`database.py:1237`). With `skip_version_check=True`, the HEAD/conflict guard (`storage.py:868-897`) is
**bypassed entirely**: `new_version = (current_version or 0) + 1` and the upload is always attempted with
`Metadata={"db-version": str(new_version)}`. So a schema-only migration (which bumps `user_version`, not
the sync `db_version`) is **not** blocked by the version guard — the guard cannot be the reason R2 stayed
at v6/empty-metadata. (Consistent with the finding that the object was *never overwritten*: a blocked
guard would still not explain "never uploaded once," and a successful upload would have written a numeric
`db-version` like the healthy `aee3e218` profile at `db-version=1263`.)

What **is** real: when the upload *does* fail (R2 exception → `(False, None)` at `storage.py:945`; or the
per-user upload lock is contended — note the runner passes `lock_timeout=None`, so it blocks rather than
defers), `sync_db_to_r2_explicit` returns `False`, and `_migrate_profile_db` **ignores that** and still
returns a non-empty `applied`. The user is reported `migrated` while R2 never received the migrated copy.
This is the **core reporting bug** the task calls out. The exact trigger for the first-ever failed upload
on `1b842983` (transient R2 error vs machine that never ran it vs lock) is the supervisor's prod trace to pin;
from code, the certainty is that a failed/absent upload is **silently swallowed and mis-reported**.

### Suspect 3 — Orphan profiles enumerated + migrated as if real

**Verdict: CONFIRMED. Confidence HIGH (pure code fact).**

`_get_profile_ids` (`__init__.py:132`) lists **R2 `CommonPrefixes`** under `.../profiles/` and returns
**every** profile directory. It never joins `user.sqlite.profiles` (the registry, `get_profiles`,
`user_db.py:718`). For `1b842983` that is 5 profiles enumerated while only `a8428823` is registered; the
other 4 (`01ae6a94`, `1c844a0b`, `7ea71e41`, `8a9bd070`) are orphan `profile.sqlite` objects the app never
loads. The runner spends effort migrating them and counts them toward pass/fail as if they were live
profiles. The T4820 residual (game 5 in `7ea71e41`, v2) lives in an **orphan** → unreachable → **zero user
impact**, which matches the severity reduction in the task file.

### One-line summary

The runner trusts a **possibly-stale machine-local file** as the migration source (S1), **swallows
upload failures** while still reporting "migrated" (S2-adjacent), and **operates on orphan profiles** that
aren't in the registry (S3). Net effect: dormant-user registered profiles can silently sit below head in
R2, and the run's success counts are not trustworthy.

---

## 2. Stage 2 — Target Design

### Design principles applied (CLAUDE.md)

- **Correct Data, Not Workarounds:** the canonical location for a profile DB is its **R2 object**. The
  runner must migrate *that*, not a divergent local cache. No "if exists" guard reading a stale source.
- **No Silent Fallbacks / fail loud:** a profile that did not reach head in R2 must surface in `errors`,
  never be counted as `migrated`.
- **Registry is authoritative:** only profiles in `user.sqlite.profiles` are "real"; everything else is
  orphan cruft, skipped + logged (not deleted unprompted).

### 2.1 Enumerate REGISTERED profiles, log orphans

Replace the enumeration used for migration with a **registry join**:

```
registered = { p["id"] for p in get_profiles(user_id) }      # user.sqlite.profiles (authoritative)
r2_profiles = set(_get_profile_ids(user_id))                 # keep for orphan detection only
orphans = r2_profiles - registered
for pid in sorted(orphans):
    logger.warning("[Migration] Orphan profile %s for user %s — not in registry; skipping", pid, user_id)
    results.orphans.append({user_id, pid})                    # reported, not migrated, not errored
for pid in sorted(registered):
    _migrate_profile_db(user_id, pid)                         # only registered profiles migrated
```

`_migrate_user_db(user_id)` already runs `ensure_user_database(user_id)` first, which R2-restores
`user.sqlite`, so `get_profiles` reads the **canonical** registry even for dormant users. A registered
profile that has **no** R2 `profile.sqlite` object is itself a fail-loud condition (registered-but-missing),
counted in `errors`, not silently skipped.

### 2.2 Always migrate the canonical R2 copy (kill the stale-local read)

In `_migrate_profile_db`, **always refresh from R2** before migrating, instead of trusting an existing
local file:

```
_download_profile_db(user_id, profile_id, db_path, force=True)   # overwrite any machine-local copy
if not db_path.exists():
    # registered profile with no R2 object -> fail loud (do NOT create an empty DB here)
    return MigrateResult(status="missing", applied=[])
```

Rationale: the migration runner's source of truth is R2 (last-write-wins under the existing
`skip_version_check=True` model). Downloading fresh each run removes the divergence that lets a stale
local v23 mask a canonical v6. (Reuse the canonical path so the existing `sync_db_to_r2_explicit`, which
is hard-wired to `USER_DATA_BASE/.../profile.sqlite`, syncs the same file we migrated — no new path-parameterized
sync helper needed.)

### 2.3 Persist after any schema migration, and **verify in R2** (fail loud)

After `PROFILE_DB_RUNNER.run`:

```
head = PROFILE_DB_RUNNER.latest_version
if applied:
    ok = sync_db_to_r2_explicit(user_id, profile_id)     # capture the return value (currently discarded)
    if not ok:
        return MigrateResult(status="sync_failed", applied=applied)   # -> errors, NOT migrated

# Verify the canonical R2 copy actually reached head (re-download + read PRAGMA user_version).
verified_version = _read_r2_profile_user_version(user_id, profile_id)   # fresh download to temp, PRAGMA read
if verified_version != head:
    return MigrateResult(status="not_at_head", applied=applied, r2_version=verified_version)  # -> errors
return MigrateResult(status="ok", applied=applied)
```

Key points:
- The upload itself already writes `x-amz-meta-db-version` unconditionally under `skip_version_check=True`
  (§Suspect 2), so a `user_version` bump **does** persist — the fix is to **stop ignoring failures** and
  to **assert the result in R2**, not to touch the version guard.
- Verification re-reads the **R2** object's `PRAGMA user_version` (schema version), satisfying acceptance
  criterion "every enumerated [registered] profile is at `latest_version` in R2, verify by re-downloading."
  It is independent of the sync `db_version`. Registered profiles per user are few, so the extra download
  is acceptable; the supervisor may opt to gate verification behind a flag if run cost matters.

### 2.4 Trustworthy reporting

`run_all_migrations` result grows a per-profile breakdown so "migrated" can never lie:

```
results["users"] = {
  "total": N,
  "migrated": ...,        # user had >=1 profile advance AND all its registered profiles verified at head
  "skipped": ...,         # all registered profiles already at head in R2 (verified)
  "errors": [ {user_id, profile_id, reason} ... ],   # sync_failed | not_at_head | missing | exception
  "orphans": [ {user_id, profile_id} ... ],          # informational, never counted as migrated
}
```

A user is only `migrated`/`skipped` when **all** its registered profiles verified at head; any profile
that failed to reach head puts the user's failing profile(s) into `errors`. This directly fixes the
"`migrated: 8` while profiles stay at v2" reporting bug.

### 2.5 Backfill decision

**No new backfill *migration file* is needed, and none should be added.** The stuck-profile condition is
not a schema change — it is the runner failing to push existing profiles to head. Once the robust runner
ships, a **single admin re-run** of `POST /api/admin/migrate` advances every dormant/registered profile to
head via the canonical R2 copy and verifies it. That re-run *is* the backfill (idempotent, fail-loud).

Recommendation:
- **Backfill = re-run `run_all_migrations` post-deploy** (supervisor triggers on prod). No `v0NN` file.
- **Orphan cleanup = a separate, opt-in admin script** (e.g. `scripts/cleanup_orphan_profiles.py`) that
  lists unregistered `profile.sqlite` objects per user and deletes them **only on explicit confirmation**.
  Not part of the runner; not run unprompted (CLAUDE.md data-safety). The T4820 residual (game 5 in
  orphan `7ea71e41`) is cleaned up here, not repaired — it is unreachable, so repairing it is pointless.

### Target flow (Mermaid)

```mermaid
flowchart TD
  A[run_all_migrations: per user] --> B[ensure_user_database -> R2 restore user.sqlite]
  B --> C[registered = get_profiles(user.sqlite.profiles)]
  B --> D[r2_profiles = _get_profile_ids R2 CommonPrefixes]
  D --> E{orphans = r2 - registered}
  E -->|log + report, skip| F[orphans[]]
  C --> G[for each REGISTERED profile]
  G --> H[force download canonical R2 profile.sqlite]
  H -->|missing| X[errors: missing]
  H --> I[run pending migrations -> user_version -> head]
  I -->|applied| J[sync_db_to_r2_explicit, capture result]
  J -->|False| Y[errors: sync_failed]
  I --> K[re-download R2 copy, read PRAGMA user_version]
  K -->|!= head| Z[errors: not_at_head]
  K -->|== head| OK[ok / migrated]
```

---

## 3. Files to change (implementation, post-approval)

- `src/backend/app/migrations/__init__.py` — registry join in `_migrate_user`; `force`-download in
  `_download_profile_db`/`_migrate_profile_db`; capture sync result; add R2 verification helper
  `_read_r2_profile_user_version`; structured per-profile results (`errors`, `orphans`). Return a small
  `MigrateResult` (status enum) from `_migrate_profile_db` instead of a bare `list`.
- `scripts/cleanup_orphan_profiles.py` — **new**, opt-in orphan reporter/deleter (confirmation-gated).
- No schema change → **no Migration agent / no `v0NN` file** (confirm at approval).
- Tests: `src/backend/tests/test_migration_runner.py` (new) — synthetic SQLite fixtures + mocked R2 client.

## 4. Tests (synthetic fixtures + mocked R2 — worker builds after approval)

1. **Dormant registered profile advances + upload asserted:** R2 `profile.sqlite` at `user_version=6`,
   registered in `user.sqlite.profiles`; no local file. After run: local migrated to head, mocked R2
   `upload_file` called with `db-version` metadata, and the re-download verification sees `user_version=head`.
   Result: user `migrated`, zero `errors`.
2. **Stale-local no longer masks R2:** local `profile.sqlite` at v23 but R2 at v6. After run (force download),
   the migrated+verified R2 copy is at head (proves we stopped trusting the stale local).
3. **Orphan skipped + logged:** R2 has a `profile.sqlite` for a profile NOT in the registry. It is not
   migrated, appears in `orphans`, and never in `migrated`/`errors`.
4. **Fail-loud on sync failure:** force `sync_db_to_r2_explicit` → False (reuse `FORCE_R2_SYNC_FAILURE`
   seam). Profile surfaces in `errors` (`sync_failed`); user NOT reported `migrated`.
5. **Fail-loud on not-at-head:** verification re-download returns `user_version < head` (mock a no-op
   upload). Profile surfaces in `errors` (`not_at_head`).
6. `from app.main import app` imports clean.

## 5. Risks & Open Questions (for supervisor)

1. **Force-download overwrites a machine-local file that may hold unsynced writes.** Under the existing
   `skip_version_check=True` last-write-wins model R2 is treated as canonical, so this matches current
   semantics — but if a live profile has pending local writes not yet synced, migrating the R2 copy could
   momentarily ignore them. Mitigation: the migration runner is an admin operation, and registered live
   profiles should already be synced; still, supervisor should confirm no active session is mid-write when
   running. (Interaction with T4310 CAS is worth noting.)
2. **Verification cost:** re-downloading each registered profile to assert `user_version` doubles R2 GETs
   per profile. Fine for a handful of profiles/user; supervisor may want a flag to disable verification on
   very large accounts.
3. **Exact first-failure trigger on `1b842983`** (why the very first upload never landed — transient R2
   error, a machine that never executed `_migrate_profile_db`, or lock contention) is **not determinable
   from code alone**; the supervisor's fly-side trace pins it. The design is robust to all three (fail-loud
   + verify + canonical source), so implementation does not block on that answer.
4. **Orphan deletion policy:** confirm the cleanup script is opt-in only and whether orphans should be
   archived (moved) rather than hard-deleted before removal.

---

**STOP — design gate.** Awaiting supervisor approval before any implementation past this document.
