"""
Admin "reset test account data" -- clears project/clip data for every profile
of a flagged `is_test_account` user, in place, while preserving the account
(login/session/credits), the `profiles` rows (name/settings), and games.

This is a DATA-ONLY reset, distinct from `_reset_test_account` in
routers/auth.py (which deletes the Postgres `users` row too -- a full NUF
wipe). Mirrors what `scripts/reset_all_accounts.py` does per-user, but runs
in-process so it goes through this app's CAS/migration-seam machinery
instead of a standalone script's raw boto3/sqlite3 calls (see
.claude/knowledge/persistence-sync.md).

Caller contract: the router MUST verify `users.is_test_account` is true
(Postgres) and hold that target user's write lock
(`app.middleware.db_sync._get_user_write_lock`) before calling
`reset_test_account_data` -- this module does not re-check either, since both
are cross-cutting concerns the router already owns for every other
admin/user_id endpoint.
"""

import logging

from app.constants import ExportStatus
from app.database import (
    SyncResult,
    clear_sync_pending,
    mark_sync_pending,
    sync_db_to_r2_explicit,
)
from app.migrations import MigrationBlocked
from app.services.materialization import (
    ProfileDBRefreshFailed,
    _open_profile_db,
    ensure_profile_db_local,
)
from app.services.user_db import get_profiles
from app.storage import delete_profile_project_r2_data

logger = logging.getLogger(__name__)

# FK-safe delete order for a FK-enforcing connection (PRAGMA foreign_keys=ON,
# set by _open_profile_db): final_videos.project_id has no ON DELETE
# CASCADE/SET NULL, so it (and its CASCADE child before_after_tracks) must go
# before projects -- same ordering constraint routers/projects.py's
# delete_project works around. modal_tasks/clip_teammates cascade
# automatically from raw_clips/projects and need no explicit entry.
_TABLES_IN_DELETE_ORDER = [
    "before_after_tracks",
    "final_videos",
    "working_clips",
    "working_videos",
    "export_jobs",
    "projects",
    "raw_clips",
    "achievements",
    "pending_uploads",
]

_NON_TERMINAL_EXPORT_STATUSES = (ExportStatus.PENDING.value, ExportStatus.PROCESSING.value)


class ActiveExportInProgress(Exception):
    """A profile has a non-terminal export_jobs row -- refused, nothing changed."""


class TestAccountResetFailed(Exception):
    """A profile's R2 state could not be confirmed, or the post-clear sync did
    not reach SyncResult.OK -- never reported as a successful reset."""


def _ensure_and_open(user_id: str, profile_id: str):
    """Bring the profile DB to head and open it, or raise TestAccountResetFailed.

    Returns None only when R2 genuinely has no database for this profile
    (nothing to reset, not an error)."""
    try:
        ensure_profile_db_local(user_id, profile_id, require_fresh=True)
        return _open_profile_db(user_id, profile_id)
    except (ProfileDBRefreshFailed, MigrationBlocked) as e:
        raise TestAccountResetFailed(
            f"profile {profile_id}: could not confirm R2 state ({e})"
        ) from e


def reset_test_account_data(user_id: str) -> dict:
    """Clear project/clip data for every profile belonging to `user_id`.

    All-or-nothing on the "active export" guard: every profile is checked for
    a non-terminal export job BEFORE any profile is mutated. Once mutation
    starts, each profile's clear+sync is independent -- a later profile's
    failure does not roll back an earlier profile's already-confirmed reset
    (same spirit as the per-profile independence `ensure_background_sync`
    already has elsewhere in this codebase).

    Known gap (accepted for an admin convenience tool, not a hard guarantee):
    background writers (export_worker, modal_queue, sweep_scheduler) do not
    take the per-user write lock the router holds around this call, so a
    worker could still write a row back concurrently. The preflight export
    check narrows but does not eliminate that window.
    """
    profiles = get_profiles(user_id)
    profile_ids = [p["id"] for p in profiles]

    for profile_id in profile_ids:
        conn = _ensure_and_open(user_id, profile_id)
        if conn is None:
            continue
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM export_jobs WHERE status IN (?, ?)",
                _NON_TERMINAL_EXPORT_STATUSES,
            ).fetchone()
        finally:
            conn.close()
        if row and row["n"]:
            raise ActiveExportInProgress(
                f"profile {profile_id} has {row['n']} active export job(s) -- aborted, nothing changed"
            )

    return {"profiles_reset": [_clear_profile(user_id, pid) for pid in profile_ids]}


def _clear_profile(user_id: str, profile_id: str) -> dict:
    conn = _ensure_and_open(user_id, profile_id)
    if conn is None:
        return {"profile_id": profile_id, "skipped": "no database"}

    # INV-P: mark pending BEFORE mutating, so a crash between commit and the
    # R2 sync below still leaves a retry marker for the normal recovery path
    # (see database.py's mark_sync_pending docstring).
    token = mark_sync_pending(user_id, scope=profile_id)
    try:
        cur = conn.cursor()
        cleared = {}
        for table in _TABLES_IN_DELETE_ORDER:
            cur.execute(f"DELETE FROM {table}")
            cleared[table] = cur.rowcount
        conn.commit()
    finally:
        conn.close()

    sync_result = sync_db_to_r2_explicit(user_id, profile_id)
    if sync_result != SyncResult.OK:
        logger.error(
            f"[TestAccountReset] profile {profile_id} sync={sync_result.value} -- rows "
            f"cleared locally but NOT confirmed in R2; left the .sync_pending marker "
            f"for the normal retry path. Refusing to touch R2 media."
        )
        raise TestAccountResetFailed(
            f"profile {profile_id}: R2 sync returned {sync_result.value}"
        )
    clear_sync_pending(user_id, profile_id, if_token=token)

    # Rows-first, media-second (see module docstring): a media-delete failure
    # here only orphans storage (a cost, safely retryable), never data loss.
    try:
        deleted_objects = delete_profile_project_r2_data(user_id, profile_id)
    except Exception as e:
        logger.error(
            f"[TestAccountReset] profile {profile_id}: DB cleared and synced, but "
            f"R2 media cleanup failed: {e}"
        )
        return {
            "profile_id": profile_id, "tables_cleared": cleared,
            "r2_objects_deleted": None, "media_cleanup_error": str(e),
        }

    return {"profile_id": profile_id, "tables_cleared": cleared, "r2_objects_deleted": deleted_objects}
