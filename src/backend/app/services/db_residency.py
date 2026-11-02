"""T14380: residency of per-user SQLite files under USER_DATA_BASE, and their LRU eviction.

R2 is the source of truth for user.sqlite and every profile.sqlite; the local files
are a cache. Nothing evicted that cache before T14380 (3-13 GB at 10K users on a root
filesystem with no volume). Design: docs/plans/tasks/T14160-design.md.

Eviction unit: the USER (user.sqlite + every profile.sqlite together): the in-process
caches it must drop are user-keyed, and the sync markers live in the user directory.

Safety is a proof, not a timing heuristic. A user is evicted only under _EVICT_LOCK and
only if ALL hold:
  - no HOLD: every opener holds the user (connect_db's HeldConnection for a
    connection's lifetime; hold_user around multi-step sequences such as version check
    -> restore -> connect, the R2 download/upload primitives, and each request). An
    opener either holds before the check (eviction refuses) or arrives after the evict
    finished (no file, no cached baseline: it restores from R2);
  - no `.sync_*` marker of any kind or scope (pending/failed/conflict). Eviction is NOT
    INV-P clear reason (c): it preserves data, so it refuses instead of clearing;
  - no WAL sidecar on any DB file;
  - every DB file has a clean mark whose write sequence equals the current one
    (storage.db_write_state). Every HeldConnection bumps the sequence when a commit or
    close moved total_changes, and the upload primitives capture the sequence BEFORE the
    WAL checkpoint, so a commit not in the uploaded bytes always reads dirty.
Idle time (MIN_IDLE_S) is a thrash guard only, never part of the proof.
"""

import asyncio
import logging
import os
import sqlite3
import threading
import time
from collections import deque
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from urllib.parse import unquote, urlparse

logger = logging.getLogger(__name__)

HIGH_WATER_ENV = "DB_CACHE_HIGH_WATER_BYTES"
LOW_WATER_FRACTION = 0.8  # a pass that has to evict goes down to 0.8 x high water
MIN_IDLE_S = 300.0
EVICTION_INTERVAL_S = 120.0

_EVICT_LOCK = threading.Lock()
_HOLDS: dict[str, int] = {}
_LAST_USED: dict[str, float] = {}  # user_id -> monotonic time of last hold acquire/release
# Releases queued by HeldConnection.__del__: (hold key, DB path if it holds an unnoted
# write). deque.append takes no lock, so a finalizer can queue from any thread.
_LEAKED: deque[tuple[str, Path | None]] = deque()

# Never the shared default executor (T14100: request validate_session and to_thread R2
# syncs live there). One worker also means passes never overlap.
_EVICTION_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="db-evict")
_loop_task: asyncio.Task | None = None


class SkipReason(str, Enum):
    HELD = "held"
    RECENT = "recent"
    MARKER = "marker"
    SIDECAR = "sidecar"
    NO_MARK = "no_mark"
    DIRTY = "dirty"
    UNLINK_FAILED = "unlink_failed"


@dataclass
class EvictionReport:
    bytes_before: int = 0
    bytes_after: int = 0
    evicted: list[str] = field(default_factory=list)
    skipped: dict[SkipReason, list[str]] = field(default_factory=dict)


# --------------------------------------------------------------------------- holds

def hold_key_of_db_path(path: Path) -> str:
    """The hold key for a DB file: its user, from the layout alone
    (`{user}/user.sqlite*` or `{user}/profiles/{pid}/profile.sqlite*`).

    Any other path (a temp copy, a test fixture) holds under its own absolute
    path: eviction only ever walks `{user}/...` layouts, so such a file is never
    a candidate, and production openers build paths with database.profile_db_path
    / user_db_path (enforced by test_t14380_db_eviction)."""
    p = Path(path)
    if p.name.startswith("user.sqlite"):
        return p.parent.name
    if p.name.startswith("profile.sqlite") and p.parent.parent.name == "profiles":
        return p.parents[2].name
    return f"path:{os.path.abspath(p)}"


def _stamp(user_id: str) -> None:
    """Record use, under _EVICT_LOCK. A path key is not a user: never a candidate."""
    if not user_id.startswith("path:"):
        _LAST_USED[user_id] = time.monotonic()


def acquire_hold(user_id: str) -> None:
    with _EVICT_LOCK:
        _HOLDS[user_id] = _HOLDS.get(user_id, 0) + 1
        _stamp(user_id)


def release_hold(user_id: str) -> None:
    with _EVICT_LOCK:
        remaining = _HOLDS.get(user_id, 0) - 1
        if remaining > 0:
            _HOLDS[user_id] = remaining
        else:
            _HOLDS.pop(user_id, None)
        _stamp(user_id)


@contextmanager
def hold_user(user_id: str) -> Iterator[None]:
    """Keep `user_id`'s DB files resident for the duration. Re-entrant."""
    acquire_hold(user_id)
    try:
        yield
    finally:
        release_hold(user_id)


