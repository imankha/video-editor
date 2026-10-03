"""
T11430 -- v056 profile_db migration: add projects.source_raw_clip_id (INTEGER,
FK -> raw_clips(id) ON DELETE SET NULL on fresh-install DDL; plain ALTER here,
no inline REFERENCES -- matches this codebase's ALTER-added-column convention,
see v030/v049 precedent) + projects.highlight_ordinal (INTEGER), and backfills
both for existing (pre-v056) databases.

Design doc: docs/plans/tasks/T11430-design.md section 5.1/5.1.1.

source_raw_clip_id backfill, in priority order (each only fills rows still
NULL after the prior step):
  (a) raw_clips.auto_project_id = projects.id -- legacy single pointer.
  (b) working_clips.raw_clip_id for working_clips.project_id = projects.id
      (any row) -- the in-progress link.
  (c) final_videos.source_clip_id for final_videos.project_id = projects.id
      (any row) -- the published/orphaned-pointer case: working_clips rows
      are archived/deleted on publish and auto_project_id may already have
      been repointed elsewhere, but the final_videos row still chains back
      to the raw_clip that was actually used. This is the mechanism behind
      the reported production bug.

highlight_ordinal backfill: a ONE-BASED ordinal within
(source_raw_clip_id, orientation), where orientation is resolved the SAME
way as the read path (_get_highlight_instances_by_clip in
app/routers/clips.py): the latest PUBLISHED final_videos.aspect_ratio for
that project if one exists, else the project's own aspect_ratio. Ordered by
projects.id ASC (stable creation order) within each group. Done via a
Python loop (per-(source_raw_clip_id, orientation) running counter) since a
portable single-statement SQLite UPDATE can't express a window function;
this is a one-time backfill, not a hot path, matching v019/v033's
heal-style migrations.

Idempotent: column-add guarded by PRAGMA table_info; source_raw_clip_id
backfill statements only touch rows still NULL; highlight_ordinal backfill
loop only touches rows still NULL. Re-running never changes an already-set
value, so a partial-apply crash recovery re-run (or a second accidental
run) is safe. Applies automatically at the per-user JIT seam on next access
(T5083/T5085, hardened by T8190).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V056ProjectSourceRawClip(BaseMigration):
    version = 56
    description = "Add projects.source_raw_clip_id + highlight_ordinal, backfill durable play->highlight link (T11430)"

    def up(self, conn) -> None:
        has_projects = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        if not has_projects:
            return

        # PRAGMA table_info rows are TUPLES under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
        if "source_raw_clip_id" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN source_raw_clip_id INTEGER")
            logger.info("[v056] added projects.source_raw_clip_id")
        if "highlight_ordinal" not in cols:
            conn.execute("ALTER TABLE projects ADD COLUMN highlight_ordinal INTEGER")
            logger.info("[v056] added projects.highlight_ordinal")

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_projects_source_raw_clip "
            "ON projects(source_raw_clip_id)"
        )

        has_raw_clips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        has_working_clips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()
        has_final_videos = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()

        # (a) legacy single auto_project_id pointer.
        cur_a_rowcount = 0
        if has_raw_clips:
            cur_a = conn.execute(
                """
                UPDATE projects
                SET source_raw_clip_id = (
                    SELECT rc.id FROM raw_clips rc WHERE rc.auto_project_id = projects.id
                )
                WHERE source_raw_clip_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM raw_clips rc WHERE rc.auto_project_id = projects.id
                  )
                """
            )
            cur_a_rowcount = cur_a.rowcount
        else:
            logger.info("[v056] raw_clips table absent, skipping auto_project_id backfill")

        # (b) working_clips.raw_clip_id for this project (any row).
        cur_b_rowcount = 0
        if has_working_clips:
            cur_b = conn.execute(
                """
                UPDATE projects
                SET source_raw_clip_id = (
                    SELECT wc.raw_clip_id FROM working_clips wc
                    WHERE wc.project_id = projects.id AND wc.raw_clip_id IS NOT NULL
                    ORDER BY wc.id LIMIT 1
                )
                WHERE source_raw_clip_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM working_clips wc
                    WHERE wc.project_id = projects.id AND wc.raw_clip_id IS NOT NULL
                  )
                """
            )
            cur_b_rowcount = cur_b.rowcount
        else:
            logger.info("[v056] working_clips table absent, skipping working_clips backfill")

        # (c) final_videos.source_clip_id for this project (any row) -- the
        # published/orphaned-pointer case.
        cur_c_rowcount = 0
        if has_final_videos:
            cur_c = conn.execute(
                """
                UPDATE projects
                SET source_raw_clip_id = (
                    SELECT fv.source_clip_id FROM final_videos fv
                    WHERE fv.project_id = projects.id AND fv.source_clip_id IS NOT NULL
                    ORDER BY fv.id LIMIT 1
                )
                WHERE source_raw_clip_id IS NULL
                  AND EXISTS (
                    SELECT 1 FROM final_videos fv
                    WHERE fv.project_id = projects.id AND fv.source_clip_id IS NOT NULL
                  )
                """
            )
            cur_c_rowcount = cur_c.rowcount
        else:
            logger.info("[v056] final_videos table absent, skipping final_videos backfill")

        logger.info(
            f"[v056] backfilled source_raw_clip_id: {cur_a_rowcount} via auto_project_id, "
            f"{cur_b_rowcount} via working_clips, {cur_c_rowcount} via final_videos"
        )

        # highlight_ordinal backfill -- one-based ordinal within
        # (source_raw_clip_id, orientation), orientation resolved the same
        # way as the read path (_get_highlight_instances_by_clip in
        # app/routers/clips.py): latest published final_videos.aspect_ratio
        # if any, else the project's own aspect_ratio.
        if has_final_videos:
            rows = conn.execute(
                """
                SELECT p.id, p.source_raw_clip_id,
                  COALESCE(
                    (SELECT fv2.aspect_ratio FROM final_videos fv2
                     WHERE fv2.project_id = p.id AND fv2.published_at IS NOT NULL
                     ORDER BY fv2.id DESC LIMIT 1),
                    p.aspect_ratio
                  ) AS resolved_aspect_ratio
                FROM projects p
                WHERE p.source_raw_clip_id IS NOT NULL
                  AND p.highlight_ordinal IS NULL
                ORDER BY p.source_raw_clip_id, resolved_aspect_ratio, p.id
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT p.id, p.source_raw_clip_id, p.aspect_ratio AS resolved_aspect_ratio
                FROM projects p
                WHERE p.source_raw_clip_id IS NOT NULL
                  AND p.highlight_ordinal IS NULL
                ORDER BY p.source_raw_clip_id, resolved_aspect_ratio, p.id
                """
            ).fetchall()

        counters: dict[tuple, int] = {}
        backfilled_ordinals = 0
        for row in rows:
            project_id, source_raw_clip_id, orientation = row[0], row[1], row[2]
            key = (source_raw_clip_id, orientation)
            counters[key] = counters.get(key, 0) + 1
            conn.execute(
                "UPDATE projects SET highlight_ordinal = ? WHERE id = ?",
                (counters[key], project_id),
            )
            backfilled_ordinals += 1

        logger.info(f"[v056] backfilled highlight_ordinal for {backfilled_ordinals} projects")
