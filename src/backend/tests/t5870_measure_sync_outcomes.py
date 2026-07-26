"""T5870 instrumentation harness (NOT a pytest module — run directly).

    python3 tests/t5870_measure_sync_outcomes.py

Drives the REAL sync machinery on today's master to produce the outcome
distribution and the outcome -> user-surface truth table the design gate needs:

  * real markers            db.mark/clear/has_sync_pending, mark/has_sync_conflict
  * real in-flight set      db_sync._begin/_end_sync_attempt, is_sync_attempt_in_progress
  * real background sync     RequestContextMiddleware._background_sync
  * real header predicate    is_sync_failed(u) and not is_sync_attempt_in_progress(u)

Only the R2 boundary (sync_db_to_r2_explicit / sync_user_db_to_r2_explicit,
returning the real SyncResult enum) is modelled by a fake R2 that owns a real
per-(user,db) threading upload lock, so the 0.5s upload-lock DEFER is reproduced
by genuine thread contention, exactly as _SYNC_LOCK_TIMEOUT does in prod.

Every number printed is labelled MEASURED (from running the real code) vs
MODELLED-INPUT (an assumption fed in). Assumptions are stated and swept.
"""
import asyncio
import sys
import tempfile
import threading
import time
from pathlib import Path

# make `app` importable when run from src/backend
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.database as db
from app.database import SyncResult
from app.middleware import db_sync
from app.middleware.db_sync import (
    RequestContextMiddleware,
    _begin_sync_attempt,
    is_sync_attempt_in_progress,
    is_sync_failed,
)

MW = RequestContextMiddleware(app=None)
UPLOAD_LATENCY = 0.30       # MODELLED-INPUT: one R2 PutObject, ~p50 prod
LOCK_TIMEOUT = db_sync._SYNC_LOCK_TIMEOUT  # 0.5 (real constant)


def header_value(user_id):
    """EXACT copy of db_sync.py:791-792 header-emission predicate."""
    if is_sync_failed(user_id) and not is_sync_attempt_in_progress(user_id):
        return "conflict" if db.has_sync_conflict(user_id) else "failed"
    return None


class FakeR2:
    """Per-(user,db) upload lock + version counter. Real threading.Lock so the
    background sync's asyncio.to_thread calls contend for real (reproduces the
    0.5s defer). `plan` injects non-OK outcomes for specific call ordinals."""

    def __init__(self):
        self.locks = {}
        self.version = {}         # key -> int (only bumped on OK == data in R2)
        self.calls = 0
        self.plan = {}            # call-ordinal -> "conflict" | "ckpt_busy" | "r2_error"
        self.deferred = 0
        self.uploaded = 0
        self.outcomes = []        # MEASURED: SyncResult per call

    def _lock(self, key):
        return self.locks.setdefault(key, threading.Lock())

    def _sync(self, key, user_id, lock_timeout):
        n = self.calls
        self.calls += 1
        injected = self.plan.get(n)
        lk = self._lock(key)
        acquired = lk.acquire(timeout=lock_timeout) if lock_timeout is not None else lk.acquire()
        if not acquired:
            self.deferred += 1
            self.outcomes.append(SyncResult.FAILED)
            return SyncResult.FAILED           # <-- the 0.5s DEFER path
        try:
            if injected == "conflict":
                db.mark_sync_conflict(user_id)
                self.outcomes.append(SyncResult.CONFLICT)
                return SyncResult.CONFLICT
            if injected in ("ckpt_busy", "r2_error"):
                time.sleep(0.02)
                self.outcomes.append(SyncResult.FAILED)
                return SyncResult.FAILED        # checkpoint-busy / R2 error both -> FAILED
            time.sleep(UPLOAD_LATENCY)
            self.version[key] = self.version.get(key, 0) + 1
            self.uploaded += 1
            self.outcomes.append(SyncResult.OK)
            return SyncResult.OK
        finally:
            lk.release()

    def profile(self, user_id, profile_id, lock_timeout=None, skip_version_check=False):
        return self._sync((user_id, profile_id, "p"), user_id, lock_timeout)

    def user(self, user_id, lock_timeout=None, skip_version_check=False):
        return self._sync((user_id, "u"), user_id, lock_timeout)