class HeldConnection(sqlite3.Connection):
    """A connection that holds its DB's user while open and bumps the file's write
    sequence when a commit or close moved total_changes. Created only by connect_db."""

    def __init__(self, database, *args, **kwargs):
        path = Path(unquote(urlparse(database).path))
        user_id = hold_key_of_db_path(path)
        acquire_hold(user_id)
        try:
            super().__init__(database, *args, **kwargs)
        except BaseException:
            release_hold(user_id)
            raise
        self.db_path = path
        self._held_user = user_id
        self._released = False
        self._track_writes = True
        self._noted_changes = 0
        self._excused_changes = 0

    def excuse_local_changes(self, n: int) -> None:
        """Changes that are local-only by contract (TrackedCursor.execute_local,
        e.g. last_accessed_at) and must not make the file read as unsynced."""
        self._excused_changes += n

    def _note_changes(self) -> None:
        if not self._track_writes:
            return
        counted = self.total_changes - self._excused_changes
        if counted != self._noted_changes:
            self._noted_changes = counted
            from ..storage import note_db_write
            note_db_write(self.db_path)

    def commit(self) -> None:
        super().commit()
        self._note_changes()

    def close(self) -> None:
        if self._released:
            return
        self._released = True
        try:
            self._note_changes()
        finally:
            try:
                super().close()
            finally:
                release_hold(self._held_user)

    def __del__(self):
        # A leaked connection must not pin its user forever. Cyclic GC can run this on
        # a thread already inside _EVICT_LOCK, which is not re-entrant, so it takes no
        # lock: it queues the release, and the next eviction pass applies it before it
        # decides anything.
        if getattr(self, "_released", True):
            return
        self._released = True
        changed = True  # unreadable counts as written: a leak never makes a DB read clean
        try:
            if not self._track_writes:
                changed = False
            else:
                changed = self.total_changes - self._excused_changes != self._noted_changes
            super().close()
        except Exception as e:
            logger.error(f"[DB_EVICT] closing a leaked connection to {self.db_path}: {e}")
        _LEAKED.append((self._held_user, self.db_path if changed else None))
        logger.error(
            f"[DB_EVICT] leaked connection to {self.db_path} was garbage-collected "
            f"unclosed -- its caller never closed it"
        )


def connect_db(
    path: Path, *, timeout: float = 30.0, create: bool = False, read_only: bool = False,
    track_writes: bool = True, check_same_thread: bool = True,
) -> HeldConnection:
    """The ONLY way to open a per-user DB (enforced by test_t14380_db_eviction).

    create=False opens with mode=rw, so a file that vanished after a caller's exists()
    check raises instead of becoming an empty DB. Only the two schema-creation sites
    pass create=True. track_writes=False is for the db_version bookkeeping row alone.
    """
    mode = "ro" if read_only else ("rwc" if create else "rw")
    conn = sqlite3.connect(
        f"{Path(path).resolve().as_uri()}?mode={mode}", uri=True, timeout=timeout,
        check_same_thread=check_same_thread, factory=HeldConnection,
    )
    conn._track_writes = track_writes
    return conn


# --------------------------------------------------------------------------- eviction

def _db_files(user_id: str) -> list[Path]:
    from .. import database

    files = []
    user_file = database.user_db_path(user_id)
    if user_file.exists():
        files.append(user_file)
    profiles_dir = database.USER_DATA_BASE / user_id / "profiles"
    if profiles_dir.is_dir():
        files.extend(sorted(profiles_dir.glob("*/profile.sqlite")))
    return files


def _with_sidecars(db: Path) -> list[Path]:
    return [db.with_name(db.name + "-wal"), db.with_name(db.name + "-shm"), db]


def _user_bytes(user_id: str) -> int:
    total = 0
    for db in _db_files(user_id):
        for f in _with_sidecars(db):
            try:
                total += f.stat().st_size
            except FileNotFoundError:
                pass
    return total


def resident_bytes() -> int:
    """Bytes of DB files (with sidecars) of every user this process has touched."""
    with _EVICT_LOCK:
        users = list(_LAST_USED)
    return sum(_user_bytes(u) for u in users)


def _has_any_marker(user_id: str) -> bool:
    from .. import database

    try:
        return any(e.name.startswith(".sync_") for e in os.scandir(database._marker_dir(user_id)))
    except FileNotFoundError:
        return False
    except OSError as e:
        logger.error(f"[DB_EVICT] cannot list markers for user={user_id}: {e} -- treating as marked")
        return True


def _apply_leaked_releases() -> None:
    """Apply the releases HeldConnection.__del__ queued. Called outside every lock.
    The write is noted before the hold goes, so the DB reads dirty before it is free."""
    from ..storage import note_db_write

    while _LEAKED:
        user_id, written_path = _LEAKED.popleft()
        if written_path is not None:
            note_db_write(written_path)
        release_hold(user_id)


