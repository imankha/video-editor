"""
T4315 — the shared write-path guarantee: "this copy is confirmed current, or
the writer refuses." Generalizes two landed point-fixes into one call:

- materialization.ensure_profile_db_local(require_fresh=True) (a5ff3e48,
  move_reels)
- admin._refresh_target_user_db (fec38d12, credit grants)

Sibling of T4310 (upload-side CAS, database.py/storage.py): CAS refuses a
stale UPLOAD; confirm_current_before_write refuses a stale WRITE by pulling
R2's newer copy first (or raising if R2 can't be confirmed). Neither alone
closes the loop -- see docs/plans/tasks/durability-sync/T4310-T4315-design.md.
"""

import logging
import sqlite3
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# T4315 round 2 (MAJOR-4): lets get_user_db_connection's structural foreign-
# user guard (user_db.py) skip a REDUNDANT HEAD when this exact user was
# just confirmed moments ago (e.g. admin.py/payments.py already called
# confirm_current_before_write explicitly right before opening the
# connection). Without this, the structural guard would double the HEAD for
# every already-correct caller and, worse, could put a second blocking HEAD
# directly on the event loop thread even when the first one was already
# safely off-thread -- defeating the exact T2720 precaution those callers
# took. A short window is enough: this is a safety net for callers that
# never called confirm_current_before_write at all, not a cache for its own
# sake. NOTE (round 3 MINOR): this marker is process-global, keyed only by
# user_id -- NOT scoped to "the same call chain" despite how that reads;
# any two confirms for the same user within the window share it, request or
# background thread. Entries self-evict lazily (checked/dropped on read),
# so the dict never grows past the number of DISTINCT users confirmed in
# the last _CONFIRM_FRESHNESS_WINDOW_SECONDS.
_CONFIRMED_RECENTLY: dict[str, float] = {}
_CONFIRMED_LOCK = threading.Lock()
_CONFIRM_FRESHNESS_WINDOW_SECONDS = 5.0


def _mark_user_db_recently_confirmed(user_id: str) -> None:
    with _CONFIRMED_LOCK:
        _CONFIRMED_RECENTLY[user_id] = time.monotonic()


def user_db_was_recently_confirmed(user_id: str) -> bool:
    """True if confirm_current_before_write(user_id) (profile_id=None)
    succeeded within the last few seconds -- see the module note above."""
    with _CONFIRMED_LOCK:
        ts = _CONFIRMED_RECENTLY.get(user_id)
        if ts is None:
            return False
        if (time.monotonic() - ts) >= _CONFIRM_FRESHNESS_WINDOW_SECONDS:
            # Lazy eviction: expired entries are dropped on the next read
            # for that user rather than accumulating forever.
            del _CONFIRMED_RECENTLY[user_id]
            return False
        return True


class RefreshFailed(RuntimeError):
    """R2 could not confirm the local copy is current, so a WRITER must
    refuse rather than build on (and then force-push) a stale or
    unconfirmed snapshot. Never raised for readers -- a stale read is
    tolerable, a stale write silently reverts committed data (T4310/T4315's
    reason for existing)."""


def _sidecar_paths(db_path: Path) -> tuple[Path, Path]:
    return (
        db_path.parent / f"{db_path.name}-wal",
        db_path.parent / f"{db_path.name}-shm",
    )


def wal_sidecars_present(db_path: Path) -> bool:
    """True if a -wal or -shm sidecar exists for db_path right now.

    SQLite deletes both when the LAST connection to a WAL-mode database
    closes cleanly. So sidecars existing at an inspection point means either
    a prior crash left them, or -- the common case on a live server -- a
    connection is open on this exact file RIGHT NOW. Callers use this as a
    "is this DB in use" signal BEFORE attempting a restore-if-newer swap
    (see confirm_current_before_write callers): a live connection's
    committed-but-not-yet-checkpointed frames can hold data never uploaded
    to R2 -- "R2 is newer" says nothing about whether those frames matter,
    so the safe move is to refuse the swap, not discard them.
    """
    wal, shm = _sidecar_paths(db_path)
    return wal.exists() or shm.exists()


