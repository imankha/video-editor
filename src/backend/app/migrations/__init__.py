import logging
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
    """Per-profile/user migration outcome from migrate_local_profile_db_at_seam
    / migrate_local_user_db_at_seam."""
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
# asyncio write lock (design §2.7 / §3.1). A `threading.Lock` is safe from any
# thread reaching it (the event loop's own thread via asyncio.to_thread, or a
# background loop), and is never acquired by anything that also holds the
# write lock, so there is no re-entrancy deadlock across those two locks.
# Guarded by `_migration_locks_guard` against a TOCTOU
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
    """Migrate-at-load-seam primitive (design §2.3): operates on the file the
    seam's restore already downloaded+swapped — NO second download, no T6410
    keep-local tree (the seam already decided swap-vs-keep). Runs the runner
    in place, syncs to R2 only if it actually applied something, and
    re-verifies at head. (T5087 deleted the bulk-sweep primitive this used to
    share `PROFILE_DB_RUNNER`/`sync_db_to_r2_explicit`/
    `_read_r2_profile_user_version`/`_r2_version_or_none` with and cross-check
    against; this seam primitive is now the only migration path.)

    T5085 (review fix): guards the sync + verify steps below with `if client:`
    -- this primitive is reachable from non-login call sites that invoke it
    unconditionally (not just from inside `ensure_database`'s
    `if R2_ENABLED:` block), so it must tolerate R2 being disabled itself
    rather than assume its caller already gated on `R2_ENABLED`. Without
    this, a below-head profile in local/no-R2 dev mode was upgraded locally
    by the runner but then unconditionally verified against R2 --
    `_read_r2_profile_user_version` returns `None` when there's no client,
    `None != head` -> `not_at_head` -> the seam raises `MigrationBlocked` on
    every request, permanently, for a profile the runner just successfully
    brought to head."""
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
            # A migration.up() failure (a bad ALTER, a data-shape assumption
            # that doesn't hold) must surface as a MigrateResult the seam can
            # act on (-> raise MigrationBlocked -> HTTP 503), never escape as
            # a raw 500.
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
    """Migrate-at-load-seam primitive for user.sqlite, WITHOUT a leading
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
    # Logged (not silent): this is a structural violation of "migrations must
    # use their own conn, never a request-path opener" (review finding) — the
    # pass-through prevents the deadlock, but a caller reaching it at all is
    # worth knowing about, and today's schema-creation block that runs after
    # this return is idempotent-safe (CREATE TABLE/INDEX IF NOT EXISTS only,
    # no ALTER) only because no current migration/table needs otherwise.
    with _migration_locks_guard:
        if _seam_in_progress.get(key) == current_thread_id:
            logger.warning(
                f"[T8190] Same-thread seam re-entry for user={user_id[:8]} "
                f"profile={profile_id[:8]} — a migration's up() reached a "
                f"connection helper that re-enters run_profile_seam for the "
                f"profile it is already migrating; passed through safely"
            )
            return

    lock = _get_migration_lock(user_id, profile_id)
    if not lock.acquire(timeout=SEAM_LOCK_TIMEOUT_S):
        # Genuine cross-thread contention (a different request migrating this
        # same profile) — fail loud instead of hanging the requester forever.
        raise MigrationBlocked(user_id, profile_id, "lock_timeout")

    # T8190 review: the lock MUST release even if something between acquiring
    # it and the migration body raises (including the ContextVar token resets,
    # which can themselves raise) — an unreleased lock permanently wedges this
    # (user, profile) key (30s-then-503 forever) AND leaves a stale
    # _seam_in_progress entry whose thread id a later thread could recycle,
    # silently passing that thread through the seam. The lock's acquire/
    # release is therefore the OUTERMOST try/finally; everything else nests
    # inside it.
    try:
        with _migration_locks_guard:
            _seam_in_progress[key] = current_thread_id
        try:
            user_token = set_current_user_id(user_id)
            profile_token = set_current_profile_id(profile_id)
            try:
                result = migrate_local_profile_db_at_seam(user_id, profile_id)
                if result.status == "wal_busy":
                    # T5086: probe for a LIVE holder before clearing. On Linux
                    # (prod) a blind unlink of a live connection's -wal SUCCEEDS
                    # silently and corrupts it; the sibling refuses in that case
                    # (returns False -> result stays wal_busy -> MigrationBlocked
                    # below). Only retry when we proved the sidecars were stale.
                    from ..services.db_refresh import clear_wal_sidecars_if_unheld
                    if clear_wal_sidecars_if_unheld(db_path):
                        result = migrate_local_profile_db_at_seam(user_id, profile_id)  # one retry
                if result.status == "sync_failed":
                    result = _seam_repull_and_retry_profile(user_id, profile_id, db_path)
                if result.status != "ok":
                    raise MigrationBlocked(user_id, profile_id, result.status)
                _seam_verified.add((user_id, profile_id))
            finally:
                reset_profile_id_token(profile_token)
                reset_user_id_token(user_token)
        finally:
            with _migration_locks_guard:
                _seam_in_progress.pop(key, None)
    finally:
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
            logger.warning(
                f"[T8190] Same-thread seam re-entry for user={user_id[:8]} "
                f"user.sqlite — a migration's up() reached a connection "
                f"helper that re-enters run_user_seam for the DB it is "
                f"already migrating; passed through safely"
            )
            return

    lock = _get_migration_lock(user_id, USER_DB_SCOPE)
    if not lock.acquire(timeout=SEAM_LOCK_TIMEOUT_S):
        raise MigrationBlocked(user_id, None, "lock_timeout")

    # T8190 review: see run_profile_seam's identical comment — the lock's
    # acquire/release must be the OUTERMOST try/finally so it always releases,
    # even if a ContextVar token reset itself raises.
    try:
        with _migration_locks_guard:
            _seam_in_progress[key] = current_thread_id
        try:
            user_token = set_current_user_id(user_id)
            try:
                result = migrate_local_user_db_at_seam(user_id)
                if result.status == "wal_busy":
                    # T5086: sibling of run_profile_seam's guard — probe for a
                    # live holder before clearing; refuse (leave wal_busy) if one
                    # holds the file so a live WAL is never unlinked on Linux.
                    from ..services.db_refresh import clear_wal_sidecars_if_unheld
                    if clear_wal_sidecars_if_unheld(db_path):
                        result = migrate_local_user_db_at_seam(user_id)  # one retry
                if result.status == "sync_failed":
                    result = _seam_repull_and_retry_user(user_id, db_path)
                if result.status != "ok":
                    raise MigrationBlocked(user_id, None, result.status)
                _seam_verified.add((user_id, USER_DB_SCOPE))
            finally:
                reset_user_id_token(user_token)
        finally:
            with _migration_locks_guard:
                _seam_in_progress.pop(key, None)
    finally:
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


def migrate_postgres() -> dict:
    """Run pending Postgres-track migrations. Admin/deploy-triggered (T5087):
    Postgres is the only track still swept in bulk -- user_db/profile_db
    migrate JIT at the per-user seam (T5083/T5085/T8190, above) and have no
    bulk-sweep counterpart anymore. See CLAUDE.md Migration System."""
    from ..services.pg import get_pg

    result = {"applied": [], "current_version": None, "latest_version": PG_RUNNER.latest_version, "error": None}
    try:
        with get_pg() as conn:
            applied = PG_RUNNER.run(conn, "postgres")
            result["applied"] = [
                {"version": m.version, "description": m.description}
                for m in applied
            ]
            result["current_version"] = PG_RUNNER.get_current_version(conn, "postgres")
    except Exception as e:
        logger.error(f"[Migration] Postgres migration error: {e}")
        result["error"] = str(e)
    return result


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
