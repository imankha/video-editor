# T14140 Design: expiry sweep selects candidates from Postgres

Status: AWAITING APPROVAL. Tier L. Task file: [T14140-expiry-sweep-from-postgres.md](T14140-expiry-sweep-from-postgres.md).
Knowledge: persistence-sync.md, backend-services.md.

## 1. Current state

`do_sweep()` (`src/backend/app/services/sweep_scheduler.py`):

```
for user in get_all_users_for_admin():              # every user
    profile_ids = _get_profile_ids(user)            # 1 R2 ListObjectsV2 each
    for profile in profile_ids:
        ensure_database()                           # GET profile.sqlite + JIT migrate
        get_expired_refs_for_profile()              # SQLite: storage_expires_at < now
        ... export / verdict / delete_ref / insert_grace_deletion
Phase 2, per grace-expired hash:
    _count_refs_all_profiles(hash, every profile)   # local SQLite, "Phase 1 downloaded it"
    _phase2_artifact_gate_missing(hash, every profile)
    r2 delete; _expire_game_storage_all_profiles(hash, every profile)
```

The cost is O(users): one ListObjectsV2 per user per run, plus a download and migration of
every profile. That works against the long-tail rule (idle accounts migrate only when their
owner comes back).

Phase 2's irreversible-delete gate gets its safety from that full walk: it reads every
profile's SQLite `game_storage`, which is the source of truth.

## 2. The mirror, and where it is not complete

Postgres `game_storage_refs` holds one row per (user_id, profile_id, blake3_hash) with
`storage_expires_at` (T6770). Indexes: `idx_game_refs_hash`, `idx_game_refs_user`.

For a PG-driven sweep, the safety invariant is:

> **INV-M: every SQLite `game_storage` row has a PG row for the same (user, profile, hash).**
> Equivalently, a profile with no PG row for H holds no ref to H.

A PG-only row is safe: the sweep opens a profile that has nothing to do, and Phase 2 defers.
A SQLite-only row is the dangerous case. Phase 1 never sees it (storage leak only). Phase 2
can delete a video that this profile still holds a LIVE ref to (data loss, the imankh games
2/3/5 class).

An audit of every `game_storage` writer found these INV-M gaps:

| # | Gap | Direction | Status |
|---|-----|-----------|--------|
| G1 | Profiles below profile_db v047 have SQLite rows but no PG rows (v025 cleared PG; v047 is the JIT backfill). | SQLite-only | Only closed for profiles the walk has migrated. The walk skips a `MigrationBlocked` profile. |
| G2 | Ordering race: postgres v025 (admin, at deploy) wiping rows from a profile that already passed v047 JIT. | SQLite-only | Unknown. Only measurement can rule it out. |
| G3 | `insert_game_storage_ref` commits SQLite first, then PG. A crash or PG error in between leaves a SQLite-only row. | SQLite-only | Open. |
| G4 | `materialization.py` (share/claim): SQLite upsert, commit and R2 sync (~986-1041), then PG (~1055). A PG failure leaves a durable SQLite-only LIVE row. | SQLite-only | Open. |
| G5 | `delete_ref`: SQLite delete (not synced), then PG delete. A crash leaves R2's copy with the row and PG without it. | SQLite-only | Narrow. The row is the expired one being reclaimed, or belongs to a user-deleted game. |
| G6 | `profiles.delete_profile` never deletes the profile's PG rows. | PG-only (orphans) | Safe for deletes, but an orphan with a past expiry keeps `get_next_expiry()` in the past, so the hourly KEPT retry runs forever. A PG-driven sweep would also `ensure_database()` a deleted profile and resurrect it locally (NOT_FOUND creates a fresh DB). |
| G7 | `expire_game_storage` (Phase 2 belt-and-braces) is SQLite-only and sets a past expiry. | PG says live, SQLite says expired | Safe. |

Other writers were checked and pair correctly: `insert_game_storage_ref`'s callers
(activate, heal `_ensure_game_storage_refs`, extension at games.py ~2218), v017 (pre-v047),
`_purge_user_data` (deletes PG rows by user_id).

## 3. Target state

