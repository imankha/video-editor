"""
v007 (T3600): Freeze collection metadata on final_videos.

Adds aspect_ratio + tags columns (duration already exists in the schema),
creates the published/ratio index (EPIC decision #13 groundwork), and
backfills all three columns:

1. Rows with live working data: computed via the same helper the export
   stamping uses (services/collection_metadata.py).
2. Published rows whose working data was archived at publish: extracted
   from the R2 archive (archive/{project_id}.msgpack). raw_clips survive
   archival, so tags resolve through live raw_clips either way.
3. Rows that resolve to nothing stay NULL with one visible log line each
   (no silent fallback — downstream features exclude NULL rows from math
   but still render them).

Runs inside the migration runner, which sets user/profile context vars
before calling up() — required for the R2 archive reads.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V007CollectionMetadata(BaseMigration):
    version = 7
    description = "Add aspect_ratio/tags to final_videos, backfill collection metadata, add published/ratio index"

    def up(self, conn) -> None:
        conn.row_factory = sqlite3.Row

        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        for col in ("aspect_ratio TEXT", "tags BLOB"):
            try:
                conn.execute(f"ALTER TABLE final_videos ADD COLUMN {col}")
            except Exception:
                pass  # idempotent re-run

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_final_videos_published_ratio "
            "ON final_videos(published_at, aspect_ratio)"
        )

        self._backfill(conn)

    def _backfill(self, conn) -> None:
        cursor = conn.cursor()
        rows = conn.execute(
            "SELECT id, project_id, game_id, duration, aspect_ratio, tags "
            "FROM final_videos "
            "WHERE duration IS NULL OR aspect_ratio IS NULL OR tags IS NULL"
        ).fetchall()

        for row in rows:
            try:
                self._backfill_row(conn, cursor, row)
            except Exception as e:
                logger.error(
                    f"[T3600] final_video {row['id']} backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.collection_metadata import (
            compute_annotated_game_metadata,
            compute_archive_metadata,
            compute_project_metadata,
        )
        from app.services.project_archive import load_archive

        fv_id = row["id"]
        project_id = row["project_id"]
        duration = row["duration"]
        aspect_ratio = row["aspect_ratio"]
        tags = row["tags"]

        if project_id is not None:
            live_d, live_a, live_t = compute_project_metadata(cursor, project_id)
            duration = duration if duration is not None else live_d
            aspect_ratio = aspect_ratio if aspect_ratio is not None else live_a
            tags = tags if tags is not None else live_t

            # Working data gone (project archived at publish, or deleted):
            # the R2 archive is the remaining source.
            if duration is None or aspect_ratio is None or tags is None:
                proj = conn.execute(
                    "SELECT archived_at FROM projects WHERE id = ?",
                    (project_id,),
                ).fetchone()
                working_data_gone = proj is None or proj["archived_at"] is not None
                if working_data_gone:
                    archive = load_archive(project_id)
                    if archive:
                        arc_d, arc_a, arc_t = compute_archive_metadata(
                            cursor, archive)
                        duration = duration if duration is not None else arc_d
                        aspect_ratio = (
                            aspect_ratio if aspect_ratio is not None else arc_a
                        )
                        tags = tags if tags is not None else arc_t
        elif row["game_id"] is not None:
            # Legacy annotated_game rows: duration/tags from rated raw_clips
            # (the per-request chain downloads.py used pre-T3600).
            # aspect_ratio is not derivable for these rows and stays NULL.
            game_d, game_t = compute_annotated_game_metadata(
                cursor, row["game_id"])
            duration = duration if duration is not None else game_d
            tags = tags if tags is not None else game_t

        if duration is None and aspect_ratio is None:
            logger.warning(f"[T3600] final_video {fv_id} backfill incomplete")

        if (duration != row["duration"] or aspect_ratio != row["aspect_ratio"]
                or tags != row["tags"]):
            conn.execute(
                "UPDATE final_videos SET duration = ?, aspect_ratio = ?, "
                "tags = ? WHERE id = ?",
                (duration, aspect_ratio, tags, fv_id),
            )
