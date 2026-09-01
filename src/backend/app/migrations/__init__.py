import logging
import shutil
import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .postgres import RUNNER as PG_RUNNER
from .profile_db import RUNNER as PROFILE_DB_RUNNER
from .user_db import RUNNER as USER_DB_RUNNER

logger = logging.getLogger(__name__)

# T8190: how long a seam call waits to acquire another thread's migration lock
# for the SAME (user_id, profile_id-or-scope) before giving up loudly. Genuine
# cross-request contention (two requests racing to migrate the same
# just-deployed user) should resolve in well under a second normally; this is
# a generous ceiling for a slow migration, not an expected wait.
SEAM_LOCK_TIMEOUT_S = 30


class MigrationBlocked(Exception):
    """Raised by the JIT load-seam when a profile/user DB cannot be verified
    at head. Callers (ensure_database / ensure_user_database) never catch
    this and serve the below-head DB anyway (T5083 §2.6 — no silent
    fallback); it propagates to the FastAPI exception handler that maps it
    to HTTP 503 "pending migration"."""

    def __init__(self, user_id: str, profile_id: str | None, reason: str):
        self.user_id = user_id
        self.profile_id = profile_id
        self.reason = reason
        super().__init__(f"migration blocked for user={user_id} profile={profile_id}: {reason}")


@dataclass
class MigrateResult:
    """Per-profile migration outcome from _migrate_profile_db."""
    status: str  # "ok" | "sync_failed" | "not_at_head" | "missing" | "download_failed" | "wal_busy"
    #   wal_busy: a -wal/-shm sidecar was present when the swap was about to run
    #   (a live connection holds the file open, or a crash left sidecars) — the
    #   swap was REFUSED to avoid replaying old WAL frames onto the new file; a
    #   later migrate run retries once the file is quiescent.
    applied: list = field(default_factory=list)
    r2_version: int | None = None


# ---------------------------------------------------------------------------
# T5083 — JIT migrate-at-load-seam primitives
# ---------------------------------------------------------------------------

USER_DB_SCOPE = "user"  # mirrors database.USER_DB_SCOPE — user.sqlite's lock/marker key

# Dedicated per-(user_id, profile_id-or-USER_DB_SCOPE) migration lock — NOT the
# asyncio write lock (design §2.7 / §3.1). A `threading.Lock` is safe from both
# the async event loop and the sweep's background thread, and is never
# acquired by anything that also holds the write lock, so there is no
# re-entrancy deadlock. Guarded by `_migration_locks_guard` against a TOCTOU
# race where two threads' `setdefault` could otherwise create two different
# Lock objects for the same key.
#
# T8190 (hit live in prod-shape data 2026-08-31, was a LANDMINE before that):
# this lock is NOT reentrant, and a migration's own `up(conn)` can reach
# `run_profile_seam`/`run_user_seam` transitively for the SAME key it is
# already migrating — the confirmed shape: `v047`/`v017` call
# `insert_game_storage_ref`, which does `get_db_connection()` ->
# `ensure_database()` -> `run_profile_seam` for the SAME (user, profile) this
# thread already holds the lock for. A bare `with lock:` deadlocks forever
# (no timeout), wedging the whole process once the thread pool exhausts behind
# it. Two-part fix (`run_profile_seam`/`run_user_seam` below):
#   1. `_seam_in_progress` tracks which THREAD is currently running the seam
#      for a key; a nested call from that SAME thread for the SAME key
#      returns immediately (no-op) — the outer frame owns the migration and
#      will mark it verified.
#   2. A DIFFERENT thread genuinely contending for the same key acquires with
#      `timeout=SEAM_LOCK_TIMEOUT_S` and raises `MigrationBlocked` (-> 503) on
#      expiry instead of hanging the requester forever.
# This narrows but does not fully replace the "never re-enter the seam"
# discipline: any NEW migration that opens ANOTHER profile from inside `up()`
# (v033 is the first — `materialization.ensure_profile_db_local`/
# `open_profile_db_readonly`/`_open_profile_db`, or `user_db.get_profiles`,
# all inherit the seam per T5085) must still catch `MigrationBlocked` from
# that cross-profile open and degrade rather than assume the cross-open is
# safe just because it "only reads" — see v033's own handling. The static
# guard test (test_t8190_seam_reentrancy_deadlock.py) fails any migration that
# reaches `get_db_connection`/`get_user_db_connection`/`insert_game_storage_ref`
# directly, which is the more common mistake this bug actually shipped as.
_migration_locks: dict[tuple, threading.Lock] = {}
_migration_locks_guard = threading.Lock()

# T8190: (user_id, profile_id-or-scope) -> the thread id currently running
# run_profile_seam/run_user_seam for that key. Guarded by the SAME
# _migration_locks_guard as _migration_locks (one lock protects both small
# dicts; neither is held during real I/O).
_seam_in_progress: dict[tuple, int] = {}


def _get_migration_lock(user_id: str, profile_id_or_scope: str) -> threading.Lock:
    key = (user_id, profile_id_or_scope)
    with _migration_locks_guard:
        lock = _migration_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _migration_locks[key] = lock
        return lock


