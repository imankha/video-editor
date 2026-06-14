"""
v010 (T3630): ranking columns for DBs already past v009.

v009 was revised in place from its draft (which added season_rank + clip_count +
quality_score) to the final pairwise-Glicko shape. But any DB that already ran the
DRAFT is stamped user_version=9, so the revised v009 is version-gated and can NEVER
re-run on it -- the ranking columns (rating/rd/match_count/source_clip_id/
clip_start_time) would never land. This migration carries those columns as a
SEPARATE version so they reach every DB:

- Fresh / v8 DBs: run v009 (adds all columns + full backfill incl. rating), then
  v010 (idempotent no-op -- columns exist, rating already set).
- v9 DBs from the draft: run only v010 -> adds the 5 ranking columns and seeds
  rating from the quality_score the draft already backfilled.

ALTERs are idempotent (try/except). Backfill gates on `rating IS NULL` so it only
touches rows that still need a seed, and only single-clip reels (clip_count == 1,
the ranking pool) get a rating -- multi-clip reels stay NULL (Mixes, never rank).
Runs inside the migration runner, which sets user/profile context vars (needed for
the R2 archive reads in identity recovery).
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V010RankingColumns(BaseMigration):
    version = 10
    description = "Ranking columns (rating/rd/match_count/source_clip_id/clip_start_time) for v9 DBs"

    def up(self, conn) -> None:
        conn.row_factory = sqlite3.Row

        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        for col in (
            "rating REAL",
            "rd REAL",
            "match_count INTEGER DEFAULT 0",
            "source_clip_id INTEGER",
            "clip_start_time REAL",
        ):
            try:
                conn.execute(f"ALTER TABLE final_videos ADD COLUMN {col}")
            except Exception:
                pass  # idempotent (v009-revised already added these on fresh/v8 DBs)

        self._backfill(conn)

    def _backfill(self, conn) -> None:
        cursor = conn.cursor()
        # Only rows still missing a rating; clip_count/quality_score were set by v009.
        rows = conn.execute(
            "SELECT id, project_id, clip_count, quality_score, source_type "
            "FROM final_videos WHERE rating IS NULL"
        ).fetchall()
        for row in rows:
            try:
                self._backfill_row(conn, cursor, row)
            except Exception as e:
                logger.error(
                    f"[T3630/v010] final_video {row['id']} rating backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.glicko import seed_rating, RD_MAX

        # Only single-clip reels are in the ranking pool; leave the rest NULL.
        if row["clip_count"] != 1:
            return

        source_clip_id, clip_start_time = self._recover_identity(
            conn, cursor, row["project_id"])

        conn.execute(
            "UPDATE final_videos SET rating = ?, rd = ?, "
            "match_count = COALESCE(match_count, 0), source_clip_id = ?, "
            "clip_start_time = ? WHERE id = ?",
            (seed_rating(row["quality_score"]), RD_MAX,
             source_clip_id, clip_start_time, row["id"]),
        )

    def _recover_identity(self, conn, cursor, project_id):
        """(source_clip_id, clip_start_time) for a single-clip reel: live project
        clip first, then the R2 archive, else (None, None) -- mirrors v009."""
        if project_id is None:
            return None, None
        from app.services.collection_metadata import (
            compute_project_clip_identity,
            compute_archive_clip_identity,
        )
        from app.services.project_archive import load_archive

        sid, start = compute_project_clip_identity(cursor, project_id)
        if sid is not None:
            return sid, start

        proj = conn.execute(
            "SELECT archived_at FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if proj is None or proj["archived_at"] is not None:
            archive = load_archive(project_id)
            if archive:
                return compute_archive_clip_identity(cursor, archive)
        return None, None
