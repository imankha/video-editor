# JIT Migration (retire the bulk sweep)

**Status:** TODO
**Started:** —
**Created:** 2026-08-04 (promoted from standalone T5080, created 2026-07-13)
**Re-affirmed:** 2026-08-28 — user direction: signups are growing and the per-account bulk sweep is
outgrown. Target timeline: the NEXT deploy ships JIT (T5081+T5083 at minimum), that deploy's
post-deploy migrate is the LAST manual batch run, and from then on accounts migrate on first login
under the new version; the bulk machinery (T5087) and already-applied migration files (T5089) are
then deleted. Scale is now a second argument alongside the correctness holes below (the 2026-08-25
signup surge doubled users — the "10 prod users" figure in the field findings is stale).

## Goal

Move `user_db` + `profile_db` migrations from an admin-triggered bulk sweep over every account to
**just-in-time per-user migration at the DB-load seam**, then delete the bulk machinery and the
migration files that have already run everywhere.

End state:

- A user's DBs are migrated to head by the process that is about to serve them, before the first
  read — no post-deploy operator step, no "did you remember to migrate?"
- `run_all_migrations` and `POST /api/admin/migrate` no longer exist.
- The versioned `vNNN_*.py` files hold only migrations that some reachable DB might still need;
  everything applied to 100% of accounts is deleted, with a hard floor that fails loud.
- Postgres is unchanged: shared/once, deploy-triggered.

## Why (correctness, not runtime)

At 10 prod users / 14 profiles the sweep costs seconds — do **not** justify this on runtime. The
argument is that the sweep is silently incomplete and out-of-band:

1. **Orphan profiles are skipped forever.** The sweep intersects R2 listing with the profile
   registry; anything unregistered is logged and skipped, frozen at its old version permanently
   (observed: prod `imankh@gmail.com/b95eb93b` at v25 while head was v29).
2. **A missed or partial sweep corrupts.** T4820/T4830 both traced back to profiles stuck at old
   schema versions after a sweep was missed.
3. **Running it against a LIVE machine breaks the next writer** (2026-08-04 prod incident, below):
   the runner moves R2 forward behind the serving process's in-memory baseline, and the user's next
   write dies on a CAS conflict with a "did not save" banner.

JIT closes all three by construction: it keys off *the profile actually being opened*, in *the
process that will serve it*, at *the moment it is opened*.

## Design decisions (settled — children implement, do not relitigate)

| # | Decision | Why |
|---|---|---|
| 1 | Migration runs **in the serving process**, never out of band | The 2026-08-04 stale value was the in-process `_user_db_versions` cache, not the file |
| 2 | Seam is **first-access restore, before any connection opens** for that (user, profile) | The runner swaps the file; a live connection makes the swap WAL-unsafe (`wal_busy` refusal) |
| 3 | Migrate-before-first-**READ**, not before first write | A stale profile + a new column breaks hot-path SELECTs (T5630 `_has_stage_columns` class) |
| 4 | Everything keys on the **pair** `(user_id, profile_id)` | Profile ids are NOT globally unique — verified on prod (`b95eb93b` under two accounts) |
| 5 | A CAS refusal on the migration path = **re-pull and retry once**, not a user-facing failure | Migrations are idempotent under the `user_version` gate; conflicts become routine under JIT |
| 6 | Failure **blocks that user's data access**, loudly | Never serve a half-migrated DB (T4830, project no-silent-fallback rule) |
| 7 | Postgres stays deploy/admin-triggered | Shared DB, runs once, not per-user |
| 8 | Migrations are **additive-only** unless the deploy is gated | Rolling deploys mean old code can serve a DB the new code just migrated |

## Tasks

Implemented strictly in this order — each depends on the one above it.

| ID | Task | Status |
|----|------|--------|
| T5081 | [Split clean-copy conflicts from unsynced-write conflicts](T5081-clean-copy-conflict-self-heal.md) | STAGING |
| T5083 | [JIT migrate at the per-user load seam](T5083-jit-migrate-at-load-seam.md) | TODO |
| T5085 | [Non-login writers migrate before touch](T5085-non-login-writers-migrate-before-touch.md) | TODO |
| T5087 | [Cutover: final batch, then delete the bulk runner](T5087-cutover-delete-bulk-runner.md) | TODO |
| T5089 | [Prune migrations that have run on every account](T5089-prune-applied-migrations.md) | TODO |