# T5083 fix (2026-08-31 CI escalation): the seam's fail-loud guarantee was only
# one request deep. `set_local_db_version`/`set_local_user_db_version` run
# INSIDE the restore block, BEFORE the seam call — so a request 1 that raises
# MigrationBlocked still leaves `local_version` non-None. Request 2 then finds
# `entered_restore_branch` False (the restore branch is gated on
# `local_version is None`) and SKIPS the seam entirely, silently serving the
# below-head DB — exactly the silent fallback the design exists to prevent.
# `_seam_verified` is a SEPARATE per-(user_id, profile_id-or-USER_DB_SCOPE)
# success flag, added ONLY after a real "ok" result, so a below-head DB keeps
# re-entering the seam on every request until it verifiably reaches head —
# independent of the restore branch's own version-cache gate. Deliberately
# NOT `_initialized_users` (database.py) — that set is keyed on user_id ALONE,
# so a user's second profile would wrongly inherit the first profile's
# verified flag. Cleared alongside the existing per-user/per-profile caches
# (forget_local_db_state / forget_user_db / invalidate_user_cache) so an
# account purge-then-reregister can't skip the seam on the new registration.
_seam_verified: set[tuple[str, str]] = set()


def _clear_seam_verified(user_id: str, scope: str | None = None) -> None:
    """Drop the verified-at-head flag for one scope, or every scope of a user
    when `scope` is None (account purge / forget_local_db_state without a
    specific profile in hand)."""
    if scope is not None:
        _seam_verified.discard((user_id, scope))
        return
    for key in [k for k in _seam_verified if k[0] == user_id]:
        _seam_verified.discard(key)


def migrate_local_profile_db_at_seam(user_id: str, profile_id: str) -> MigrateResult:
    """Leaner seam variant of `_migrate_profile_db` (design §2.3): operates on
    the file the seam's restore already downloaded+swapped — NO second
    download, no T6410 keep-local tree (the seam already decided swap-vs-keep).
    Runs the runner in place, syncs to R2 only if it actually applied
    something, and re-verifies at head. Shares `PROFILE_DB_RUNNER`,
    `sync_db_to_r2_explicit`, `_read_r2_profile_user_version`,
    `_r2_version_or_none` with the bulk sweep primitive — see
    `test_sweep_and_seam_identical`.

    T5085 (review fix): mirrors `_migrate_profile_db`'s `if client:` guard
    (~line 807) around the sync + verify steps — this primitive is no longer
    reachable ONLY from inside `ensure_database`'s `if R2_ENABLED:` block
    (T5085's new non-login call sites invoke it unconditionally), so it must
    tolerate R2 being disabled itself rather than assume its caller already
    gated on `R2_ENABLED`. Without this, a below-head profile in local/no-R2
    dev mode was upgraded locally by the runner but then unconditionally
    verified against R2 -- `_read_r2_profile_user_version` returns `None`
    when there's no client, `None != head` -> `not_at_head` -> the seam
    raises `MigrationBlocked` on every request, permanently, for a profile
    the runner just successfully brought to head."""
    from ..database import USER_DATA_BASE, sync_db_to_r2_explicit
    from ..profile_context import set_current_profile_id
    from ..services.db_refresh import wal_sidecars_present
    from ..storage import get_r2_client
    from ..user_context import set_current_user_id

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        # The seam guarantees this exists post-restore in production; a
        # missing file here is a real fault (T4820 bug class) — fail loud,
        # never silently open/create a fresh DB in its place.
        return MigrateResult(status="missing")

    if wal_sidecars_present(db_path):
        # A live connection holds the file open (or a crash left sidecars).
        # The runner migrates in place (no swap) but an ALTER TABLE would
        # still fight a live WAL writer. Never migrate under one.
        return MigrateResult(status="wal_busy")

    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        try:
            applied = PROFILE_DB_RUNNER.run(conn, "sqlite")
        except Exception as e:
            # Mirrors _migrate_user's exception handling — a migration.up()
            # failure (a bad ALTER, a data-shape assumption that doesn't hold)
            # must surface as a MigrateResult the seam can act on (-> raise
            # MigrationBlocked -> HTTP 503), never escape as a raw 500.
            logger.error(
                f"[Migration] seam migration raised for user={user_id} "
                f"profile={profile_id} db={db_path}: {e}", exc_info=True,
            )
            return MigrateResult(status=f"exception: {e}", applied=[])
    finally:
        conn.close()

    if not applied:
        # At-head cheap path — zero R2 work (design §2.4 point 2).
        return MigrateResult(status="ok", applied=[])

    client = get_r2_client()
    if client and not sync_db_to_r2_explicit(user_id, profile_id):
        return MigrateResult(
            status="sync_failed", applied=applied,
            r2_version=_r2_version_or_none(user_id, profile_id),
        )

    if client:
        head = PROFILE_DB_RUNNER.latest_version
        verified = _read_r2_profile_user_version(user_id, profile_id)
        if verified != head:
            return MigrateResult(status="not_at_head", applied=applied, r2_version=verified)

    return MigrateResult(status="ok", applied=applied)


def migrate_local_user_db_at_seam(user_id: str) -> MigrateResult:
    """Leaner seam variant of `_migrate_user_db`, WITHOUT the leading
    `ensure_user_database` call — the seam is already inside
    `ensure_user_database`'s restore block, so the file is already local and
    the baseline already recorded. Raw connect -> USER_DB_RUNNER.run ->
    sync_user_db_to_r2_explicit if applied -> return MigrateResult."""
    from ..database import sync_user_db_to_r2_explicit
    from ..services.db_refresh import wal_sidecars_present
    from ..services.user_db import _get_user_db_path

    db_path = _get_user_db_path(user_id)
    if not db_path.exists():
        return MigrateResult(status="missing")

    if wal_sidecars_present(db_path):
        # Mirrors migrate_local_profile_db_at_seam's guard (2026-08-31 CI
        # escalation minor fix (a)): this branch was previously unreachable
        # here (the caller's `if result.status == "wal_busy":` retry was dead
        # code) since nothing ever checked for a live/stale sidecar before
        # migrating in place.
        return MigrateResult(status="wal_busy")

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        try:
            applied = USER_DB_RUNNER.run(conn, "sqlite")
        except Exception as e:
            logger.error(
                f"[Migration] seam migration raised for user={user_id} "
                f"db={db_path}: {e}", exc_info=True,
            )
            return MigrateResult(status=f"exception: {e}", applied=[])
    finally:
        conn.close()

    if not applied:
        return MigrateResult(status="ok", applied=[])

    if not sync_user_db_to_r2_explicit(user_id):
        return MigrateResult(status="sync_failed", applied=applied)

    return MigrateResult(status="ok", applied=applied)


