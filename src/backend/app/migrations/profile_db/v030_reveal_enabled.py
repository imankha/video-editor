"""
v030: Add working_videos.reveal_enabled -- spotlight entrance/exit reveal setting (T5250).

The reveal envelope (fade + scale-up on entrance, fade-out on exit) is an opt-in
per-project setting, alongside the existing highlight_shape/stroke_width/fill_*/
dim_strength tuning columns on the same table. Default 0 (OFF) so every existing
project keeps rendering exactly as before this feature existed until a user opts in.

Numbered v030 (not v028) because v028/v029 are claimed by sibling in-flight branches
(T5630 export_job_stages, T5640) that will co-exist with this one after merge.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V030RevealEnabled(BaseMigration):
    version = 30
    description = "Add working_videos.reveal_enabled (T5250 spotlight reveal setting, default off)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}
        if "reveal_enabled" not in cols:
            conn.execute("ALTER TABLE working_videos ADD COLUMN reveal_enabled INTEGER DEFAULT 0")
            logger.info("[v030] added working_videos.reveal_enabled")