def clear_stale_wal_sidecars(db_path: Path) -> None:
    """Delete -wal/-shm sidecars for db_path immediately after a restore-if-
    newer download has just replaced its content.

    WAL hazard (the reason T4310 dropped its post-conflict re-download): the
    R2 download already swaps the main file atomically (boto3's
    download_file writes to a temp path and renames into place), so a
    concurrent opener never sees a torn main file. But the OLD file's
    -wal/-shm sidecars are separate, fixed-name files the rename does not
    touch -- if left in place, the next connection would replay WAL frames
    written against the OLD content onto the NEW file's (differently
    laid-out) pages, corrupting it via cross-DB page mixing.

    T4315 round 2 (MAJOR-3) correction: this function alone does NOT make
    the swap safe, and "nothing in the old WAL is worth preserving" is only
    true when no connection is concurrently using the file (see
    wal_sidecars_present's docstring -- sidecars existing usually means one
    is). Callers MUST call wal_sidecars_present(db_path) and refuse the
    restore attempt BEFORE calling the download primitive when it returns
    True, so the download (and this cleanup) only ever run when no sidecars
    were observed going in. This function's own unlink is defense-in-depth
    for the narrow remaining window between that pre-check and the download
    completing (a new connection could theoretically open mid-download) --
    it is not, by itself, a synchronization guarantee.
    """
    for sidecar in _sidecar_paths(db_path):
        try:
            sidecar.unlink()
        except FileNotFoundError:
            pass
        except OSError as e:
            # T4315 round 2 (MINOR): on Windows, unlinking a file another
            # process/handle still has open raises PermissionError, not
            # FileNotFoundError -- catching only the latter let this escape
            # as a bare OSError, which callers' `except RefreshFailed` /
            # `except ProfileDBRefreshFailed` do NOT catch (a 500 on the
            # grant path, and a leaked sharer_conn in materialize_game_share
            # instead of the intended clean refusal). Log and continue: a
            # sidecar we couldn't remove is a hygiene issue, not a reason to
            # fail the write that already completed its (safety-checked) swap.
            logger.warning(f"[T4315] Could not remove stale sidecar {sidecar}: {e}")


