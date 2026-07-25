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
from pathlib import Path

logger = logging.getLogger(__name__)


class RefreshFailed(RuntimeError):
    """R2 could not confirm the local copy is current, so a WRITER must
    refuse rather than build on (and then force-push) a stale or
    unconfirmed snapshot. Never raised for readers -- a stale read is
    tolerable, a stale write silently reverts committed data (T4310/T4315's
    reason for existing)."""


def clear_stale_wal_sidecars(db_path: Path) -> None:
    """Delete -wal/-shm sidecars for db_path after a restore-if-newer
    download has just replaced its content.

    WAL hazard (the reason T4310 dropped its post-conflict re-download):
    the R2 download already swaps the main file atomically (boto3's
    download_file writes to a temp path and renames into place), so a
    concurrent opener never sees a torn main file. But the OLD file's
    -wal/-shm sidecars are separate, fixed-name files the rename does not
    touch -- if left in place, the next connection would replay WAL frames
    written against the OLD content onto the NEW file's (differently
    laid-out) pages, corrupting it via cross-DB page mixing. The old
    content is being discarded anyway (R2 was just confirmed newer), so
    there is nothing in the old WAL worth preserving -- deleting it is
    strictly safer than leaving it.
    """
    for suffix in ("-wal", "-shm"):
        sidecar = db_path.parent / f"{db_path.name}{suffix}"
        try:
            sidecar.unlink()
        except FileNotFoundError:
            pass


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
    """
    if profile_id is None:
        from .user_db import ensure_user_database_fresh
        ensure_user_database_fresh(user_id)
    else:
        from .materialization import ensure_profile_db_local
        ensure_profile_db_local(user_id, profile_id, require_fresh=True)
