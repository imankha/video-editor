"""v020: Archive auto-projects whose reel was already published by the sweep.

The game-expiry sweep (auto_export._export_brilliant_clip) publishes a
final_videos row (source_type='brilliant_clip') but never archived the
clip's auto-project, unlike the manual publish path (downloads.py ->
archive_project). Non-archived projects ARE the "Reel Drafts" list
(projects.py list_projects filters only on archived_at IS NULL), so every
sweep-published reel also lingered under Reel Drafts and -- having no
working clips -- bucketed into the "Not Started" filter.

Root cause is fixed code-side (auto_export now archives post-publish, same
contract as manual publish); this migration heals rows already written.

Scope is deliberately narrow: only projects whose published final video is
source_type='brilliant_clip' (the sweep's writer). Manually published
projects were archived at publish time, and a manually RESTORED project
(deliberate un-archive for re-editing) must not be re-archived -- restores
only exist for manual projects, which this predicate excludes.

Idempotent: gated on archived_at IS NULL; a re-run matches nothing.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V020ArchivePublishedAutoProjects(BaseMigration):
    version = 20
    description = "archive sweep-published auto-projects out of Reel Drafts"

    def up(self, conn) -> None:
        cursor = conn.cursor()

        # Guard: required tables may be absent on a fresh/empty profile DB.
        tables = {
            r[0] for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "projects" not in tables or "final_videos" not in tables:
            logger.info("[v020] projects/final_videos missing; nothing to heal")
            return

        cursor.execute(
            """
            UPDATE projects
               SET archived_at = CURRENT_TIMESTAMP
             WHERE archived_at IS NULL
               AND EXISTS (
                     SELECT 1 FROM final_videos fv
                      WHERE fv.project_id = projects.id
                        AND fv.source_type = 'brilliant_clip'
                        AND fv.published_at IS NOT NULL
                   )
            """
        )
        logger.info(f"[v020] archived {cursor.rowcount} sweep-published auto-projects")