```
Phase 1:
  pairs = PG: SELECT DISTINCT user_id, profile_id FROM game_storage_refs
              WHERE storage_expires_at <= now()
  for (user, profile) in pairs:
      if not r2 HEAD {env}/users/{u}/profiles/{p}/profile.sqlite:   # Class B, not a list
          log WARNING orphan; skip             # never ensure_database a missing profile (G6)
      ensure_database()  (JIT seam; MigrationBlocked -> skip, as today)
      get_expired_refs_for_profile()           # SQLite stays the DECISION authority
      ... unchanged export / verdict / delete_ref / grace logic ...

Phase 2, per grace-expired hash H:
  holders = PG: SELECT DISTINCT user_id, profile_id FROM game_storage_refs WHERE blake3_hash = H
  if holders:                                   # a ref came back since queueing
      SQLite-check each via the JIT seam (open it, not "assume local"):
          live -> cancel grace (as today); indeterminate -> defer (as today)
  artifact gate (D5): over holders + the profile that QUEUED H (see D3)
  r2 delete; expire_game_storage over holders only
```

The sweep no longer lists R2 or calls `get_all_users_for_admin`. It opens only profiles with
an expiring PG ref, plus Phase 2 holders. An idle profile with nothing expiring is never opened,
so it never migrates. An idle profile that does have an expiring game is opened and migrated.
That can't be avoided, because exporting its recap needs the DB.

### Structural fixes that make INV-M hold going forward (same task)

- **G3 and G4, PG-first ordering.** `insert_game_storage_ref` and materialization write the PG
  row BEFORE the SQLite row. A failure in between now leaves a PG-only row, which is the safe
  direction. A side effect: the PG upsert's `DELETE FROM r2_grace_deletions` cancels a pending
  grace delete earlier. (`upsert_game_storage_row`'s MAX keeps PG and SQLite expiries
  monotone in both orders.)
- **G6.** `delete_profile` deletes that profile's `game_storage_refs` rows (a keyed DELETE, like
  `_purge_user_data`).
- **G5.** Accepted as-is, documented. Reversing it (PG delete after SQLite sync) doesn't help:
  the row is expired, and Phase 2 only cares about LIVE refs.

### Schema (Postgres track)

- `idx_game_refs_expires ON game_storage_refs(storage_expires_at)`: Phase 1 selection, and the
  existing `get_next_expiry()` MIN. Postgres migration `v0NN` plus `_SCHEMA_DDL`.
- D3 option A only: nullable `queued_by_user_id`, `queued_by_profile_id` on `r2_grace_deletions`.

## 4. Mirror-completeness proof plan (gate before the flip ships to prod)

The delete is irreversible, so INV-M is MEASURED on prod, not argued:

1. **`scripts/audit_game_storage_mirror.py --env <dev|staging|prod>`** (new, read-only). For each
   user it lists R2 profiles once, downloads each `profile.sqlite` into a temp dir (never
   USER_DATA_BASE, never uploaded, never migrated), and reads `PRAGMA user_version` and
   `game_storage`. It diffs the result against PG `game_storage_refs`. Report:
   - SQLite-only rows, split into LIVE and expired. **Any LIVE SQLite-only row means exit 1.**
   - profiles below v047 (G1), and blocked or unreadable profiles (counted as failures, never as clean)
   - PG-only rows, and orphan rows whose profile.sqlite is NOT_FOUND (G6 cleanup list)
   - expiry disagreements (G7 class, informational)

   Out-of-process is safe here because the script never writes R2 or a live DB. The
   CLAUDE.md hazard is a separate process that MIGRATES or UPLOADS.
2. **Repair, if the audit finds gaps.** SQLite-only rows go back into PG through
   `--repair` (`insert_game_storage_ref_pg_only`, idempotent, GREATEST expiry). Then the audit is
   re-run until it is clean. Orphan PG rows are deleted by the same flag, only for profiles R2
   confirms NOT_FOUND. Repair stays opt-in and prints a dry-run first.
3. **Order:** the audit runs clean on prod, then prod deploy. The audit happens AFTER the
   PG-first ordering fix is live, so no new G3/G4 rows can appear behind it. The run is a
   `human_checks` entry: no R2/PG creds in the container. Results are recorded in
   `docs/plans/T14190-load-test-results.md`'s neighbour section, or in this doc.