def _seam_repull_and_retry_profile(user_id: str, profile_id: str, db_path: Path) -> MigrateResult:
    """Handle a `sync_failed` (CAS refusal) result from
    `migrate_local_profile_db_at_seam` — cross-machine race (design §2.7,
    EPIC decision 5): another machine already advanced R2 out from under us.

    1. INV-P short-circuit: if THIS scope has nothing pending
       (`has_sync_pending_scope` False), the other machine's migration is the
       clean copy already at R2 head — re-pull only, no retry needed.
    2. Otherwise: re-pull (re-download directly via the same restore
       primitive `ensure_database` uses) + retry the seam primitive ONCE.
    3. Still failing -> raise MigrationBlocked (never loop past one retry).

    Re-pulls via the low-level restore primitive directly (NOT by calling
    `ensure_database()`), which would re-enter this same seam machinery
    recursively — `ensure_database` is the seam's own caller, not something
    the seam should call back into.
    """
    from ..database import (
        clear_sync_pending,
        has_sync_pending_scope,
        read_pending_token,
        set_local_db_version,
    )
    from ..profile_context import set_current_profile_id
    from ..services.db_refresh import clear_stale_wal_sidecars, wal_sidecars_present
    from ..storage import sync_database_from_r2_if_newer
    from ..user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    nothing_pending = not has_sync_pending_scope(user_id, profile_id)

    pending_token = read_pending_token(user_id, profile_id)
    was_synced, new_version, _was_error = sync_database_from_r2_if_newer(
        user_id, db_path, None,  # local baseline is presumed stale after a CAS refusal
        before_download=lambda: not wal_sidecars_present(db_path),
    )
    if was_synced:
        clear_stale_wal_sidecars(db_path)
        set_local_db_version(user_id, profile_id, new_version)
        clear_sync_pending(user_id, profile_id, if_token=pending_token)

    if nothing_pending:
        # Clean-copy case: nothing local to arbitrate. The re-pull above
        # already brought us to R2's head; treat as success without
        # re-invoking the seam primitive.
        return MigrateResult(status="ok", applied=[])

    result = migrate_local_profile_db_at_seam(user_id, profile_id)
    if result.status != "ok":
        raise MigrationBlocked(user_id, profile_id, result.status)
    return result


def _seam_repull_and_retry_user(user_id: str, db_path: Path) -> MigrateResult:
    """User.sqlite sibling of `_seam_repull_and_retry_profile` — same
    INV-P short-circuit / re-pull-directly / retry-once-then-block shape,
    scoped to `USER_DB_SCOPE` instead of a profile_id."""
    from ..database import (
        USER_DB_SCOPE,
        clear_sync_pending,
        has_sync_pending_scope,
        read_pending_token,
        set_local_user_db_version,
    )
    from ..services.db_refresh import clear_stale_wal_sidecars, wal_sidecars_present
    from ..storage import sync_user_db_from_r2_if_newer
    from ..user_context import set_current_user_id

    set_current_user_id(user_id)

    nothing_pending = not has_sync_pending_scope(user_id, USER_DB_SCOPE)

    pending_token = read_pending_token(user_id, USER_DB_SCOPE)
    was_synced, new_version, _was_error = sync_user_db_from_r2_if_newer(
        user_id, db_path, None,
        before_download=lambda: not wal_sidecars_present(db_path),
    )
    if was_synced:
        clear_stale_wal_sidecars(db_path)
        set_local_user_db_version(user_id, new_version)
        clear_sync_pending(user_id, USER_DB_SCOPE, if_token=pending_token)

    if nothing_pending:
        return MigrateResult(status="ok", applied=[])

    result = migrate_local_user_db_at_seam(user_id)
    if result.status != "ok":
        raise MigrationBlocked(user_id, None, result.status)
    return result


def _seam_at_head(db_path: Path, runner) -> bool:
    """Lock-free 'is this file already at head?' probe, used ONLY to decide
    whether a BUSY DB is worth blocking on (T5085 CI-escalation fix).

    Safe under a concurrent WAL writer: PRAGMA user_version is read through a
    normal WAL read snapshot -- readers never block writers and never observe
    a peer's uncommitted header change. Sidecars present does NOT guarantee a
    live connection (`wal_sidecars_present`'s own docstring: a prior crash
    can leave them with nothing holding the file) -- when nothing is live,
    THIS probe connection can be the last one, and its own close() then
    checkpoints and clears the sidecars. That is safe, not a hazard: a proper
    checkpoint only COMMITS frames, it can't discard or corrupt anything, and
    it is strictly better than the wal_busy fall-through's own unlink-based
    clear (T5086) would have done to the same stale sidecars anyway.
    `_read_sqlite_user_version` returns 0 on any read error, which lands on
    the conservative side here: unreadable => "needs migration" => falls
    through to the normal fail-loud path below, never a silent "assume at
    head".

    Exact, not approximate: `MigrationRunner.get_pending` for the sqlite
    tracks is `version > PRAGMA user_version` (base.py), so
    `user_version >= latest_version` is precisely the primitive's own
    "ok, applied=[], zero R2 writes" branch -- this can only ever skip work
    that provably has no effect.
    """
    return _read_sqlite_user_version(db_path) >= runner.latest_version


