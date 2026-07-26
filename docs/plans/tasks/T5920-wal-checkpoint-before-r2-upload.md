# T5920: R2 uploads can ship an under-checkpointed SQLite file at a bumped version (systemic WAL hazard)

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-07-25
**Epic:** sibling of [durability-sync](durability-sync/EPIC.md) — same silent-data-loss class

## Problem

Found by the T4315 round-3 review (2026-07-25), scoped out of that branch as a **systemic** issue.

Every per-user SQLite DB is replicated to R2 by uploading **the main file only**
(`client.upload_file(local_db_path, ...)`). SQLite in WAL mode keeps committed-but-uncheckpointed
transactions in the `-wal` sidecar, and it auto-checkpoints on **last connection close**. So:

> If ANY other connection to that DB is open when the sync runs, the auto-checkpoint never fires,
> the upload ships bytes that do **not** contain the recent commits — **and the version metadata is
> bumped anyway**.

This is **worse than not syncing at all**. Once R2 holds stale content at a *newer* version:
- every other machine's restore-if-newer (T4315) sees `local >= r2` and never re-pulls;
- the upload-side CAS (T4310) treats that stale copy as authoritative;
- any bookkeeping that recorded success (e.g. a Postgres "materialized" mark) never retries.

The write is silently and permanently lost, with a version counter that says everything is fine.

### Evidence (reproduced during the T4315 review)

With one extra connection holding an open read snapshot on the recipient's `profile.sqlite`:

```
UPLOADED VERSION META: {'db-version': '1'}
GAMES IN UPLOADED OBJECT: 0        <-- stale bytes, stamped at the NEW version
mark_game_share_materialized: called
```
and the isolated SQLite behaviour: `PRAGMA wal_checkpoint(TRUNCATE)` -> `(1, 3, 2)` after ~32s
(`busy=1`, i.e. it **did not** checkpoint, and it does **not** raise).

### Scope: only the shutdown handler checkpoints today

`wal_checkpoint` appears in exactly **two** places in the codebase — `main.py:337` and `main.py:380`,
both in the shutdown handler (which exists precisely because this is required). **No request-path,
worker, or migration sync checkpoints before uploading.** Roughly 18 call sites are exposed:

- `middleware/db_sync.py` — end-of-request profile + user sync (**the highest-traffic path**)
- `services/export_helpers.py`, `services/export_worker.py`, `services/auto_export.py`
- `services/poster.py`, `services/sweep_scheduler.py`
- `routers/payments.py` (webhook grants), `routers/profiles.py` (create)
- `migrations/__init__.py` (post-migration re-upload)
- `services/materialization.py` — **partially fixed by T4315**; that call site checkpoints, and
  T4315 round-4 additionally refuses when the checkpoint reports `busy`. Use it as the reference
  implementation.

## Solution direction (confirm at design)

The fix is NOT "call `wal_checkpoint` everywhere and hope" — the reproduction above shows a contended
checkpoint **returns `busy=1` without raising**, so an unchecked call silently does nothing.

1. **Checkpoint inside the upload primitive, not at each call site.** Put it in the one place that
   does the upload (`storage.py`'s `sync_*_to_r2_with_version`) so no future caller can forget.
2. **Treat a busy checkpoint as a failed sync** — do NOT upload, do NOT bump the version, return the
   existing failure/conflict state so the caller's retry path takes over. Losing loudly beats
   uploading stale bytes at a newer version.
3. **Do not sit on the 30s `busy_timeout`.** `_open_profile_db` sets `PRAGMA busy_timeout=30000`; a
   contended checkpoint therefore blocks the full 30s per attempt (T4315 hit ~150s for a 5-recipient
   share). Use a short timeout for the checkpoint specifically.
4. **Consider closing before uploading where practical.** Most callers already close first (e.g.
   `auto_export.py` syncs after its `with get_db_connection()` block exits) — those are safe today.
   An audit should record which call sites hold a connection open across the sync.
5. **Serialization option:** reuse the existing per-user upload lock so a sync never races a writer,
   rather than only detecting the race.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/storage.py` — `sync_database_to_r2_with_version` / `sync_user_db_to_r2_with_version`, the `upload_file` calls
- `src/backend/app/middleware/db_sync.py` — end-of-request sync (highest traffic)
- `src/backend/app/services/materialization.py` — T4315's checkpoint + busy-refusal reference
- `src/backend/app/main.py:337,380` — the only existing checkpoints (shutdown)
- `src/backend/app/database.py` — `_open_profile_db` / connection pragmas (`busy_timeout=30000`, `journal_mode=WAL`)

### Related
- **T4310** (CAS upload) — makes this worse in one specific way: a stale-content-newer-version copy is exactly what CAS then trusts
- **T4315** (restore-if-newer) — fixed only the `materialize_game_share` call site; this task generalizes it
- Durability epic: `tasks/durability-sync/EPIC.md` — same "committed write silently destroyed" class

## Acceptance Criteria

- [ ] No R2 upload can ship an under-checkpointed SQLite file — enforced in the upload primitive, not per call site
- [ ] A checkpoint that reports `busy` fails the sync loudly (no upload, no version bump) and stays retryable
- [ ] No 30s-per-attempt stall; contended checkpoints fail fast
- [ ] Audit recorded: which of the ~18 sync call sites hold a connection open across the sync
- [ ] Regression test: hold an open connection on the DB, commit a change, run the sync, and assert
      EITHER the uploaded object contains the change OR the sync refused — never "uploaded stale
      bytes at a bumped version". Must go red if the guard is removed.
- [ ] The highest-traffic path (`middleware/db_sync.py` end-of-request sync) is covered
- [ ] `.claude/knowledge/persistence-sync.md` documents the hazard and the guarantee
