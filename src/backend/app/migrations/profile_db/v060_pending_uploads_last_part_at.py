"""
T15040 -- v060 profile_db migration: add pending_uploads.last_part_at (TEXT, nullable).

Stamped (SQLite datetime('now'), UTC) when a session is created, when a prepare
resumes it, and on every PATCH /upload/{id}/parts save. prepare-upload reads it
to tell "another flow is uploading this file right now" (activity inside
IN_FLIGHT_WINDOW_SECONDS -> answer `in_progress`) from "the browser crashed"
(quiet -> resume). NULL on pre-existing rows means no known activity, i.e. the
crash-resume path, which is the old behaviour. No backfill.

Idempotent: the ALTER is guarded by PRAGMA table_info. Plain ALTER with no
non-constant default (SQLite forbids datetime('now') as an ALTER default).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V060PendingUploadsLastPartAt(BaseMigration):
    version = 60
    description = "Add pending_uploads.last_part_at: in-flight upload activity stamp (T15040)"

    def up(self, conn) -> None:
        # PRAGMA table_info rows are TUPLES under the runner's row factory (v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(pending_uploads)").fetchall()}
        if not cols:
            return
        if "last_part_at" not in cols:
            conn.execute("ALTER TABLE pending_uploads ADD COLUMN last_part_at TEXT")
            logger.info("[v060] added pending_uploads.last_part_at")