def run_profile_seam(user_id: str, profile_id: str) -> None:
    """T5085: THE migrate-at-load-seam for one profile.sqlite, extracted
    verbatim from `ensure_database()`'s restore block so every non-login
    caller that opens a profile DB without going through `ensure_database`
    (share resolution, admin cross-user reads, the recipient/sharer sides of
    a teammate share, cross-profile reel moves) gets the same guarantee:
    migrate-before-touch, fail-loud (raises MigrationBlocked -> HTTP 503 on
    the request path) rather than silently serving a below-head DB.

    Idempotent and cheap after the first verified run this process
    (`_seam_verified` set membership -> one dict lookup, zero I/O). A no-op
    when no local file exists yet (a brand-new profile that was never
    restored — the caller's own CREATE TABLE path stamps it to head).

    Owns the (user_id, profile_id) ContextVar swap so it is safe to call for
    a DB the current request context does NOT own: `set_current_user_id`/
    `set_current_profile_id` are needed by `migrate_local_profile_db_at_seam`
    (it reads them for R2 key construction) but must not leak into the
    caller's context afterward — restored in a `finally` regardless of
    outcome, including the MigrationBlocked raise.
    """
    from ..database import USER_DATA_BASE
    from ..profile_context import reset_profile_id_token, set_current_profile_id
    from ..user_context import reset_user_id_token, set_current_user_id

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists() or (user_id, profile_id) in _seam_verified:
        return

    # T5085 (CI escalation): the primitive refuses on a live -wal/-shm
    # sidecar BEFORE it ever reads PRAGMA user_version -- deliberate, it must
    # never ALTER TABLE under a live writer (test_seam_wal_busy_blocks pins
    # this, and this check stays gated on sidecars-present so that test's
    # below-head + live-connection scenario is untouched). At
    # ensure_database's cold-start entry, colliding with an ALREADY-open
    # connection on the exact same file is near-impossible (nothing else in
    # this process has touched the profile yet). At the non-login entries
    # this function serves (admin cross-user reads, credit-reservation
    # recovery, cross-profile reel moves), that collision is routine -- e.g.
    # an admin inventory read while the profile owner is actively using the
    # app in the same worker. Blocking a request that had NOTHING to migrate
    # is a real regression (see the T4315 WAL-safety suite this fix
    # restores). Prove there is nothing to do with a lock-free read instead.
    from ..services.db_refresh import wal_sidecars_present
    if wal_sidecars_present(db_path) and _seam_at_head(db_path, PROFILE_DB_RUNNER):
        _seam_verified.add((user_id, profile_id))
        return

    key = (user_id, profile_id)
    current_thread_id = threading.get_ident()

    # T8190: same-thread re-entrancy. A migration's own up(conn) can reach
    # get_db_connection() -> ensure_database() -> run_profile_seam for THIS
    # SAME profile while this thread is already migrating it. The outer frame
    # owns the migration and will mark it verified — a nested call is a no-op.
    with _migration_locks_guard:
        if _seam_in_progress.get(key) == current_thread_id:
            return

    lock = _get_migration_lock(user_id, profile_id)
    if not lock.acquire(timeout=SEAM_LOCK_TIMEOUT_S):
        # Genuine cross-thread contention (a different request migrating this
        # same profile) — fail loud instead of hanging the requester forever.
        raise MigrationBlocked(user_id, profile_id, "lock_timeout")

    with _migration_locks_guard:
        _seam_in_progress[key] = current_thread_id
    user_token = set_current_user_id(user_id)
    profile_token = set_current_profile_id(profile_id)
    try:
        result = migrate_local_profile_db_at_seam(user_id, profile_id)
        if result.status == "wal_busy":
            from ..services.db_refresh import clear_stale_wal_sidecars
            clear_stale_wal_sidecars(db_path)
            result = migrate_local_profile_db_at_seam(user_id, profile_id)  # one retry
        if result.status == "sync_failed":
            result = _seam_repull_and_retry_profile(user_id, profile_id, db_path)
        if result.status != "ok":
            raise MigrationBlocked(user_id, profile_id, result.status)
        _seam_verified.add((user_id, profile_id))
    finally:
        reset_profile_id_token(profile_token)
        reset_user_id_token(user_token)
        with _migration_locks_guard:
            _seam_in_progress.pop(key, None)
        lock.release()


