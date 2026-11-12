"""v061: delete archived projects left behind with no reel (T16090).

A deleted reel takes its highlight with it (owner ruling, 2026-11-11): deleting
a reel now deletes the project it was published from (see
`project_archive.delete_archived_project`, called from `delete_download` and
`_delete_moved_source_rows`). This migration is the one-time cleanup for
projects that were already left in that dangling state BEFORE this fix shipped
-- published (archived), then had their reel deleted the old way, which left
the project (and its R2 archive) behind with nothing pointing at it. Annotate
lists these as an in-progress highlight that opens Frame on zero plays (the
hang T16040 investigated; staging repro: hello@reelballers.com project 4
"Play 5").

An orphan is identified the same way the evidence read it: `archived_at IS NOT
NULL AND final_video_id IS NULL`. Archived projects that still have a reel
(`final_video_id` set) are untouched. The migration connection does NOT run
with `PRAGMA foreign_keys=ON` (see `migrate_local_profile_db_at_seam`), so
`raw_clips.auto_project_id` is cleared explicitly rather than relying on the
column's ON DELETE SET NULL FK.

Idempotent: a re-run finds no matching projects (they were deleted, or never
existed) and is a no-op. R2 delete is best-effort per project, logged on
failure, and never blocks the DB delete (mirrors v048). version = 61.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V061DeleteOrphanArchivedProjects(BaseMigration):
    version = 61
    description = "T16090: delete archived projects with no reel, and their R2 archive"

    def up(self, conn) -> None:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM projects WHERE archived_at IS NOT NULL AND final_video_id IS NULL"
        )
        orphan_ids = [row[0] for row in cursor.fetchall()]
        if not orphan_ids:
            logger.info("[v061] no orphaned archived projects found")
            return

        from ...storage import R2_ENABLED, delete_from_r2
        from ...user_context import get_current_user_id

        user_id = get_current_user_id()

        for project_id in orphan_ids:
            if R2_ENABLED and user_id and not delete_from_r2(user_id, f"archive/{project_id}.msgpack"):
                logger.error(
                    "[v061] failed to delete R2 archive for project %d "
                    "(user=%s); deleting the DB row anyway",
                    project_id, user_id,
                )
            cursor.execute(
                "UPDATE raw_clips SET auto_project_id = NULL WHERE auto_project_id = ?",
                (project_id,),
            )
            cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))

        logger.info(
            "[v061] deleted %d orphaned archived project(s): %s",
            len(orphan_ids), orphan_ids,
        )
