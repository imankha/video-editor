# T5086: `clear_stale_wal_sidecars` can unlink a live connection's WAL on Linux

**Status:** STAGING (merged to master 2026-09-02, commit 8ad2686e; reviewer APPROVED 0 blocking, 51/51 relevant tests green)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-31
**Updated:** 2026-08-31

Not part of the JIT Migration epic's strict child order — a narrow correctness finding surfaced
while implementing T5085, filed separately rather than folded in (needs its own test, changes
T5083-owned behavior). Picked up whenever convenient; does not block T5087/T5089.

## Problem

`migrations.run_profile_seam`/`run_user_seam`'s `wal_busy` retry path calls
`services.db_refresh.clear_stale_wal_sidecars(db_path)`, which unlinks the `-wal`/`-shm` files.
This is safe when the sidecars are genuinely stale (a crash left them, no connection holds the
file). It is **not** safe when another connection is genuinely live:

- **Windows** (what our test suite runs on): `unlink()` on a file another process/handle holds
  open fails with `WinError 32` — the retry then correctly falls through to `wal_busy` again and
  raises `MigrationBlocked`. This is why the hazard doesn't show up in CI today.
- **Linux (production, Fly.io)**: POSIX `unlink()` on an open file succeeds silently. The live
  connection keeps writing to the now-unlinked inode while the seam's retry creates a *fresh*
  `-wal` next to the main file. That is the exact cross-DB page-mixing hazard
  `clear_stale_wal_sidecars`'s own docstring warns about (T4310/T4315 origin) — inverted: instead
  of protecting against it, this specific call path can *cause* it.

T5085's WAL-concurrency fix (the `_seam_at_head` short-circuit in `migrations/__init__.py`)
substantially **reduces** how often this is reachable — it now only fires when a DB is
**genuinely below head** *and* concurrently held open, not on every busy-but-current profile. It
does not close the hole for the case that remains.

## Proposed fix (from the T5085 expert-agent investigation, not yet implemented)

A cheap, verified discriminator between "stale, safe to clear" and "live, must refuse":

```python
# sqlite3.connect(path, timeout=0.2) -> PRAGMA locking_mode=EXCLUSIVE -> BEGIN IMMEDIATE
# success            -> no other connection holds the file (a clean close removes the
#                        sidecars by itself; the unlink becomes largely redundant)
# OperationalError:
#   "database is locked" -> a connection genuinely holds it -> refuse, return wal_busy
```

Verified empirically during the T5085 investigation (Windows): `BEGIN IMMEDIATE` under
`locking_mode=EXCLUSIVE` reliably distinguishes a live writer from stale-but-unheld sidecars.

## Scope

- `src/backend/app/services/db_refresh.py` — `clear_stale_wal_sidecars` (or a new sibling used
  specifically by the migration-seam retry path — decide whether ALL callers of
  `clear_stale_wal_sidecars` want this guard, or only the seam's).
- New test proving the discriminator on both branches (live connection -> refuse; genuinely
  stale sidecars with no connection -> clear proceeds). Windows CI cannot exercise the "unlink
  while open succeeds" failure mode directly (the OS refuses it), so the test must assert the
  *discriminator's* behavior, not the unlink outcome.
- This changes T5083-owned behavior (the seam's WAL retry), not T5085's — review accordingly.

## Acceptance Criteria

- [ ] `clear_stale_wal_sidecars` (or the seam's retry call site) never unlinks a live connection's
      sidecars, verified by a test that doesn't depend on OS-specific unlink semantics
- [ ] Genuinely stale sidecars (no live connection) still clear as before — no regression
- [ ] `.claude/knowledge/persistence-sync.md` updated with the corrected mechanism