def run_user_seam(user_id: str) -> None:
    """user.sqlite sibling of `run_profile_seam` — same contract, scoped to
    `USER_DB_SCOPE` instead of a profile_id, restoring only the user
    ContextVar (user.sqlite has no profile dimension)."""
    from ..database import USER_DB_SCOPE
    from ..services.user_db import _get_user_db_path
    from ..user_context import reset_user_id_token, set_current_user_id

    db_path = _get_user_db_path(user_id)
    if not db_path.exists() or (user_id, USER_DB_SCOPE) in _seam_verified:
        return

    # T5085 (CI escalation): sibling of run_profile_seam's identical guard --
    # see that function's comment for the full rationale.
    from ..services.db_refresh import wal_sidecars_present
    if wal_sidecars_present(db_path) and _seam_at_head(db_path, USER_DB_RUNNER):
        _seam_verified.add((user_id, USER_DB_SCOPE))
        return

    key = (user_id, USER_DB_SCOPE)
    current_thread_id = threading.get_ident()

    # T8190: same-thread re-entrancy — see run_profile_seam's identical guard.
    with _migration_locks_guard:
        if _seam_in_progress.get(key) == current_thread_id:
            return

    lock = _get_migration_lock(user_id, USER_DB_SCOPE)
    if not lock.acquire(timeout=SEAM_LOCK_TIMEOUT_S):
        raise MigrationBlocked(user_id, None, "lock_timeout")

    with _migration_locks_guard:
        _seam_in_progress[key] = current_thread_id
    user_token = set_current_user_id(user_id)
    try:
        result = migrate_local_user_db_at_seam(user_id)
        if result.status == "wal_busy":
            from ..services.db_refresh import clear_stale_wal_sidecars
            clear_stale_wal_sidecars(db_path)
            result = migrate_local_user_db_at_seam(user_id)  # one retry
        if result.status == "sync_failed":
            result = _seam_repull_and_retry_user(user_id, db_path)
        if result.status != "ok":
            raise MigrationBlocked(user_id, None, result.status)
        _seam_verified.add((user_id, USER_DB_SCOPE))
    finally:
        reset_user_id_token(user_token)
        with _migration_locks_guard:
            _seam_in_progress.pop(key, None)
        lock.release()


def get_migration_status() -> dict:
    return {
        "user_db": {"latest_version": USER_DB_RUNNER.latest_version},
        "profile_db": {"latest_version": PROFILE_DB_RUNNER.latest_version},
        "postgres": {"latest_version": PG_RUNNER.latest_version},
    }


def get_migration_status_for_user(user_id: str) -> dict:
    """READ-ONLY: report code head versions PLUS the ACTUAL R2 PRAGMA user_version of
    each of one user's registered profiles, WITHOUT running any migration.

    Closes the "no way to ask what has been run" gap (T5970 / memory
    project_migration_tracking_gap): before this, the only way to learn a DB's real
    schema version was to RUN run_all_migrations (mutating, walks every user's R2 DB).
    This probes a SINGLE user and is side-effect-free — each profile.sqlite is
    downloaded to a temp file to read its version and immediately deleted (see
    _read_r2_profile_user_version); nothing is written back to R2.
    """
    from ..services.user_db import ensure_user_database, get_profiles

    head = PROFILE_DB_RUNNER.latest_version
    status: dict = {
        **get_migration_status(),
        "user_id": user_id,
        "profiles": [],
        "all_profiles_at_head": True,
    }
    try:
        ensure_user_database(user_id)  # first-access restore only (read-only, no upload)
        profiles = get_profiles(user_id)
    except Exception as e:
        status["error"] = f"profile_registry_read_failed: {e}"
        status["all_profiles_at_head"] = None
        return status

    for p in profiles:
        pid = p["id"]
        r2_version = _read_r2_profile_user_version(user_id, pid)
        # None => R2 copy missing/unreadable; report as unknown, never "at head".
        at_head = None if r2_version is None else (r2_version == head)
        if at_head is not True:
            status["all_profiles_at_head"] = False
        status["profiles"].append({
            "profile_id": pid,
            "r2_user_version": r2_version,
            "profile_db_head": head,
            "at_head": at_head,
        })
    return status


def run_all_migrations() -> dict:
    from ..services.auth_db import get_all_users_for_admin

    results = {
        "postgres": {"applied": [], "current_version": None, "latest_version": PG_RUNNER.latest_version, "error": None},
        "users": {"total": 0, "migrated": 0, "skipped": 0, "errors": [], "orphans": []},
    }

    # 1. Postgres (run once)
    _migrate_postgres(results)

    # 2. Per-user SQLite DBs
    users = get_all_users_for_admin()
    results["users"]["total"] = len(users)

    for user in users:
        user_id = user["user_id"]
        try:
            user_result = _migrate_user(user_id)

            for pid in user_result["orphans"]:
                results["users"]["orphans"].append({"user_id": user_id, "profile_id": pid})

            for err in user_result["errors"]:
                results["users"]["errors"].append({"user_id": user_id, **err})

            # A user is migrated/skipped ONLY when all registered profiles verified at head.
            if not user_result["errors"]:
                if user_result["any_applied"]:
                    results["users"]["migrated"] += 1
                else:
                    results["users"]["skipped"] += 1
        except Exception as e:
            logger.error(f"[Migration] Error migrating user {user_id}: {e}")
            results["users"]["errors"].append({"user_id": user_id, "error": str(e)})

    return results


def _migrate_postgres(results: dict) -> None:
    from ..services.pg import get_pg

    try:
        with get_pg() as conn:
            applied = PG_RUNNER.run(conn, "postgres")
            results["postgres"]["applied"] = [
                {"version": m.version, "description": m.description}
                for m in applied
            ]
            results["postgres"]["current_version"] = PG_RUNNER.get_current_version(conn, "postgres")
    except Exception as e:
        logger.error(f"[Migration] Postgres migration error: {e}")
        results["postgres"]["error"] = str(e)