def _forget_user(user_id: str, files: list[Path]) -> None:
    from .. import storage
    from . import user_db

    user_db.forget_user_db(user_id)
    storage.forget_db_marks(files)
    _LAST_USED.pop(user_id, None)


def _evict_user(user_id: str, min_idle_s: float) -> SkipReason | None:
    """Evict one user, or return why not. Check and act under one _EVICT_LOCK hold."""
    from .. import storage
    from .db_refresh import wal_sidecars_present

    with _EVICT_LOCK:
        if _HOLDS.get(user_id):
            return SkipReason.HELD
        if time.monotonic() - _LAST_USED.get(user_id, float("-inf")) < min_idle_s:
            return SkipReason.RECENT
        if _has_any_marker(user_id):
            return SkipReason.MARKER
        files = _db_files(user_id)
        for db in files:
            if wal_sidecars_present(db):
                return SkipReason.SIDECAR
            state = storage.db_write_state(db)
            if state == storage.DbWriteState.NO_MARK:
                return SkipReason.NO_MARK
            if state == storage.DbWriteState.DIRTY:
                return SkipReason.DIRTY
        for db in files:
            for f in _with_sidecars(db):  # main file last: never sidecars without a main
                try:
                    f.unlink(missing_ok=True)
                except OSError as e:
                    logger.error(
                        f"[DB_EVICT] unlink failed for user={user_id} {f}: {e} -- "
                        f"in-memory state left untouched"
                    )
                    return SkipReason.UNLINK_FAILED
        _forget_user(user_id, files)
    return None


def run_eviction_pass(high_water: int, *, min_idle_s: float = MIN_IDLE_S) -> EvictionReport:
    """Evict least-recently-used eligible users until resident bytes are at or
    below LOW_WATER_FRACTION x high_water. A no-op without R2 (the disk IS the truth)."""
    from .. import database

    report = EvictionReport()
    _apply_leaked_releases()
    if not database.R2_ENABLED:
        return report
    with _EVICT_LOCK:
        by_age = sorted(_LAST_USED.items(), key=lambda kv: kv[1])
    sizes = {u: _user_bytes(u) for u, _ in by_age}
    total = sum(sizes.values())
    report.bytes_before = total
    if total > high_water:
        low_water = int(high_water * LOW_WATER_FRACTION)
        for user_id, _ in by_age:
            if total <= low_water:
                break
            reason = _evict_user(user_id, min_idle_s)
            if reason is None:
                total -= sizes[user_id]
                report.evicted.append(user_id)
            else:
                report.skipped.setdefault(reason, []).append(user_id)
                logger.info(f"[DB_EVICT] skip user={user_id} reason={reason.value}")
        skips = {r.value: len(us) for r, us in report.skipped.items()}
        logger.info(
            f"[DB_EVICT] pass: {report.bytes_before} -> {total} bytes "
            f"(high water {high_water}), evicted={len(report.evicted)} users, skipped={skips}"
        )
    report.bytes_after = total
    if total > high_water:
        logger.warning(
            f"[DB_EVICT] pass ended above high water: {total} > {high_water} bytes "
            f"(everything left is held, marked, dirty or recent)"
        )
    return report


def high_water_from_env() -> int | None:
    """DB_CACHE_HIGH_WATER_BYTES, required with R2. Unset means eviction stays off."""
    from .. import database

    raw = os.getenv(HIGH_WATER_ENV)
    if raw:
        return int(raw)
    if database.R2_ENABLED:
        logger.error(
            f"[DB_EVICT] {HIGH_WATER_ENV} is not set -- local DB cache eviction is OFF "
            f"and /user_data grows without bound (T14380)"
        )
    return None


async def _eviction_loop(high_water: int, interval_s: float) -> None:
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(interval_s)
        try:
            # Looked up per pass so a patched run_eviction_pass is honoured.
            await loop.run_in_executor(
                _EVICTION_EXECUTOR, lambda: run_eviction_pass(high_water)
            )
        except Exception:
            logger.exception("[DB_EVICT] pass failed")


def start_db_eviction_loop(high_water: int, interval_s: float = EVICTION_INTERVAL_S) -> None:
    global _loop_task
    logger.info(f"[DB_EVICT] loop started: high water {high_water} bytes, every {interval_s:.0f}s")
    _loop_task = asyncio.get_running_loop().create_task(_eviction_loop(high_water, interval_s))


async def stop_db_eviction_loop() -> None:
    global _loop_task
    task, _loop_task = _loop_task, None
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def _reset_for_tests() -> None:
    with _EVICT_LOCK:
        _HOLDS.clear()
        _LAST_USED.clear()
    _LEAKED.clear()
