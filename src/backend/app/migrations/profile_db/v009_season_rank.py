"""
v009 (T3630): Reel ranking model.

Adds two columns to final_videos and one settings table:

1. season_rank REAL NULL -- sparse fractional user rank (insertion gestures only;
   NO backfill: existing reels start unranked by design).
2. clip_count INTEGER NULL -- distinct constituent clips, frozen at export. == 1
   is the SINGLE-CLIP collection-membership signal (multi-clip / unknown -> Mixes).
   Brilliant clips are always 1 (definitional, even when the source clip is gone).
3. quality_score REAL NULL -- the lone clip's rating (1-5) for single-clip reels;
   ordering only, kept SEPARATE from clip_count so a single-clip reel with an
   unrecoverable rating still counts as single-clip. Backfilled from live working
   data, else the R2 project archive (mirrors v008); may be NULL for an orphaned
   brilliant clip whose rating is lost.
4. collection_settings(key, value) -- per-profile key/value knobs (T3640's
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

        for col in ("season_rank REAL", "clip_count INTEGER", "quality_score REAL"):
            try:
                conn.execute(f"ALTER TABLE final_videos ADD COLUMN {col}")
            except Exception:
                pass  # idempotent re-run

        self._backfill(conn)

    def _backfill(self, conn) -> None:
        cursor = conn.cursor()
        rows = conn.execute(
            "SELECT id, project_id, game_id, source_type FROM final_videos "
            "WHERE clip_count IS NULL"
        ).fetchall()

        for row in rows:
            try:
                self._backfill_row(conn, cursor, row)
            except Exception as e:
                logger.error(
                    f"[T3630] final_video {row['id']} clip_count/quality backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.collection_metadata import (
            compute_project_clip_stats,
            compute_archive_clip_stats,
        )
        from app.services.project_archive import load_archive

        fv_id = row["id"]
        project_id = row["project_id"]

        count, quality = None, None
        if project_id is not None:
            count, quality = compute_project_clip_stats(cursor, project_id)
            if count == 0:  # working data gone -> recover from the R2 archive
                proj = conn.execute(
                    "SELECT archived_at FROM projects WHERE id = ?",
                    (project_id,),
                ).fetchone()
                if proj is None or proj["archived_at"] is not None:
                    archive = load_archive(project_id)
                    if archive:
                        count, quality = compute_archive_clip_stats(cursor, archive)

        # A brilliant clip is ALWAYS single-clip, even if its source raw_clip /
        # archive is gone (orphaned) -> force clip_count=1 so it stays in its
        # collection; its quality_score may remain NULL (rating unrecoverable).
        if row["source_type"] == "brilliant_clip":
            count = 1

        # count==0 means "unknown" (no live data, no archive, not brilliant) ->
        # leave clip_count NULL so it routes to Mixes (no silent single-clip guess).
        if not count:
            return

        conn.execute(
            "UPDATE final_videos SET clip_count = ?, quality_score = ? WHERE id = ?",
            (count, quality, fv_id),
        )
