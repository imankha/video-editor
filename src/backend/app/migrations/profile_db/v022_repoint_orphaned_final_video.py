"""v022: Re-point projects.final_video_id pointers orphaned by v021.

v021 un-published the sweep's auto_ reels and, where a project's final_video_id
pointed at the deleted reel, nulled the pointer. Its ORIGINAL form nulled it
unconditionally — but a project framed BEFORE the sweep detonated still has its
real export (a non-auto final_videos row); the sweep's auto_ reel had merely
overwritten final_video_id on top of it. v021 nulled without re-pointing, so the
real export was orphaned: the row survives (backend has_final_video=true, so the
card renders in the "Done" state) but final_video_id is NULL, and the preview
button + stream key off final_video_id — a Done card with no preview button
(dev proj 48, "Brilliant Dribble and Pass"). v021 is now fixed to re-point, but
accounts already past v021 keep the orphaned pointer; this heals them.

Predicate: a project with final_video_id IS NULL that still owns a real (non-
auto) final_videos row. Re-point to the latest such row (version DESC, id DESC).

Provenance note (why the predicate is deliberately broad, not v021-exact). v022
runs after the fact and cannot see which projects v021 touched, so it keys off
the resulting state. NULL-pointer + surviving real final is *almost* always the
v021 orphan: every export path sets final_video_id when it writes a final row,
and downloads.py's delete nulls the pointer AND deletes the row together, so a
normal delete leaves no surviving final. The one non-v021 way to reach this
state is a shared project re-exported with keep_prior (overlay.py keeps the old
shared final) whose current reel is then deleted (downloads.py) -- the older
PUBLISHED share survives under a now-NULL pointer. v022 re-points that case too,
intentionally: re-pointing is never destructive (the share is served by its own
id, independent of the project pointer), and the alternative -- a filter on
published_at -- is WRONG, because a genuine v021 orphan's real export can itself
be published (dev proj 48's fv 27 was published after the fact). Failing to heal
a real orphan (broken Done card, no preview button) is the worse outcome than
re-pointing a lingering share to a project that still legitimately owns it.

A never-framed draft owns no final row and is left untouched; a project whose
only surviving final is an auto_ reel (a v021 copy-failure retry) keeps
final_video_id set -- not NULL -- so it never matches here.

Positional tuple row-factory (the runner hands up(conn) plain tuples). Table-
guarded. Idempotent: a re-run finds no NULL-pointer projects with a real final.
version = 22.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V022RepointOrphanedFinalVideo(BaseMigration):
    version = 22
    description = "Re-point final_video_id pointers orphaned by v021 (restores preview button)"

    def up(self, conn) -> None:
        cursor = conn.cursor()

        # Guard: required tables may be absent on a fresh/empty profile DB.
        tables = {
            r[0] for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not {"projects", "final_videos"} <= tables:
            logger.info("[v022] projects/final_videos missing; nothing to heal")
            return

        # Candidate survivor = the project's latest real export: the newest
        # non-auto final_videos row (`_` is a LIKE wildcard, so escape it -- an
        # `auto_` prefix marks a raw sweep reel, never a real export). Published
        # or not: a genuine orphan's export can itself be published, so filtering
        # on published_at would miss real orphans (see module docstring). The
        # outer WHERE keeps only rows where such a survivor exists, so latest_fv
        # is never NULL in the loop below.
        orphans = cursor.execute(
            r"""
            SELECT id, latest_fv FROM (
                SELECT p.id AS id,
                       (SELECT fv.id FROM final_videos fv
                        WHERE fv.project_id = p.id
                          AND fv.filename NOT LIKE 'auto\_%' ESCAPE '\'
                        ORDER BY fv.version DESC, fv.id DESC LIMIT 1) AS latest_fv
                FROM projects p
                WHERE p.final_video_id IS NULL
            )
            WHERE latest_fv IS NOT NULL
            """
        ).fetchall()

        if not orphans:
            logger.info("[v022] no orphaned final_video_id pointers to re-point")
            return

        healed = 0
        for row in orphans:
            project_id, latest_fv = row[0], row[1]
            cursor.execute(
                "UPDATE projects SET final_video_id = ? "
                "WHERE id = ? AND final_video_id IS NULL",
                (latest_fv, project_id),
            )
            healed += 1

        conn.commit()
        logger.info(f"[v022] re-pointed {healed} orphaned final_video_id pointer(s)")