**Why this order:** T5081 is the safety net T5083 leans on (JIT multiplies cross-writer conflicts,
and today every conflict is a scary banner). T5085 closes the non-login hole *before* the bulk
runner disappears in T5087, so there is never a window with neither mechanism. T5089 can only
prove its floor once JIT has been running in prod and the bulk path is gone.

## Shared invariants (bind every child)

- **One version axis each, kept independent:** `PRAGMA user_version` = schema, R2
  `x-amz-meta-db-version` = sync. Never conflate.
- **Baseline coherence:** in-memory `_user_db_versions`, the file's `db_version` row, and R2 metadata
  advance in one path or not at all ([database.py:524](../../../../src/backend/app/database.py#L524),
  [migrations/__init__.py:311](../../../../src/backend/app/migrations/__init__.py#L311)).
- **Preserve T4830's guarantees per-user:** canonical R2 copy (force-download), local-ahead guard,
  verify-at-head, fail loud. JIT must not regress to optimistic local-only migration.
- **Reuse the existing per-user write lock** (`_get_user_write_lock`,
  [db_sync.py:228](../../../../src/backend/app/middleware/db_sync.py#L228)) — do not invent a second.
- **Migration runner hands `up(conn)` a TUPLE row factory**, not `sqlite3.Row` — index positionally.

## Completion criteria

- [ ] All five tasks complete
- [ ] `run_all_migrations` + `POST /api/admin/migrate` deleted; no doc or script tells an operator to
      migrate after a deploy for user DBs
- [ ] No code path assumes "all accounts were pre-migrated by a sweep"
- [ ] CLAUDE.md § Migration System rewritten for JIT
- [ ] Migration files below the proven floor deleted, floor enforced with a loud failure

---

## Field findings from the 2026-07-25 staging+prod hand migration

Real data gathered while migrating both envs by hand.

### 1. Scale is not the argument
Prod: **10 registry users / 14 profiles.** Staging: **7 users / 11 profiles.** The sweep finishes in
seconds. Justify this epic on the correctness holes, never on duration.

### 2. Orphan profiles are skipped FOREVER by the bulk sweep
`run_all_migrations` discovers profiles by LISTING R2, then intersects with the registry read from
the user's own `user.sqlite` (`app.services.user_db.get_profiles`, NOT Postgres —
`migrations/__init__.py:94,107`). Anything on disk/R2 but unregistered is logged
`Orphan profile <pid> ... not in registry; skipping` and never migrated. Observed: prod had
`imankh@gmail.com/b95eb93b` stuck at **v25 while head was v29**; staging had one at v25, another at v10.

**JIT implication (a genuine advantage):** JIT keys off the profile actually being opened, so an
orphan that is never opened never needs migrating, and one that IS opened gets migrated at the seam.
**T5083 must state explicitly what happens when a request opens a profile that is not in the
registry**: migrate-then-serve, refuse, or repair the registry. Silently serving unmigrated is the
failure mode to avoid.

### 3. Stale-profile + new-column is an active hazard
A profile several versions behind head is exactly what breaks hot-path reads when a migration adds a
column ([[feedback_new_column_hotpath_migration_window]], T5630's `_has_stage_columns` guard). JIT
must guarantee migrate-before-first-READ, or the breakage class moves from "un-migrated env" to
"un-migrated profile".

### 4. Profile ids are NOT globally unique
Verified on prod: `b95eb93b` existed under BOTH `imankh@gmail.com` (v25, empty, orphan) and
`arshia.kalantari@gmail.com` (v29, 53 clips / 32 projects / 6 games). Any JIT bookkeeping —
migration state, locks, caches, metrics, cleanup — keys on the PAIR. A profile-id-only key would
collide across users and, for anything destructive, could destroy another user's data.

### 5. Concurrency surface JIT inherits
The sweep is single-threaded and admin-triggered; JIT runs on the request path. Two concurrent
requests for the same (user, profile) must not both migrate or both upload. A migration REWRITES the
file — see the WAL hazard T4315 hit (swapping a SQLite file under a live connection loses
committed-but-uncheckpointed frames; checkpoint or quiesce first).

### 6. Operational notes for the final batch run
- `init_pg_pool()` must be called before anything touches Postgres in an SSH one-liner.
- `USER_DATA_BASE` is `/user_data` on Fly (not `/data/user_data`).
- `Error: The handle is invalid.` after correct output is a Windows pty artifact, not a failure.
- Cleanup 2026-07-25: staging and prod were left at **0 orphans, all profiles at head (v29)** — the
  "one final batch run clean" criterion starts from a clean baseline. Re-verify before deleting the
  bulk path; new orphans can appear from profile-create races (T5310 class).

---

## Field findings from the 2026-08-04 prod CAS conflict

A live prod incident that is precisely the bug JIT deletes — and whose residue JIT must handle.

**What happened.** Prod deployed 01:31:34 UTC; the machine warmed 16 users' DBs, downloading
`imankh@gmail.com`/`9fa7378c` at sync **v2865** (01:32:58). The T5830 heal (`profile_db` v033) was
then run against prod **out of band** (separate process, ~01:33-01:49 — commit 5929decf "heal
executed on prod" is stamped 01:49:38 UTC), taking R2 to **v2866**. Two hours later the user logged
in; the first request that dirtied the profile DB tripped CAS:

```
03:45:51 CRITICAL [SYNC_CONFLICT] loaded=v2865 r2=v2866 reason=stale_baseline
         writer=843e15c2d26718/- method=GET path=/api/projects — NOT uploading, NOT re-downloading
```

The guard was right (the app's copy predated the heal), T6160's re-pull fetched v2866 a second
later, and the user's manual **Retry** at 03:46:20 synced clean (v2867/v2868). No data lost — but
the user ate a persistent "did not save" banner for an action they never took.

### 1. The failure was an in-MEMORY baseline, and JIT is the structural fix

`get_local_db_version` ([database.py:524](../../../../src/backend/app/database.py#L524)) prefers the
in-process `_user_db_versions` cache over the file's `db_version` row. The out-of-band runner updated
R2 **and** the local file **and its own process's** cache; the long-lived uvicorn process kept v2865
until restart. **Any migration executed by a process other than the one serving the user arms this
trap for the next writer** — a first-class argument for the T5087 cutover, since deleting the bulk
runner deletes the only writer that can move R2 behind a live process's back.

### 2. The seam ordering is a WAL constraint, not a preference

`_migrate_profile_db` force-downloads and **swaps the file**, so it refuses with `wal_busy` when a
live connection holds it ([migrations/__init__.py:299](../../../../src/backend/app/migrations/__init__.py#L299)).
The only clean window is inside first-access restore, before any connection for that
(user, profile) opens. Hook it later and the swap refuses while handlers read a pre-migration schema
— the new-column hot-path breakage. A `wal_busy` refusal must block or retry that request, never
degrade to serving un-migrated data.

### 3. Under JIT, CAS conflicts become a NORMAL event

Post-cutover the out-of-band writer is gone, but the same conflict returns in user-shaped forms: two
tabs, phone + laptop, or a login migrating while a background export worker holds a baseline for the
same profile. In-process, serialize on the existing per-user write lock. Across processes/machines
the lock does not apply — and since migrations are idempotent under the `user_version` gate, the
correct response to a CAS refusal on the migration path is re-pull-then-retry-once. Until sessions
are pinned to one machine ([[project_fire_and_forget_deferred]]), assume the cross-machine shape is
reachable.

### 4. A related false-conflict class was upstream of the CAS guard, not inside it (T5081)

**Corrected 2026-08-29, twice (T5081 implementation, expert design review + reviewer catch):** this
section originally proposed a clean/dirty discriminator at the CAS refusal site in `storage.py`, on
the theory that 2026-08-04 was "a read-only warmed copy against a healed R2 copy" — i.e. a case with
nothing to arbitrate. That diagnosis was wrong, and the fix built on it does not work. A first
correction pass then over-corrected the other way, crediting T5081's actual fix as "the true
mechanism behind the 2026-08-04 incident" — also wrong, caught in review: the incident's own log line
(`method=GET`) rules that out, since `retry_pending_sync` only ever runs on a WRITE request
(`WRITE_METHODS` gate, `db_sync.py`). Both corrections are folded in below.

- **What 2026-08-04 actually was: finding 1 above, full stop.** The out-of-band T5830 heal moved R2
  to v2866 while the long-lived uvicorn process's in-memory `_user_db_versions` cache stayed at v2865
  (`get_local_db_version` prefers the cache over the file). The first post-login request's own
  `_background_sync` → `sync_db_to_r2_explicit` (NOT `retry_pending_sync`, which never runs on a GET)
  refused the CAS check against that stale in-memory baseline — a real, correct refusal, because the
  local copy genuinely was dirty (session-init's `archive_completed_projects` had just written to it)
  and genuinely was behind R2. Nothing in T5081 touches this path or would have changed that outcome.
- **What T5081 actually fixes: a DIFFERENT, real defect found while investigating the incident, not
  its cause.** `.sync_pending` was the one marker T6390 never scoped per-DB — it stayed a single
  per-USER file while `.sync_conflict`/`.sync_failed` were already split per scope. So
  `retry_pending_sync` (which DOES run on a later WRITE request once something is marked pending)
  read "the user has *something* pending" and re-uploaded BOTH profile.sqlite and user.sqlite
  unconditionally (a plain file-exists check, not "does THIS db have anything pending") — a write to
  user.sqlite alone made the retry also re-attempt a profile.sqlite that had nothing queued, and if
  R2 had moved ahead there for any unrelated reason, that re-upload would trip a real CAS conflict
  against a copy with nothing to arbitrate. This is a genuine, separate false-conflict class; it does
  not require 2026-08-04 to justify fixing.
- **The fix** finishes T6390's scoping for `.sync_pending` (same per-scope marker files, gate
  `retry_pending_sync`'s branches on `has_sync_pending_scope` for that db, retry EVERY pending profile
  of the user rather than only the caller's own) instead of adding a discriminator to the CAS
  primitive. No `storage.py` changes; migrations-path retry-once logic belongs to **T5083** (which has
  the migration-runner context needed to safely re-apply, not this primitive).
- **Implementation grew past the initial scoping** (5 further review rounds, 2026-08-29/30): the
  per-scope marker is a DURABILITY record (INV-P), so every place that CLEARS it needed the same
  compare-and-clear discipline the upload path already had — first for uploads (a marker must not be
  discharged if a newer write re-marked the scope mid-upload), then, less obviously, for RESTORES too
  (a CAS conflict's re-pull can equally race a concurrent write, and — the harder-won finding — the
  restore that actually discharges a marker is very often NOT the conflict-retry endpoint itself but
  an ordinary unrelated request that happens to trigger the same first-access re-pull first). The
  shipped design clears `.sync_pending` at every site that performs a real restore-if-newer swap
  (`ensure_database`, `ensure_user_database`, `ensure_user_database_fresh`,
  `materialization.ensure_profile_db_local`, `migrations._migrate_profile_db`), never at a caller
  guessing whether it was the one that just restored. See
  [T5081](T5081-clean-copy-conflict-self-heal.md)'s progress log for the full round-by-round record.

### 5. The non-login writer list is concrete (T5085)

JIT only covers profiles whose owner comes online. These reach a profile DB with no login and each
needs a stated policy — call the JIT routine before touching, or tolerate every schema version
forever: expiry sweep; share-page materialization; export worker / Modal completion callbacks;
admin grants and payment webhooks (the T4315 restore-if-newer path). If any is left on "tolerate",
the PRAGMA-window guard pattern (T5630) becomes a **permanent** requirement for that path — a
legitimate choice, but a stated one.

### 6. Deploy skew becomes additive-only

During a rolling deploy a user logging into the new machine migrates their DB to head while the old
machine may still serve them. Additive migrations survive that; renames/drops do not. T5070's gate
blocks the stale *client*, not a stale backend instance.
