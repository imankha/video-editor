# T5920 — WAL checkpoint before R2 upload (design)

**Task:** `docs/plans/tasks/T5920-wal-checkpoint-before-r2-upload.md`
**Tier:** L (design-gated). **Layer:** Backend only. **No schema change.**
**Branch:** `feature/T5920-wal-checkpoint-before-r2-upload` (off `origin/master`).

## Problem (one line)

Every per-user SQLite DB is replicated to R2 by uploading **the main file only**. In WAL mode,
committed-but-uncheckpointed transactions live in the `-wal` sidecar and are flushed to the main
file only on last-connection-close. If any other connection holds the DB open when a sync runs, the
upload ships **pre-commit bytes at a bumped version** — permanently and silently losing the write,
because every downstream guard (T4315 restore-if-newer, T4310 CAS, Postgres "materialized" marks)
then trusts that stale-content-newer-version copy.

## Root-cause specifics that constrain the fix

1. **`PRAGMA wal_checkpoint(TRUNCATE)` does not raise on contention.** It returns
   `(busy, log, checkpointed)`; `busy=1` means it did *nothing* and left frames in the WAL. An
   unchecked checkpoint is a silent no-op — "checkpoint everywhere" is NOT the fix.
2. **`_open_profile_db` / `get_db_connection` set `busy_timeout=30000`.** A contended checkpoint on
   an inherited timeout blocks the full 30s per attempt (T4315 measured ~150s for a 5-recipient
   share). The checkpoint needs its **own short timeout**.
3. **The only two `wal_checkpoint` calls today are `main.py`'s SIGTERM shutdown handler.** No
   request-path / worker / migration sync checkpoints before uploading. `materialization.py`
   (T4315 round 4) is the sole reference implementation and it lives at the call site, not the
   primitive.

## Current state

```
caller (worker / middleware / webhook / migration)
  └─> sync_db_to_r2_explicit(user_id, profile_id)          [database.py]  ── maps (bool,int|None) → SyncResult
        └─> sync_database_to_r2_with_version(...)           [storage.py]   ── the upload PRIMITIVE
              1. exists? client? 
              2. CAS: HEAD R2 version; refuse (False, r2_version) if R2 newer / unconfirmed  → CONFLICT
              3. client.upload_file(local_db_path, ...)  ← UPLOADS MAIN FILE ONLY, no checkpoint
              4. return (True, new_version)
```
Same shape for `sync_user_db_to_r2_explicit` → `sync_user_db_to_r2_with_version`.

Return contract (unchanged, do NOT add a 4th state):
`(True, v)`→`OK` · `(False, r2_version)`→`CONFLICT` (frozen baseline, `.sync_conflict`) ·
`(False, None)`→`FAILED` (transient, `.sync_pending` stays, existing Retry UX).

## Target state

Insert a **checkpoint-or-refuse guard inside both upload primitives**, after `new_version` is
computed (so it covers BOTH the CAS path and the `skip_version_check=True` path) and immediately
before `client.upload_file`:

```
sync_database_to_r2_with_version / sync_user_db_to_r2_with_version:
  ... compute new_version (CAS branch or skip branch) ...
  if not _checkpoint_wal_or_refuse(local_db_path):     # NEW — shared helper
      return False, None          # ← (False, None) ⇒ SyncResult.FAILED, retryable, NO version bump
  key = ...
  client.upload_file(local_db_path, ..., Metadata={"db-version": str(new_version)})
```

New shared helper in `storage.py` (single source, greppable, no per-caller opt-in):

```python
def _checkpoint_wal_or_refuse(local_db_path: Path) -> bool:
    """Flush the -wal into the main file before it is uploaded. Returns True if the main
    file is now current (safe to upload), False if the WAL could not be checkpointed
    because another connection holds the DB open (busy) — caller must refuse the upload.

    PRAGMA wal_checkpoint(TRUNCATE) does NOT raise on contention; it returns
    (busy, log, checkpointed). busy=1 ⇒ frames still in the WAL ⇒ the main file is stale ⇒
    refuse rather than ship stale bytes at a bumped version (T5920)."""
    conn = sqlite3.connect(str(local_db_path), timeout=0)
    try:
        conn.execute("PRAGMA busy_timeout=2000")          # fail fast, NOT the inherited 30000
        busy, _log, _ckpt = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            logger.critical(
                f"[SYNC_CHECKPOINT_BUSY] {local_db_path} — WAL in use, refusing upload "
                f"(would ship stale bytes at a bumped version) machine={FLY_MACHINE_ID}")
            return False
        return True
    except Exception as e:
        logger.error(f"[SYNC_CHECKPOINT] error checkpointing {local_db_path}: {e}")
        return False        # unknown state ⇒ refuse (retryable) rather than risk a stale upload
    finally:
        conn.close()
```