Not proven by this plan: a G3/G4 row written between the audit and the deploy by the OLD code.
That gap is closed by deploying the ordering fix first (see D1).

## 5. Decisions needing your call

**D1: rollout shape.**
- **A (recommended): two deploys.** Commit 1 ships the ordering fixes, G6, the index and the
  audit script, with the sweep unchanged. You deploy and run the audit (plus repair) on prod.
  Commit 2 flips the sweep to PG selection. Both commits are in this branch, but commit 2 must not
  reach prod until the audit is clean. This closes the window above.
- B: one deploy, with the audit run on prod just before it. This leaves the window above open
  (small, because it needs a crash mid-write).
- C: shadow mode. The walk stays authoritative and the PG candidate set is computed alongside;
  diffs are logged CRITICAL, and the flip comes in a later task after N clean prod sweeps. This
  is the most conservative option, but the O(users) cost stays for that period, and it only
  compares EXPIRED rows. The audit is a strictly stronger check.

**D2: orphan PG rows (deleted profile) found by the sweep.** Recommended: skip and log WARNING;
never delete rows from inside the sweep. Cleanup is the audit's `--repair`, and new orphans
stop because of the G6 fix. Alternative: the sweep deletes them after a NOT_FOUND HEAD. That is
simpler, but it is a sweep-driven Postgres delete based on a single R2 response.

**D3: Phase 2 artifact gate (T10121 D5).** Today it walks every local profile for games on H
whose ref is already gone. With PG selection, nothing records which profiles once held H.
- **A (recommended):** record `queued_by_{user,profile}` when Phase 1 queues the grace row, and
  re-run the artifact gate (and `_abandon_if_exhausted`) on that profile plus any holders.
  Rows queued before this column existed (NULL) are deferred and logged once, never deleted
  blind. The audit reports how many exist.
- B: drop the walk and rely on Phase 1's gate, which already passed when the row was queued.
  Less code, but it loses the re-check of artifacts deleted during the 14-day grace.

## 6. Tests (failing first)

`tests/test_t14140_sweep_pg_candidates.py`:
- 10K synthetic users in PG (`users` plus `game_storage_refs`, `@loadtest.invalid` style ids),
  3 with an expired ref. `do_sweep` calls `ensure_database` exactly 3 times, and
  `_get_profile_ids` / `get_all_users_for_admin` 0 times. (Red today: 10K list calls.)
- Idle profile with no expiring ref: never opened, `user_version` unchanged.
- ListObjectsV2 count under `R2Source.SWEEP` (T13930 counter) is 0 and independent of user count.
- Orphan PG ref (HEAD NOT_FOUND): `ensure_database` not called, no local DB created, WARNING logged.
- Phase 2: a hash with a PG holder whose SQLite ref is LIVE gets the grace row cancelled, and the
  holder is opened via the seam even when it is not local (regression for the "assume Phase 1
  downloaded it" assumption).
- Ordering: PG failure inside `insert_game_storage_ref` leaves no SQLite row. In materialization,
  a PG failure happens before the SQLite write.
- `delete_profile` removes the profile's PG refs.
- Audit script: SQLite-only LIVE row means exit 1; clean means exit 0.

Regression set: `test_sweep_scheduler.py` (its mocks move from `_get_profile_ids` to the PG
selector), `test_t13930_sweep_source.py`, the T6770/T8370 ref tests, and the materialization ref tests.

## 7. Risks

- Phase 1 now trusts PG for WHICH profiles to look at. A SQLite-only expired row is never swept,
  which leaks storage, not data. The audit measures this.
- Phase 2 now trusts PG for WHO holds H. That is exactly INV-M, so it is gated by §4.
- `get_next_expiry` behaviour is unchanged. Orphans stop pinning it once they are cleaned up (G6).
- Size: roughly 6 to 8 files (sweep_scheduler, auth_db, materialization, profiles router, pg.py
  plus a migration, the new script, tests). That is about 250 to 350 LOC of meaningful diff, so
  D1-A's two commits also keep each one reviewable.
