"""
v009 (T3630): Reel ranking model (pairwise Glicko).

UNDEPLOYED to staging/prod -- edited in place after the ranking UX moved from
insertion to a pairwise Glicko GAME (spec T3630-ranking-game-spec.md). The
earlier draft of this migration added `season_rank`; that column is GONE from the
model (replaced by `rating`). Fresh DBs never get it; any local dev DB that ran
the draft keeps an unused `season_rank` column (harmless -- no read path remains).

final_videos gains, all frozen at export-finalize (publish archives + deletes
working data, so they cannot be derived later):

1. clip_count INTEGER NULL -- distinct constituent clips. == 1 is the SINGLE-CLIP
   collection-membership + ranking-pool signal (multi-clip / unknown -> Mixes).
   Brilliant clips are always 1 (definitional, even when the source clip is gone).
2. quality_score REAL NULL -- the lone clip's star (1-5) for single-clip reels;
   seeds `rating` + the card star. NULL for an orphaned brilliant whose rating is lost.
3. rating REAL NULL -- Glicko rating, seeded `1500 + (star-3)*40` (NULL star -> 1500);
   only set for single-clip reels (the ranking pool).
4. rd REAL NULL -- Glicko rating deviation, RD_MAX (350) until first matched.
5. match_count INTEGER DEFAULT 0 -- number of picks this reel has been in.
6. source_clip_id INTEGER NULL -- the lone constituent raw_clip id; keys the rating
   so Portrait/Landscape twins share one value (spec §4.4). NULL when unrecoverable.
7. clip_start_time REAL NULL -- the lone clip's in-match start (seconds) for `33'`.

Plus collection_settings(key, value) -- per-profile key/value knobs (T3640's
season_target_duration is the first user). Created here so v009 is the epic's last
profile_db migration.

Runs inside the migration runner, which sets user/profile context vars before
up() -- required for the R2 archive reads in the backfill.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V009SeasonRank(BaseMigration):
    version = 9
    description = (
        "Reel ranking model: clip_count/quality_score/rating/rd/match_count/"
        "source_clip_id/clip_start_time on final_videos; collection_settings table"
    )

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

        for col in (
            "clip_count INTEGER",
            "quality_score REAL",
            "rating REAL",
            "rd REAL",
            "match_count INTEGER DEFAULT 0",
            "source_clip_id INTEGER",
            "clip_start_time REAL",
        ):
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
                    f"[T3630] final_video {row['id']} ranking backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.collection_metadata import (
            compute_archive_clip_identity,
            compute_archive_clip_stats,
            compute_project_clip_identity,
            compute_project_clip_stats,
        )
        from app.services.glicko import RD_MAX, seed_rating
        from app.services.project_archive import load_archive

        fv_id = row["id"]
        project_id = row["project_id"]

        count, quality = None, None
        source_clip_id, clip_start_time = None, None
        archive = None

        if project_id is not None:
            count, quality = compute_project_clip_stats(cursor, project_id)
            source_clip_id, clip_start_time = compute_project_clip_identity(
                cursor, project_id)
            if count == 0:  # working data gone -> recover from the R2 archive
                proj = conn.execute(
                    "SELECT archived_at FROM projects WHERE id = ?",
                    (project_id,),
                ).fetchone()
                if proj is None or proj["archived_at"] is not None:
                    archive = load_archive(project_id)
                    if archive:
                        count, quality = compute_archive_clip_stats(cursor, archive)
                        source_clip_id, clip_start_time = (
                            compute_archive_clip_identity(cursor, archive))

        # A brilliant clip is ALWAYS single-clip, even if its source raw_clip /
        # archive is gone (orphaned) -> force clip_count=1 so it stays in its
        # collection; its quality_score / source_clip_id may remain NULL.
        if row["source_type"] == "brilliant_clip":
            count = 1

        # count==0 means "unknown" (no live data, no archive, not brilliant) ->
        # leave clip_count NULL so it routes to Mixes (no silent single-clip guess).
        if not count:
            return

        # rating/rd/source are meaningful only for the single-clip ranking pool.
        rating, rd = None, None
        if count == 1:
            rating = seed_rating(quality)
            rd = RD_MAX
        else:
            source_clip_id, clip_start_time = None, None

        conn.execute(
            "UPDATE final_videos SET clip_count = ?, quality_score = ?, rating = ?, "
            "rd = ?, match_count = 0, source_clip_id = ?, clip_start_time = ? "
            "WHERE id = ?",
            (count, quality, rating, rd, source_clip_id, clip_start_time, fv_id),
        )
