"""
v008 (T3605): Freeze game_ids on final_videos.

Adds the game_ids column (msgpack BLOB of sorted distinct game ids) and
backfills it so Collections (T3610) reads one canonical column instead of
resolving games live. Mirrors v007:

1. Rows whose game_id is set directly (brilliant_clip via auto_export,
   legacy annotated_game) -> [game_id].
2. Project rows with live working data -> distinct raw_clips.game_id via the
   same helper the export stamping uses (services/collection_metadata.py).
3. Published project rows whose working data was archived at publish ->
   reconstructed from the R2 archive's working_clips' raw_clip_id joined to
   live raw_clips (raw_clips survive archival).
4. Rows that resolve to nothing stay NULL (genuinely game-less -> rendered
   under "Mixes & compilations"; no silent fallback).

Routing mirrors the live elif chain in downloads.py (game_id wins, no
fall-through). Runs inside the migration runner, which sets user/profile
context vars before up() — required for the R2 archive reads.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V008FreezeGameIds(BaseMigration):
    version = 8
    description = "Add game_ids to final_videos and backfill the frozen game association"

    def up(self, conn) -> None:
        conn.row_factory = sqlite3.Row

        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        try:
            conn.execute("ALTER TABLE final_videos ADD COLUMN game_ids BLOB")
        except Exception:
            pass  # idempotent re-run

        self._backfill(conn)

    def _backfill(self, conn) -> None:
        cursor = conn.cursor()
        rows = conn.execute(
            "SELECT id, project_id, game_id FROM final_videos "
            "WHERE game_ids IS NULL"
        ).fetchall()

        for row in rows:
            try:
                self._backfill_row(conn, cursor, row)
            except Exception as e:
                logger.error(
                    f"[T3605] final_video {row['id']} game_ids backfill failed: "
                    f"{type(e).__name__}: {e}"
                )

    def _backfill_row(self, conn, cursor, row) -> None:
        from app.services.collection_metadata import (
            compute_archive_game_ids,
            compute_project_game_ids,
            encode_game_ids,
        )
        from app.services.project_archive import load_archive

        fv_id = row["id"]
        project_id = row["project_id"]

        # game_id set directly: brilliant_clip (auto_export) / annotated_game.
        if row["game_id"] is not None:
            game_ids = encode_game_ids([row["game_id"]])
        elif project_id is not None:
            game_ids = compute_project_game_ids(cursor, project_id)
            # Working data gone (project archived at publish): the R2 archive
            # preserves working_clips' raw_clip_id, and raw_clips survive.
            if game_ids is None:
                proj = conn.execute(
                    "SELECT archived_at FROM projects WHERE id = ?",
                    (project_id,),
                ).fetchone()
                working_data_gone = proj is None or proj["archived_at"] is not None
                if working_data_gone:
                    archive = load_archive(project_id)
                    if archive:
                        game_ids = compute_archive_game_ids(cursor, archive)
        else:
            game_ids = None

        if game_ids is None:
            logger.warning(
                f"[T3605] final_video {fv_id} has no resolvable game "
                f"(stays NULL -> mixes)"
            )
            return

        conn.execute(
            "UPDATE final_videos SET game_ids = ? WHERE id = ?",
            (game_ids, fv_id),
        )
