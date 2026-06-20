"""
v013: Track auto-export attempts so the sweep can retry failed games (bounded).

Before this, an auto-export failure was permanent: the sweep only selected
games with auto_export_status IS NULL, and it deleted the storage ref +
scheduled the source for grace-deletion regardless of success. A single
transient ffmpeg/network failure left the game stuck 'failed' with no recap and
its source on the chopping block (bug 23p).

The sweep now retries 'failed' games up to a cap and keeps the source until the
export settles. This column is the retry counter the cap reads.

Idempotent: only adds the column when missing.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V013AutoExportAttempts(BaseMigration):
    version = 13
    description = "Add games.auto_export_attempts for bounded auto-export retries"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'"
        ).fetchone()
        if not has_table:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()}
        if "auto_export_attempts" not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN auto_export_attempts INTEGER DEFAULT 0")
            logger.info("[v013] added games.auto_export_attempts")
