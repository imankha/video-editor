"""
v025: Freeze the reel's first slow-mo section on final_videos (T5090).

Adds `slowmo_section_start` / `slowmo_section_end` (REAL, nullable) -- the FULL
first slow-mo section `[start, end]` in FINAL (stretched, concatenated) video
time. The reel poster policy samples the clearest frame in the first HALF of this
section; storing the full section lets the sampling policy evolve without a
re-migration.

WHY freeze: real published reels have their `working_clips` PRUNED at publish
(archive_project deletes them), so the live poster reconstruction returns [] for
every published reel and a force-regen would downgrade all posters to first
frame. Freezing at finalize (going forward) + backfilling here (existing reels)
makes the section durable and independent of working_clips surviving.

Backfill: for each already-published reel with a NULL section, reconstruct the
ordered working-clip segments from the R2 project archive
(`archive/{project_id}.msgpack`, written BEFORE publish prunes working_clips) and
compute the section. Missing/unparseable archive, or a reel with no slow-mo ->
leave NULL (counted, logged at info; NO fabrication). Best-effort per row: an
archive/R2 error never aborts the migration.

Runner landmine (v017): `up(conn)` receives a TUPLE row factory -- rows are
indexed positionally (r[0]), never r['col'].
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V025FreezeSlowmoSection(BaseMigration):
    version = 25
    description = "Freeze final_videos.slowmo_section_start/end for reel posters (T5090)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if not has_table:
            return

        cols = {row[1] for row in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
        if "slowmo_section_start" not in cols:
            conn.execute("ALTER TABLE final_videos ADD COLUMN slowmo_section_start REAL")
            logger.info("[v025] added final_videos.slowmo_section_start")
        if "slowmo_section_end" not in cols:
            conn.execute("ALTER TABLE final_videos ADD COLUMN slowmo_section_end REAL")
            logger.info("[v025] added final_videos.slowmo_section_end")

        self._backfill_from_archive(conn)

    def _backfill_from_archive(self, conn) -> None:
        """Backfill the frozen section for already-published reels from the R2
        archive. Runs in the migration's user/profile context (the runner sets it
        before up()). TUPLE rows -> positional indexing."""
        from ...services.poster import first_slowmo_section, segments_from_archive
        from ...services.project_archive import load_archive
        from ...user_context import get_current_user_id

        try:
            user_id = get_current_user_id()
        except Exception:
            # No context (shouldn't happen via the runner) -> skip backfill, keep
            # the additive column change. Columns stay NULL; a later admin
            # backfill/regen reconstructs them.
            logger.info("[v025] no user context; skipping archive backfill")
            return

        rows = conn.execute(
            "SELECT id, project_id FROM final_videos "
            "WHERE published_at IS NOT NULL AND slowmo_section_start IS NULL"
        ).fetchall()

        frozen = no_slowmo = unreconstructable = 0
        for r in rows:
            fv_id, project_id = r[0], r[1]  # TUPLE row factory (v017 landmine)
            if project_id is None:
                unreconstructable += 1
                continue
            try:
                clips = segments_from_archive(load_archive(project_id, user_id))
            except Exception as e:
                logger.info(f"[v025] archive load failed for project {project_id}: {e}")
                unreconstructable += 1
                continue
            if not clips:
                unreconstructable += 1
                continue
            section = first_slowmo_section(clips)
            if section is None:
                no_slowmo += 1
                continue
            conn.execute(
                "UPDATE final_videos SET slowmo_section_start = ?, slowmo_section_end = ? "
                "WHERE id = ?",
                (section[0], section[1], fv_id),
            )
            frozen += 1

        if rows:
            logger.info(
                f"[v025] archive backfill: {frozen} frozen, {no_slowmo} no-slow-mo, "
                f"{unreconstructable} unreconstructable (of {len(rows)} published)"
            )