Notes:
- Opens a **fresh** connection to `local_db_path`. A fresh connection can checkpoint frames committed
  by other *idle* connections (WAL is shared), so the common single-writer case (writer already
  closed — the vast majority per the audit below) yields `busy=0` and a correct upload. Only a
  concurrent **open read snapshot / active transaction** on the same file forces `busy=1` → refuse.
- `TRUNCATE` (matches the T4315 reference) also zeroes the `-wal` sidecar, keeping the file clean.
- Works identically for profile.sqlite and user.sqlite (both are plain WAL files uploaded by path).

## Design-gate decisions (bring to user)

### 1. Where the guard lives — **the upload primitive** (both `sync_*_to_r2_with_version`)
Confirmed correct for BOTH DB kinds (profile + user): both primitives receive a `local_db_path` and
call `client.upload_file` on it, so one helper before that call covers every path. Placed after
`new_version` is computed so it also covers the two `skip_version_check=True` request-thread callers
(profile-create, payments webhook). **No caller legitimately needs to bypass it** — the whole point
is that no future caller can forget (per the task). The shutdown handler's two existing pre-checkpoints
(`main.py:337,380`) become redundant; recommend deleting them (single source of truth) — optional,
harmless if left (a second checkpoint of an already-flushed file is a no-op).

### 2. What a refusal returns — **`SyncResult.FAILED` (retryable), NOT a 4th state**
`(False, None)` → existing `FAILED` mapping in `sync_db_to_r2_explicit` / `sync_user_db_to_r2_explicit`.
A busy checkpoint is **transient** (clears when the other connection closes), so it must be FAILED
(retry on next write via `.sync_pending`), NOT `CONFLICT` (which freezes the baseline and expects a
restore-if-newer to heal). **No version bump** — guaranteed because we `return` before computing the
key / uploading, so `set_local_db_version` is never reached and the baseline stays put. This composes
with T4310's 3-state contract and the existing failed-sync/Retry UX with zero new vocabulary.

### 3. Checkpoint `busy_timeout` — **2000ms** (matches T4315 reference)
Explicitly set on the checkpoint's own connection so it never inherits the 30000ms default. Fail fast:
under contention we refuse after ≤2s and let Retry take over, rather than stalling a request/worker
for 30s (or ~150s aggregated).

### 4. Serialization option (reuse the write lock so a sync never *races* a writer) — **OUT**
Rejected, because it does not eliminate the race and reintroduces a known regression:
- The dominant source of checkpoint contention is a concurrent **reader** (WAL reads are lock-free by
  design). The per-user *write* lock (T1531) would not stop a reader from pinning the WAL, so the race
  survives — we would still need detect-and-refuse anyway.
- Holding the write lock across an R2 upload re-introduces the T2720 blocking-sync regression that the
  fire-and-forget path exists to avoid.
- The existing per-user **upload** lock (`get_upload_lock`, T1539) stays — it serializes PutObjects to
  one key to avoid R2 429s, orthogonal to the WAL race.

Chosen mechanism = **detect-and-refuse** (the T4315 approach), which is race-safe, latency-neutral,
and already wired into the Retry UX.

### 5. Blast radius — syncs fail (visibly, retryably) MORE often under real WAL contention
No new UI. A busy checkpoint surfaces on **existing** surfaces only:
- Fire-and-forget writes → `.sync_pending` stays → `X-Sync-Status: failed` header → syncStore Retry banner.
- Durable gestures (publish/export/clip-save/profile-create) → `503 {code:'sync_failed'}` → their
  existing Retry affordance.
- Overlay/clip surgical actions → existing "Your edits aren't saving — Retry" toast.

Frequency: refusal requires a concurrent **open read snapshot / active transaction** on the same DB at
the exact instant of the sync — a narrow window (per T4315: "narrow, not routine"), and the audit below
shows the request path already closes its writer before syncing. **T5870 owns the pending-vs-failed
banner/marker vocabulary — NOT redesigned here.** What T5920 exposes to T5870: a busy checkpoint =
`SyncResult.FAILED` + `.sync_pending` + `X-Sync-Status: failed` (indistinguishable from any other
transient failure — deliberately, so no new state leaks).