def _migrate_user(user_id: str) -> dict:
    """
    Migrate all registered profiles for a user.

    Returns dict with keys:
      any_applied: bool  — at least one profile or user.sqlite had pending migrations
      errors: list[dict] — per-profile failures (profile_id, reason, r2_version?)
      orphans: list[str] — R2 profile IDs not in registry (informational, not migrated)
    """
    from ..services.user_db import get_profiles

    errors: list[dict] = []
    orphans: list[str] = []
    any_applied = False

    # Migrate user.sqlite first; ensure_user_database inside restores from R2
    user_db_applied = _migrate_user_db(user_id)
    if user_db_applied:
        any_applied = True

    # Registry is authoritative — only registered profiles are "real"
    try:
        registered_ids = {p["id"] for p in get_profiles(user_id)}
    except Exception as e:
        logger.error(f"[Migration] Failed to read profile registry for {user_id}: {e}")
        return {
            "any_applied": any_applied,
            "errors": [{"profile_id": None, "reason": f"registry_read_failed: {e}"}],
            "orphans": [],
        }

    # Detect orphans: R2 dirs not in registry (log + report, never migrate)
    r2_ids = set(_get_profile_ids(user_id))
    for pid in sorted(r2_ids - registered_ids):
        logger.warning("[Migration] Orphan profile %s for user %s — not in registry; skipping", pid, user_id)
        orphans.append(pid)

    # Migrate each registered profile
    for profile_id in sorted(registered_ids):
        try:
            result = _migrate_profile_db(user_id, profile_id)
            if result.applied:
                any_applied = True
            if result.status != "ok":
                errors.append({
                    "profile_id": profile_id,
                    "reason": result.status,
                    "r2_version": result.r2_version,
                })
        except Exception as e:
            logger.error("[Migration] Exception migrating profile %s for %s: %s", profile_id, user_id, e)
            errors.append({"profile_id": profile_id, "reason": f"exception: {e}", "r2_version": None})

    return {"any_applied": any_applied, "errors": errors, "orphans": orphans}


def _migrate_user_db(user_id: str) -> list:
    from ..database import sync_user_db_to_r2_explicit
    from ..services.user_db import _get_user_db_path, ensure_user_database

    ensure_user_database(user_id)
    db_path = _get_user_db_path(user_id)
    if not db_path.exists():
        return []

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        applied = USER_DB_RUNNER.run(conn, "sqlite")
    finally:
        conn.close()

    if applied:
        sync_user_db_to_r2_explicit(user_id)

    return applied


