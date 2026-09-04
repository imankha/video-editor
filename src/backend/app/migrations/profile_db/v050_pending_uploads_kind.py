"""
v050 (T8370): pending_uploads gains `kind TEXT NOT NULL DEFAULT 'game'`.

Routes an in-progress upload session's namespace/finalize-milestone by intent
(GAME vs CLIP, `UploadKind` in constants.py) without trusting client-declared
intent at finalize time -- see games_upload.py `upload_object_key`/
`_pending_kind` and the T8370 design doc Slice A. Additive, idempotent
(PRAGMA table_info guard), no backfill needed: the column's own DEFAULT is
correct for every existing (pre-T8370, necessarily game) row.

Guarded write (T5630/T6550 pattern): a kind='clip' prepare-upload on a
below-head DB (this column absent) refuses with a retryable 503 rather than
writing a row that would default to 'game' and finalize into the wrong
namespace/milestone -- see games_upload.py `prepare_upload`'s
`column_exists(cursor, "pending_uploads", "kind")` guard.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V050PendingUploadsKind(BaseMigration):
    version = 50
    description = "Add pending_uploads.kind ('game'/'clip') for T8370 clip-upload routing"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pending_uploads'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(pending_uploads)").fetchall()}
        if "kind" not in cols:
            conn.execute("ALTER TABLE pending_uploads ADD COLUMN kind TEXT NOT NULL DEFAULT 'game'")
            logger.info("[v050] added pending_uploads.kind")