def install(fake):
    db_sync.sync_db_to_r2_explicit = fake.profile
    db_sync.sync_user_db_to_r2_explicit = fake.user


def fresh_user(tmp, name):
    db.USER_DATA_BASE = Path(tmp)
    db_sync._SYNC_IN_PROGRESS = set()
    (Path(tmp) / name).mkdir(parents=True, exist_ok=True)
    db.clear_sync_pending(name)
    db.clear_sync_conflict(name)
    return name


async def fire_write(u, pid, fake):
    """Replicates _sync_aware_flow's non-durable writer: mark+begin synchronously,
    then _background_sync as a fire-and-forget task (in-flight during response)."""
    db.mark_sync_pending(u)
    _begin_sync_attempt(u)
    task = asyncio.create_task(MW._background_sync(
        u, pid, "rid", "POST", "/clips/working/actions",
        had_writes=True, had_user_db_writes=True,
        do_profile=False, force_profile=False,
    ))
    return task


# --------------------------------------------------------------------------
async def scenario_uncontended(tmp):
    """Baseline: writes spaced > upload latency apart, clean R2."""
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_uncontended"); pid = "aaaaaaaa"
    banner_reads = 0; total_reads = 0
    for _ in range(5):
        t = await fire_write(u, pid, fake)
        await t                      # let it finish before next (uncontended)
        for _ in range(4):
            total_reads += 1
            if header_value(u): banner_reads += 1
    return ("uncontended (writes spaced apart)", fake, banner_reads, total_reads, 0)


async def scenario_rapid(tmp, gap):
    """Rapid writes: contend on the profile upload lock -> some defer at 0.5s.
    Reads interleave; classify each banner-read as STALE (data already in R2)
    vs GENUINE (latest write not yet in R2)."""
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_rapid"); pid = "bbbbbbbb"
    tasks = []
    banner_reads = 0; total_reads = 0; stale_banner = 0
    writes = 8
    for i in range(writes):
        t = await fire_write(u, pid, fake)
        tasks.append(t)
        # a couple of interleaved reads while syncs are in flight
        for _ in range(3):
            await asyncio.sleep(gap / 3)
            total_reads += 1
            h = header_value(u)
            if h:
                banner_reads += 1
                # ground truth: is there STILL an unsynced write? if no bg sync
                # is in flight and marker set, the marker is genuine-pending or
                # stale. We can't see file contents (modelled), but we can see
                # whether any attempt is still running:
                if not is_sync_attempt_in_progress(u):
                    stale_banner += 1  # marker set, nothing running -> stuck
    await asyncio.gather(*tasks)
    # settle
    final_banner = 1 if header_value(u) else 0
    return (f"rapid writes (gap={int(gap*1000)}ms)", fake, banner_reads, total_reads, final_banner)


async def scenario_refcount_fp(tmp):
    """The lead-1 false positive: two OVERLAPPING successful syncs of different
    duration. The fast one's _end_sync_attempt clears the shared in-progress SET
    (not a refcount) while the slow one is still uploading -> a concurrent read
    sees marker-set + not-in-progress and emits 'failed' though the write is
    merely IN FLIGHT (data will land)."""
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_refcount"); pid = "cccccccc"
    # make the SECOND sync fast and the FIRST slow by giving them different keys?
    # Both are profile syncs (same lock) -> they serialise, not overlap. To get a
    # genuine overlap of two _background_sync tasks we rely on profile+user running
    # under gather within ONE task; across TWO tasks the second's profile waits on
    # the lock. The real overlap is: task A's USER sync (fast) finishes and calls
    # _end, while task A's PROFILE sync (slow) still runs? No -- same task, one
    # _end after gather. The cross-task overlap: A ends (set cleared) while B's
    # bg sync still queued/running.
    tA = await fire_write(u, pid, fake)
    await asyncio.sleep(0.02)
    tB = await fire_write(u, pid, fake)   # B marks again, begins again
    # Wait for A to finish (it clears marker+ends). B still in flight (waiting on
    # profile lock that A holds, or uploading).
    await tA
    # sample immediately after A ends, while B is still working:
    samples = []
    for _ in range(6):
        samples.append((header_value(u), is_sync_attempt_in_progress(u)))
        await asyncio.sleep(0.03)
    await tB
    fp = sum(1 for h, _ in samples if h == "failed")
    return ("refcount-FP probe (A ends while B in flight)", fake, fp, len(samples),
            1 if header_value(u) else 0)