def _migrate_profile_db(user_id: str, profile_id: str) -> MigrateResult:
    """
    Migrate a single registered profile DB.

    Always migrates the canonical R2 copy (force-download), with a guard:
    if local is AHEAD of R2 (unsynced local writes), syncs local up first.
    Verifies in R2 after every run.  Returns MigrateResult; status "ok" means
    the profile verified at head in R2.
    """
    from ..database import (
        USER_DATA_BASE,
        clear_sync_pending,
        get_local_db_version,
        read_pending_token,
        set_local_db_version,
        sync_db_to_r2_explicit,
    )
    from ..profile_context import set_current_profile_id
    from ..storage import get_r2_client
    from ..user_context import set_current_user_id

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)

    client = get_r2_client()

    if client:
        # Force-download the canonical R2 copy to a temp file. T6340: this fetches
        # the bytes AND their sync version (x-amz-meta-db-version) in one atomic
        # get_object, so downloaded_sync_version provably matches these bytes.
        tmp_path = db_path.with_name("profile.sqlite.migrating_tmp")
        tmp_path.unlink(missing_ok=True)

        try:
            found, downloaded_sync_version = _download_profile_db(user_id, profile_id, tmp_path)
        except Exception as e:
            logger.warning("[Migration] Download failed for %s/%s: %s", user_id, profile_id, e)
            return MigrateResult(status="download_failed", applied=[])

        if found and tmp_path.exists():
            r2_version = _read_sqlite_user_version(tmp_path)
            local_version = _read_sqlite_user_version(db_path) if db_path.exists() else -1

            # T6410: the SYNC baseline (mirrors R2's x-amz-meta-db-version) is
            # independent of PRAGMA user_version and is the only signal that says
            # anything about DATA recency. A local write never advances it (only a
            # successful upload/restore does), so baseline == R2 version means "R2's
            # bytes plus whatever this machine hasn't uploaded yet" — NOT "these two
            # copies are identical".
            local_baseline = get_local_db_version(user_id, profile_id) if db_path.exists() else None

            if local_version > r2_version:
                # Local SCHEMA is AHEAD of R2 (unsynced local writes): keep the
                # local file and sync it UP. We do NOT record a baseline here — the
                # local file already carries its own confirmed db_version row from
                # whatever write advanced it. If that SYNC baseline is genuinely
                # stale relative to R2 (the second live refusal shape: a real
                # loaded=v2696 r2=v2697 conflict, NOT the swap path's None
                # baseline), CAS SHOULD refuse — do NOT force-push here, refusing a
                # genuinely unconfirmed copy is correct. Surface the real R2 sync
                # version in the error row (T6340 #3), never null.
                tmp_path.unlink(missing_ok=True)
                set_current_user_id(user_id)
                set_current_profile_id(profile_id)
                if not sync_db_to_r2_explicit(user_id, profile_id):
                    return MigrateResult(
                        status="sync_failed", applied=[],
                        r2_version=_r2_version_or_none(user_id, profile_id),
                    )
                # db_path stays as-is (already newer than R2 was)
            elif (db_path.exists() and local_baseline is not None
                    and local_baseline > 0 and local_baseline >= downloaded_sync_version):
                # T6410: local is not behind R2 on the SYNC version, so R2's copy
                # cannot hold anything local lacks — but local CAN hold committed
                # writes that never uploaded (deferred/failed sync). Swapping R2's
                # bytes over it would discard them, and post-T6340 that discard
                # becomes canonical (uploads at r2_version+1). Keep local, migrate it
                # in place, and let the existing post-migration sync (below) carry the
                # migration AND the pending writes up together. Mirrors
                # restore-if-newer (database.py / user_db.py) — every other in-place
                # swap in the codebase is version-gated; this one was not.
                #
                # Bounds (both load-bearing, do not relax):
                #   baseline None -> unconfirmed, cannot prove local isn't behind ->
                #     swap (this is T6340's original case and must keep working
                #     unchanged).
                #   baseline == 0 -> "no version information" (assigned when a fresh
                #     local DB is created and R2 had no object yet). Excluding it
                #     prevents an empty local DB from being kept and uploaded over a
                #     real legacy R2 object.
                #   >= not ==     -> a baseline ABOVE R2 means R2 went backwards
                #     (out-of-band edit); local still holds strictly more history, so
                #     keeping it is the safe side (storage.py's CAS computes
                #     max(r2, current)+1 regardless).
                tmp_path.unlink(missing_ok=True)
                logger.info(
                    "[Migration] Keeping local profile.sqlite for %s/%s - local sync baseline "
                    "v%s >= R2 v%s (R2 has nothing local lacks); migrating the local copy so "
                    "unsynced writes are preserved and uploaded",
                    user_id, profile_id, local_baseline, downloaded_sync_version,
                )
                if local_version < r2_version:
                    logger.warning(
                        "[Migration] %s/%s: local schema v%s is BEHIND R2 v%s despite an "
                        "at-or-ahead sync baseline (v%s >= v%s) - version-tracking anomaly; "
                        "migrating local and relying on the post-run R2 verify",
                        user_id, profile_id, local_version, r2_version,
                        local_baseline, downloaded_sync_version,
                    )
                # db_path stays as-is; the post-migration sync below uploads it
            else:
                # R2 is canonical: overwrite local with the downloaded copy, then
                # record the DOWNLOADED copy's sync version as the confirmed local
                # baseline. T6340 (the whole fix): the swapped-in R2 bytes' internal
                # db_version row (if any) is NOT authoritative for sync — the sync
                # version lives in R2 object metadata (x-amz-meta-db-version), and a
                # normally-synced object carries an INTERNAL db_version row equal to
                # metadata_version - 1 (database.py:~1521 persists the row AFTER the
                # upload, so the bytes uploaded at metadata vN internally read vN-1).
                # So without recording the metadata version, get_local_db_version
                # returns either None (re-heal / never-synced object with no row) or
                # a STALE vN-1 — either way storage.py's CAS guard refuses the
                # post-migration upload (BLOCKING-2 for None; a stale-baseline
                # conflict for vN-1) and no profile_db migration reaches R2.
                # downloaded_sync_version came from the SAME get_object response as
                # these bytes, so no separate HEAD can observe a version newer than
                # the bytes on disk (that window would let us force-push OLDER bytes
                # at a bumped version — a clobber). Recording it (INSERT OR REPLACE
                # overrides any stale persisted row) lets the later sync see
                # current_version == r2_version and upload r2_version+1. NEVER
                # fabricate a baseline (T4315): if the download yielded no real int
                # version, leave it unset (None) and let CAS refuse.
                #
                # WAL safety (mirrors database.py:~727 first-access restore): this
                # swap runs on a LIVE Fly machine serving requests. profile.sqlite is
                # WAL mode; if a live connection holds it open (or a crash left them),
                # a -wal from the OLD file sits beside it and the next connection
                # would replay those frames onto the swapped-in NEW file (cross-DB
                # page mixing) — and the baseline fix above would then make that
                # page-mixed result UPLOADABLE at r2_version+1 (pre-fix, CAS refused
                # the upload so the damage stayed local). A live connection blocks
                # only the swap: refuse and let a later migrate run retry.
                from ..services.db_refresh import clear_stale_wal_sidecars, wal_sidecars_present
                if wal_sidecars_present(db_path):
                    tmp_path.unlink(missing_ok=True)
                    logger.warning(
                        "[Migration] WAL sidecar present for %s/%s — refusing swap "
                        "(live connection or stale crash sidecar); retry later",
                        user_id, profile_id,
                    )
                    return MigrateResult(status="wal_busy", applied=[])
                # T5081 (INV-P reason b, site 5): same class of swap as
                # ensure_database's first-access restore -- capture the pending
                # token before the swap, clear only if unchanged after. See the
                # INV-P comment in database.py.
                pending_token = read_pending_token(user_id, profile_id)
                shutil.move(str(tmp_path), str(db_path))
                # Defense-in-depth for the window between the check above and the
                # move completing (a new connection could open mid-swap).
                clear_stale_wal_sidecars(db_path)
                set_local_db_version(user_id, profile_id, downloaded_sync_version)
                clear_sync_pending(user_id, profile_id, if_token=pending_token)
        elif not found:
            # Key not in R2 — registered profile has no R2 object (fail loud)
            return MigrateResult(status="missing", applied=[])
        else:
            # found=True but file missing: shouldn't happen, treat as download failure
            return MigrateResult(status="download_failed", applied=[])
    else:
        # Local-only mode (no R2 configured)
        if not db_path.exists():
            return MigrateResult(status="missing", applied=[])

    # Set context vars needed by migrations that read them (e.g. v002 get_current_user_id)
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        applied = PROFILE_DB_RUNNER.run(conn, "sqlite")
    finally:
        conn.close()

    if applied and client and not sync_db_to_r2_explicit(user_id, profile_id):
        # T6340 #3: thread the REAL R2 sync version into the error row instead
        # of null (which made a CAS refusal read as an R2 outage). One HEAD,
        # and ONLY on the failure path — never added to the success path.
        return MigrateResult(
            status="sync_failed", applied=applied,
            r2_version=_r2_version_or_none(user_id, profile_id),
        )

    # Always verify in R2 (when R2 available): re-download and assert user_version == head
    if client:
        head = PROFILE_DB_RUNNER.latest_version
        verified = _read_r2_profile_user_version(user_id, profile_id)
        if verified != head:
            return MigrateResult(status="not_at_head", applied=applied, r2_version=verified)

    return MigrateResult(status="ok", applied=applied)