def clear_wal_sidecars_if_unheld(db_path: Path) -> bool:
    """Migration-seam-only sibling of `clear_stale_wal_sidecars`: clear the
    sidecars ONLY after proving no live connection holds db_path open, so the
    seam's `wal_busy` retry never unlinks a LIVE connection's WAL.

    Why the seam needs this and the other callers do NOT (T5086):
    `clear_stale_wal_sidecars`'s six other callers only run AFTER a
    restore-if-newer download that already proved (`before_download=lambda:
    not wal_sidecars_present`) no sidecars were present going in — the sidecar
    they clear is a narrow-window artifact of a JUST-SWAPPED main file, and
    opening a probe CONNECTION there could replay a stale WAL onto the fresh
    main file (the very cross-DB page-mixing hazard). The seam's `wal_busy`
    retry is the opposite situation: NO swap happened, `wal_sidecars_present`
    was True usually because a connection is genuinely LIVE on the CURRENT
    file, and the old blind `unlink()` — a POSIX no-op-that-succeeds on an
    open file on Linux (prod), silently destroying the live connection's WAL —
    is exactly the bug. Here the WAL is consistent with the current main file,
    so a probe connection is safe.

    Discriminator (verified empirically on Linux, T5086; the T5085
    investigation first found it on Windows): open with a short busy timeout,
    force `locking_mode=EXCLUSIVE`, then `BEGIN IMMEDIATE`. Acquiring the
    exclusive lock needs sole ownership of the WAL's shared-memory index, so a
    live WRITER *or* a live idle READER makes it raise
    `OperationalError: database is locked` — no live holder lets it succeed.

    Returns:
      True  — no live holder; sidecars were cleared (safe to migrate/retry).
      False — a live connection holds the file (REFUSED, nothing unlinked) OR
              the probe hit an unexpected error. Either way the caller must
              leave its result as `wal_busy` so the seam raises
              MigrationBlocked (-> retryable HTTP 503), never a raw 500 and
              never a silent unlink. Fail-loud: the unexpected-error branch
              logs at CRITICAL rather than swallowing.
    """
    try:
        conn = sqlite3.connect(str(db_path), timeout=0.2)
    except sqlite3.Error as e:
        logger.critical(
            f"[T5086] WAL-holder probe could not open {db_path}: {e} — "
            f"refusing to clear sidecars (seam surfaces wal_busy)"
        )
        return False

    try:
        conn.execute("PRAGMA locking_mode=EXCLUSIVE")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("COMMIT")
    except sqlite3.OperationalError as e:
        if "locked" in str(e).lower():
            # A live connection genuinely holds the file — the designed refuse
            # path. Nothing is unlinked; the seam's result stays wal_busy.
            logger.info(
                f"[T5086] {db_path} is held by a live connection — refusing "
                f"to clear WAL sidecars, seam will surface wal_busy"
            )
        else:
            logger.critical(
                f"[T5086] Unexpected OperationalError probing {db_path}: {e} — "
                f"refusing to clear sidecars (fail-loud, seam surfaces wal_busy)"
            )
        return False
    except sqlite3.Error as e:
        logger.critical(
            f"[T5086] Unexpected error probing {db_path}: {e} — refusing to "
            f"clear sidecars (fail-loud, seam surfaces wal_busy)"
        )
        return False
    finally:
        # Always release the EXCLUSIVE lock — a leaked probe connection would
        # itself become the live holder that blocks every later retry.
        conn.close()

    # No live holder. The clean EXCLUSIVE close above already checkpoints and
    # usually removes the sidecars; clear explicitly to GUARANTEE removal
    # (proven-safe now: we just held the file exclusively and let go).
    clear_stale_wal_sidecars(db_path)
    return True


def confirm_current_before_write(user_id: str, profile_id: str | None = None) -> None:
    """The one write-path guard: confirm the local copy is current, or raise
    RefreshFailed. Matches the design's confirm_current_before_write
    (T4310-T4315-design.md section 2).

    profile_id=None -> user.sqlite (services.user_db.ensure_user_database_fresh).
    profile_id given -> that profile's profile.sqlite
    (services.materialization.ensure_profile_db_local(require_fresh=True)).

    Every writer that resolves a DB it does not already hold under the
    request's own session/profile context (admin credit grants, teammate
    share materialization, cross-profile reel moves) must call this before
    mutating, instead of hand-rolling its own refresh -- the guard lives
    here exactly once.

    T5081: does NOT report whether a download happened. An earlier version of
    this fix tried to plumb that out to gate a .sync_pending clear at the
    caller -- wrong seam: by the time a caller like a CAS-conflict retry
    reaches this, the reheal-triggered re-pull has usually already happened
    via an ORDINARY request (ensure_database/ensure_user_database's own
    first-access restore, triggered by schedule_*_db_reheal nulling the
    version), so this call sees "already current" and reports no download
    even though the scope genuinely was just restored moments earlier by a
    different code path. The clear for INV-P reason (b) now lives at every
    site that actually performs the download+swap (ensure_database,
    ensure_user_database, ensure_user_database_fresh,
    materialization.ensure_profile_db_local -- T5087 deleted a fifth site,
    migrations._migrate_profile_db, once JIT retired the bulk sweep)
    -- see the INV-P comment in database.py. Callers here don't need to know
    which of them (if any) fired.
    """
    if profile_id is None:
        from .user_db import ensure_user_database_fresh
        ensure_user_database_fresh(user_id)
        _mark_user_db_recently_confirmed(user_id)
    else:
        from .materialization import ensure_profile_db_local
        ensure_profile_db_local(user_id, profile_id, require_fresh=True)