## Call-site connection-lifecycle audit (deliverable)

Question per site: is a SQLite connection to the *same* DB file held OPEN (active snapshot/txn) across
the sync? That is the only thing that can make the new guard refuse a caller's *own* sync.

| Call site | DB | Open across sync? | Evidence |
|---|---|---|---|
| `middleware/db_sync.py` `_background_sync` (fire-and-forget) | profile+user | **NO** | Handler's `with get_db_connection()` closes (`finally: conn.close()`, database.py:1207) and the write lock releases *before* `asyncio.create_task(_background_sync)` runs. |
| `middleware/db_sync.py` `_background_sync` (durable) | profile+user | **NO** | Durable await holds the per-user asyncio *write lock* (not a SQLite handle); the request's `get_db_connection()` block already committed+closed at handler return. |
| `services/materialization.py:646` `materialize_game_share` | profile | **YES — already guarded** | Raw `recipient_conn` held open, but the site already runs `busy_timeout=2000`+`wal_checkpoint(TRUNCATE)` and refuses on busy. Its own conn is idle post-commit ⇒ its self-checkpoint is busy=0 in the common case. New guard is redundant here, not a new failure. |
| `routers/downloads.py:1296` `move_reels_to_profile` (TARGET) | profile | **YES — unguarded** | Raw `target_conn` committed at :1294, held open until `finally` :1324, sync at :1296 on the same file. No pre-checkpoint. Idle post-commit ⇒ likely busy=0, but the one structural self-refusal risk. **→ in-scope hardening (below).** |
| `routers/downloads.py` `move_reels` (SOURCE) | profile | **NO** | Source sync deferred to `Depends(durable_sync)`; source `with` block closes before handler returns. |
| `services/auto_export.py:101,126,134` | profile | **NO** | Sync dedented out of every `with get_db_connection()` block. |
| `services/export_worker.py:124,129` | profile+user | **NO** | `_sync_after_export` opens no SQLite connection. |
| `services/poster.py:1253` | profile | **NO** | Per-row writers each open/commit/close their own `with`; sync outside the loop. |
| `services/sweep_scheduler.py:335` | profile | **NO** | `expire_game_storage()` closes its `with` and returns before the sync. |
| `services/export_helpers.py:364,369` | profile+user | **NO** | Opens no SQLite connection. |
| `routers/profiles.py:140` `create_profile` | profile | **NO** | `ensure_database()` conn closed at :135; sync at :140. (New profile.sqlite, empty WAL ⇒ instant checkpoint.) |
| `routers/payments.py:374,419` webhook | user | **NO** | `grant_credits()` `with get_user_db_connection()` commits+closes before sync. |
| `routers/admin.py:124` | user | **NO** | Opens no SQLite connection. |
| `migrations/__init__.py:158,202,231` | user+profile | **NO** | Raw migration conns closed in `finally` before each sync. |
| `routers/health.py:192` `sync_db_to_cloud` | profile | **NO** | Neither it nor caller opens a SQLite connection. |
| `main.py:352,386` shutdown | profile+user | **NO** | `conn.close()` at :338/:381 before the sync. |

**Sites that could self-refuse:** only `materialization.py:646` (already guarded — no regression) and
`downloads.py:1296` (unguarded MAYBE — idle-post-commit so likely busy=0, but structurally holds the
synced file open). Every other site — including the highest-traffic `_background_sync` — closes its
writer before syncing, so the guard is inert for them in the common case and only fires on genuine
concurrent-reader contention (exactly the hazard).

**In-scope hardening for `move_reels` target:** close `target_conn` (or checkpoint it, mirroring
materialization) *before* `sync_db_to_r2_explicit(user_id, target_profile_id)` at downloads.py:1296, so
the one structurally-open caller can't self-refuse. Low-risk reorder; guard still protects correctness
if skipped (worst case = a retryable FAILED, never data loss).

## Implementation plan (Stage 4 — after approval)

1. `storage.py`: add `_checkpoint_wal_or_refuse(local_db_path)`; call it in both
   `sync_database_to_r2_with_version` and `sync_user_db_to_r2_with_version` right before `upload_file`
   (after `new_version` is set, inside neither the CAS-only nor skip-only branch). Add `import sqlite3`.