def _get_profile_ids(user_id: str) -> list[str]:
    from ..database import USER_DATA_BASE
    from ..storage import APP_ENV, R2_BUCKET, get_r2_client

    client = get_r2_client()
    if not client:
        profiles_dir = USER_DATA_BASE / user_id / "profiles"
        if not profiles_dir.exists():
            return []
        return [
            d.name for d in profiles_dir.iterdir()
            if d.is_dir() and (d / "profile.sqlite").exists()
        ]

    prefix = f"{APP_ENV}/users/{user_id}/profiles/"
    try:
        response = client.list_objects_v2(Bucket=R2_BUCKET, Prefix=prefix, Delimiter="/")
        profile_ids = []
        for cp in response.get("CommonPrefixes", []):
            parts = cp["Prefix"].rstrip("/").split("/")
            profile_ids.append(parts[-1])
        return profile_ids
    except Exception as e:
        logger.warning(f"[Migration] Failed to list profiles for {user_id}: {e}")
        return []


def _is_not_found_error(client, e) -> bool:
    """True if an R2 client error means the object does not exist (vs. transient)."""
    is_not_found = False
    if hasattr(e, "response"):
        code = (e.response or {}).get("Error", {}).get("Code", "")
        is_not_found = code in ("NoSuchKey", "404", "NoSuchBucket")
    if not is_not_found and hasattr(client, "exceptions") and hasattr(client.exceptions, "NoSuchKey"):
        is_not_found = is_not_found or isinstance(e, client.exceptions.NoSuchKey)
    return is_not_found


def _download_profile_db(user_id: str, profile_id: str, local_path) -> tuple[bool, int | None]:
    """
    Download profile.sqlite from R2 to local_path, returning (found, sync_version).

    T6340: fetches the object body AND its x-amz-meta-db-version metadata in a
    SINGLE client.get_object round trip, so the returned sync_version provably
    corresponds to the exact bytes written to local_path. A separate HEAD after
    the download could observe a version newer than the bytes on disk (R2 moved
    mid-download); recording THAT as the confirmed baseline would later force-push
    the older bytes over newer R2 data at a bumped version (a clobber, worse than
    the bug this closes). One call, no window.

    Returns:
      (True, version)  — downloaded; `version` is the object's sync version
                         (0 for a legacy object with no db-version metadata,
                         matching get_db_version_from_r2's legacy handling).
      (False, None)    — key not in R2 (or no R2 client).
    Raises on any OTHER download error (fail loud — caller returns download_failed).
    Accepts both Path and str for local_path.
    """
    from ..storage import APP_ENV, R2_BUCKET, get_r2_client

    local_path = Path(local_path)  # fix Path/str bug: ensure .parent works
    client = get_r2_client()
    if not client:
        return False, None

    key = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
    try:
        response = client.get_object(Bucket=R2_BUCKET, Key=key)
        body = response["Body"].read()
        metadata = response.get("Metadata", {}) or {}
        version_str = metadata.get("db-version")
        sync_version = int(version_str) if version_str else 0
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(body)
        logger.info(f"[Migration] Downloaded profile DB from R2: {key} (sync v{sync_version})")
        return True, sync_version
    except Exception as e:
        # NoSuchKey / 404 → not found (not an error)
        if _is_not_found_error(client, e):
            return False, None
        # Any other error: propagate (fail loud — caller catches and returns download_failed)
        raise


def _r2_version_or_none(user_id: str, profile_id: str) -> int | None:
    """Best-effort REAL R2 sync version for a profile, for populating the
    r2_version field of a FAILED migration's error row (T6340 #3).

    get_db_version_from_r2 returns int | R2VersionResult — coerce the enum
    (NOT_FOUND / ERROR) to None so a R2VersionResult NEVER leaks into the JSON
    response as a version. One HEAD, and ONLY on the failure path (the success
    path already knows the version from the upload); never added to the hot path.
    """
    from ..storage import get_db_version_from_r2
    try:
        v = get_db_version_from_r2(user_id, profile_id=profile_id)
    except Exception as e:
        logger.warning("[Migration] r2_version lookup failed for %s/%s: %s", user_id, profile_id, e)
        return None
    return v if isinstance(v, int) else None


def _read_sqlite_user_version(db_path: Path) -> int:
    """Read PRAGMA user_version from a SQLite file. Returns 0 on any read error."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        try:
            return conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()
    except Exception:
        return 0


def _read_r2_profile_user_version(user_id: str, profile_id: str) -> int | None:
    """
    Re-download profile.sqlite from R2 to a temp file and read PRAGMA user_version.
    Returns the version, or None on any failure (download error, not found, unreadable).
    Used for post-migration verification.
    """
    from ..database import USER_DATA_BASE

    tmp_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite.verify_tmp"
    try:
        downloaded, _sync_version = _download_profile_db(user_id, profile_id, tmp_path)
        if not downloaded or not tmp_path.exists():
            return None
        return _read_sqlite_user_version(tmp_path)
    except Exception as e:
        logger.warning("[Migration] Failed to verify R2 version for %s/%s: %s", user_id, profile_id, e)
        return None
    finally:
        tmp_path.unlink(missing_ok=True)