async def scenario_conflict(tmp):
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_conflict"); pid = "dddddddd"
    fake.plan = {0: "conflict", 1: "conflict"}  # profile+user both conflict
    t = await fire_write(u, pid, fake)
    await t
    h = header_value(u)
    return (f"CAS conflict -> header={h!r}", fake, 1 if h else 0, 1,
            1 if header_value(u) else 0)


async def scenario_checkpoint_then_heal(tmp):
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_ckpt"); pid = "eeeeeeee"
    fake.plan = {0: "ckpt_busy", 1: "ckpt_busy"}  # first write: checkpoint refuses
    t = await fire_write(u, pid, fake); await t
    stuck = header_value(u)
    # user edits again -> next write's bg sync succeeds (contention cleared)
    t2 = await fire_write(u, pid, fake); await t2
    healed = header_value(u)
    return (f"checkpoint-busy then next write (stuck={stuck!r} -> healed={healed!r})",
            fake, 1 if stuck else 0, 1, 1 if healed else 0)


async def scenario_idle_after_failure(tmp):
    """User's LAST edit fails/defers, then they stop editing (reads only)."""
    fake = FakeR2(); install(fake)
    u = fresh_user(tmp, "u_idle"); pid = "ffffffff"
    fake.plan = {0: "r2_error", 1: "r2_error"}
    t = await fire_write(u, pid, fake); await t
    # now idle: only reads, no writes -> nothing triggers retry_pending_sync
    banner_reads = sum(1 for _ in range(20) if header_value(u))
    return ("idle after failed last write (reads only, no heal)",
            fake, banner_reads, 20, 1 if header_value(u) else 0)


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        scenarios = [
            await scenario_uncontended(tmp),
            await scenario_rapid(tmp, gap=0.05),
            await scenario_rapid(tmp, gap=0.15),
            await scenario_refcount_fp(tmp),
            await scenario_conflict(tmp),
            await scenario_checkpoint_then_heal(tmp),
            await scenario_idle_after_failure(tmp),
        ]
    print("\n================ T5870 MEASURED OUTCOME DISTRIBUTION ================")
    print(f"MODELLED-INPUT: R2 upload latency={int(UPLOAD_LATENCY*1000)}ms, "
          f"defer timeout={LOCK_TIMEOUT}s (real _SYNC_LOCK_TIMEOUT)\n")
    hdr = f"{'scenario':<46}{'uploads':>8}{'defers':>7}{'banner_reads':>13}{'final':>7}"
    print(hdr); print("-" * len(hdr))
    for name, fake, banner, total, final in scenarios:
        oc = fake.outcomes
        print(f"{name:<46}{fake.uploaded:>8}{fake.deferred:>7}"
              f"{f'{banner}/{total}':>13}{('ON' if final else 'off'):>7}")
    print("\nper-scenario SyncResult tallies (MEASURED from real enum returns):")
    for name, fake, *_ in scenarios:
        from collections import Counter
        c = Counter(str(o) for o in fake.outcomes)
        print(f"  {name:<46} {dict(c)}")


if __name__ == "__main__":
    asyncio.run(main())
