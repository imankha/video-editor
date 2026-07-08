# T4820: Expired-source games wrongly compute 'active' (bug 27p/29p) — data repair + root cause

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Priority:** P1
**Created:** 2026-07-08
**Updated:** 2026-07-08
**Bugs:** prod 27p (2026-06-30), prod 29p ("BUG STILL PRESENT", 2026-07-06)

## Problem (reported by sarkarati)

Annotation playback video fails to load for games whose source video has expired. Bug 27p
was fixed on 2026-07-04 (`4b6f5bff`, graceful "Source video expired" panel) and deployed to
staging + prod. Bug 29p re-reported it **still present** on 2026-07-06.

## Investigation (done 2026-07-08) — the fix is correct; the DATA is wrong

The 27p fix is deployed on both envs (verified: prod bundle `AnnotateScreen-*.js` contains
"Source video expired"; backend on prod since Jul 4 22:29, re-deployed Jul 6 07:37). 29p was
filed on a **stale June-25 build** (`72ef4e8c`) **and** against genuinely corrupt data. Even a
fresh build fails on the affected games.

### Root cause: v017 backfill resurrected a future expiry on already-deleted sources

`_compute_storage_status(expires_at, auto_export_status)` ([games.py:1772](../../../src/backend/app/routers/games.py#L1772))
returns `'expired'` only when `game_storage.storage_expires_at` is in the past, OR when there
is no storage row AND the game was auto-exported. It returns `'active'` for a **future**
expiry.

`v017_backfill_missing_storage_refs.py` (bug26p heal) computes a **fresh future expiry**
(`storage_credits.storage_expires_at()` = now + retention) and stamps it onto **every**
`status='ready'` game missing a `game_storage` ref — with **no check that the R2 source
`games/{blake3}.mp4` still exists**. It was meant to heal games that lost their ref to the
activate() crash (sources present). But it **resurrected a future expiry on games whose
sources the sweep had already grace-deleted** → those now compute `'active'` forever → the
expired panel never fires → the frontend mounts a `<video>` against a 404 source → 29p.

### Structural crack that lets it persist (two unsynchronized stores)

The sweep deletes the R2 object in Phase 2 ([sweep_scheduler.py:160-167](../../../src/backend/app/services/sweep_scheduler.py#L160))
but **never writes back** to profile `game_storage.storage_expires_at`. The sweep's expiry
truth (Postgres `game_ref_counts` + grace-deletion) and the status truth read by
`_compute_storage_status` (profile `game_storage.storage_expires_at`) are separate stores that
can diverge. Sole writer of that column: `auth_db.insert_game_storage_ref`
([auth_db.py:328-353](../../../src/backend/app/services/auth_db.py#L328)).

### Blast radius (prod, read-only scan 2026-07-08): 7 games / 3 users

Games computing `'active'` whose R2 source object(s) are actually 404:

| user_id (prefix) | game(s) | storage_expires_at | flavor |
|---|---|---|---|
| aee3e218 (sarkarati) | 1, 3, 4, 6 | `2026-07-29T05:11:08.620020` | v017 bulk-stamp |
| f05d1b29 | 1 (×2 profiles) | `2026-07-29T05:11:05/06` | same backfill run (~3s earlier) |
| 1b842983 | 5 'FRAM' | `None` (aes `None`) | never tracked — no storage row, source gone |

Controls (sources present, correctly 'active'): sarkarati games 5, 7. Scan covered all 16
profile DBs / 10 users. Source-existence check: `head_object games/{blake3}.mp4` in
`reel-ballers-users`, **s3v4 signature + region_name='auto'** (else R2 returns 400 not 404).

## Fix (user decisions 2026-07-08: all-users repair + root cause)

### Part 1 — data-repair migration (profile_db, all users) — READY, no design needed

For every game that computes `'active'` but whose R2 source object(s) are missing, force it to
compute `'expired'` by stamping a **past** `game_storage.storage_expires_at` (INSERT a row when
none exists, e.g. game 5). Verify **actual R2 state** per game (`head_object`, s3v4+auto) — do
not guess from timestamps. This is the "correct the data" approach, not a read-time fallback.

- New versioned migration `profile_db/v0NN_repair_sourceless_active_games.py`.
- Migration `up(conn)` gets a **tuple** row factory — index positionally, never by column name
  (see [[reference_migration_runner_rowfactory]] / T4110 prod crash).
- Idempotent + safe to re-run. Log per-user how many games were repaired.
- Run on prod via the admin migrate endpoint after deploy (migrations do NOT auto-run).

### Part 2 — root cause (backend) — NEEDS the design doc + approval

Design gate: `docs/plans/tasks/T4820-design.md`. Recommended shape:
1. **Sweep Phase-2 delete writes a past `storage_expires_at` back to profile `game_storage`**
   so the status store stays truthful the moment a source is deleted (closes the divergence at
   the source).
2. **Guard the ref-heal path** (v017-style backfill + activate self-heal) to **skip games whose
   R2 source is confirmed gone**, so it can never resurrect a future expiry again.

## Acceptance criteria

- [ ] After the repair migration, opening any of the 7 identified games in Annotate shows the
      "Source video expired" panel (no `<video>` mount, Playback Annotations disabled, clips
      still listed) — verified against sarkarati's account (game 4) and the 1b842983 game 5
      never-tracked variant.
- [ ] `_compute_storage_status` returns `'expired'` for every game whose source object is
      absent in R2; controls (games 5, 7) stay `'active'`.
- [ ] The repair migration is idempotent (re-run changes nothing) and correct under the tuple
      row factory (tested with real rows, not just empty/early-return).
- [ ] Root cause: after a sweep Phase-2 delete, the game's profile `game_storage.storage_expires_at`
      is in the past (status = expired) — a fresh sweep no longer leaves an active-but-sourceless game.
- [ ] Root cause: the ref-heal path does not stamp a future expiry on a game whose R2 source is
      already gone (regression test with a deleted-source fixture).
- [ ] Backend tests (`test_game_load.py` storage_status cases) extended; `from app.main import app` clean.

## Context / relevant files

- `src/backend/app/routers/games.py` — `_compute_storage_status` (1772), `load_game` (~2205), `list_games` (~918).
- `src/backend/app/services/sweep_scheduler.py` — Phase-2 R2 delete (160-167).
- `src/backend/app/services/auth_db.py` — `insert_game_storage_ref` (328), sole writer of `storage_expires_at`.
- `src/backend/app/migrations/profile_db/v017_backfill_missing_storage_refs.py` — the offending backfill.
- Frontend expired panel (already shipped, do not rebuild): `AnnotateModeView.jsx` (~432), `useAnnotateState.js` (`annotateSourceExpired`), `AnnotateContainer.jsx`.
- Read-only scan + R2 head pattern: this task's investigation (scratchpad); reuse s3v4+region='auto'.

See [[project_bug29p_v017_resurrection]] for the full investigation trail and
[[project_bug26p_silent_upload_failure]] / [[project_v017_migration_rowfactory_bug]] for prior context.
