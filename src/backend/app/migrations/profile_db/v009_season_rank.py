"""
v009 (T3630): Reel ranking model.

Adds two columns to final_videos and one settings table:

1. season_rank REAL NULL -- sparse fractional user rank (insertion gestures only;
   NO backfill: existing reels start unranked by design).
2. quality_score REAL NULL -- frozen at export-finalize = the reel's SINGLE clip's
   rating (1-5), and ONLY for single-clip reels. Multi-clip reels stay NULL.
   `quality_score IS NOT NULL` therefore doubles as the single-clip marker
   (rating is NOT NULL, so any single-clip reel always gets a score). Backfilled
   here from live working data, else from the R2 project archive (mirrors v008).
3. collection_settings(key, value) -- per-profile key/value knobs (T3640's
   season_target_duration is the first user). Created here so v009 is the epic's
   last profile_db migration.

Runs inside the migration runner, which sets user/profile context vars before
up() -- required for the R2 archive reads in the quality_score backfill.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V009SeasonRank(BaseMigration):
    version = 9
    description = "Add season_rank + quality_score to final_videos; collection_settings table"

    def up(self, conn) -> None:
        conn.row_factory = sqlite3.Row

        conn.execute(
            """CREATE TABLE IF NOT EXISTS collection_settings (
                   key TEXT PRIMARY KEY,
                   value TEXT
               )"""
        )

        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        for col in ("season_rank REAL", "quality_score REAL"):
            try:
                conn.execute(f"ALTER TABLE final_videos ADD COLUMN {col}")
            except Exception:
                pass  # idempotent re-run

        self._backfill_quality(conn)

    def _backfill_quality(self, conn) -> None:
        cursor = conn.cursor()
        rows = conn.execute(
            "SELECT id, project_id, game_id, source_type FROM final_videos "
            "WHERE quality_score IS NULL"
        ).fetchall()

        for row in rows:
            try:
                self._backfill_row(conn, cursor, row)
            except Exception as e:
                logger.error(
                    f"[T3630] final_video {row['id']} quality_score backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.collection_metadata import (
            compute_project_quality_score,
            compute_archive_quality_score,
        )
        from app.services.project_archive import load_archive

        fv_id = row["id"]
        project_id = row["project_id"]

        # quality_score is single-clip-only: the helper returns the lone clip's
        # rating, or None when the reel has != 1 constituent clip (multi-clip /
        # game-summary). Routing mirrors v008's game_ids backfill.
        score = None
        if project_id is not None:
            score = compute_project_quality_score(cursor, project_id)
            if score is None:
                proj = conn.execute(
                    "SELECT archived_at FROM projects WHERE id = ?",
                    (project_id,),
                ).fetchone()
                working_data_gone = proj is None or proj["archived_at"] is not None
                if working_data_gone:
                    archive = load_archive(project_id)
                    if archive:
                        score = compute_archive_quality_score(cursor, archive)
        # Rows with no project (legacy annotated_game) are multi-clip game
        # summaries -> stay NULL (not collection-eligible).

        if score is None:
            return  # multi-clip / unresolvable -> NULL (Mixes, no quality order)

        conn.execute(
            "UPDATE final_videos SET quality_score = ? WHERE id = ?",
            (score, fv_id),
        )