2. `main.py`: delete the now-redundant `wal_checkpoint(TRUNCATE)` at :337 and :380 (single source).
3. `downloads.py:~1294`: close `target_conn` before the target sync (in-scope hardening).
4. Tests (Stage 3 first, red; then green):
   - `tests/test_t5920_checkpoint_before_upload.py`
5. `.claude/knowledge/persistence-sync.md`: document the guarantee (Stage 7).

Files: `storage.py`, `main.py`, `downloads.py`, one new test file, one knowledge doc. ~120 LOC.

## Test plan (proves the acceptance criteria — must go red without the guard)

**Primitive-level (deterministic, FakeR2 harness from `test_t4310`/`test_t4050`):**
- `test_busy_checkpoint_refuses_loudly`: profile.sqlite at R2 v0. Open `conn_writer`, INSERT a marker
  row, COMMIT (row now in `-wal`, main file lacks it). Open `conn_reader`, `BEGIN; SELECT` and keep the
  read snapshot open (pins the WAL ⇒ TRUNCATE busy). Call `sync_db_to_r2_explicit` →
  **assert `SyncResult.FAILED`**, **R2 object unchanged (HEAD db-version still 0)**, **local version
  cache NOT advanced**, **`.sync_pending` still set (retryable)**. Then close the reader/writer, retry
  → **`SyncResult.OK`**, download the R2 object, open it, **assert the marker row is present**, version
  == 1. (Covers AC "busy fails loudly, no upload, no version bump, stays retryable".)
- `test_user_db_variant`: same for user.sqlite via `sync_user_db_to_r2_explicit`.
- `test_no_stall`: assert the refused call returns in well under the 30s inherited timeout (≈≤2s),
  proving the 2000ms checkpoint timeout is in effect (AC "no 30s-per-attempt stall").
- `test_uncontended_upload_is_current`: writer commits then CLOSES, sync → OK, uploaded object contains
  the change (proves the guard doesn't break the normal path and DOES flush the WAL).

**Middleware-level (highest-traffic path, AC "db_sync.py covered"):** httpx ASGITransport against the
fake-R2 middleware (T4320 pattern). Fire a write request; hold a concurrent open read snapshot on that
profile.sqlite; assert the end-of-request sync EITHER uploaded the change OR refused (FAILED /
`X-Sync-Status: failed`) — **never stale-bytes-at-a-bumped-version**.

**Red-without-guard proof (required in the report):** delete the `_checkpoint_wal_or_refuse` call, run
`test_busy_checkpoint_refuses_loudly`; without the guard the first sync uploads the main file (missing
the marker row) at v1, so the "marker row present after retry" / "R2 unchanged on refusal" assertions
FAIL. Capture that output, restore the guard, paste both in the report.

## Risks & open questions

1. **`skip_version_check=True` on the event loop.** `profiles.py` and `payments.py` webhook call the
   primitive synchronously on the request thread (to skip the HEAD for latency). The checkpoint adds
   synchronous sqlite work there — sub-millisecond on an uncontended file (profile-create's file is
   brand-new/empty; the webhook's user.sqlite writer already closed), but up to 2s under rare
   contention. Proposed: accept it (correctness > a rare 2s tail on infrequent webhook/create paths).
   **Open Q:** OK to accept, or want an even shorter timeout (e.g. 500ms) for these two?
2. **TRUNCATE vs PASSIVE.** TRUNCATE is the reference and keeps the sidecar clean, at the cost of being
   the most likely to report busy (a lingering reader ⇒ refuse even if the committed frames were
   actually flushable). This is the conservative, "lose loudly" choice. **Open Q:** accept the slightly
   higher refuse rate of TRUNCATE (recommended, matches T4315), or use FULL/PASSIVE to refuse less
   often? (PASSIVE would need us to re-verify no frames remain, which is more code and less certain —
   recommend TRUNCATE.)
3. **`move_reels` target hardening in-scope?** The audit's one unguarded open-across-sync caller. Small
   reorder (close before sync). **Open Q:** include in this task (recommended) or split to a follow-up?
4. **Deleting the shutdown pre-checkpoints (main.py:337/380).** DRY win, but it's the one place with
   proven shutdown behavior. **Open Q:** delete (recommended, primitive now covers it) or leave as
   belt-and-suspenders?

## STOP — awaiting approval before Stage 3/4.
