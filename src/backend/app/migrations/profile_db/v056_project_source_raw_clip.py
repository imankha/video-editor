"""
T11430 -- v056 profile_db migration: add projects.source_raw_clip_id (INTEGER,
FK -> raw_clips(id) ON DELETE SET NULL on fresh-install DDL; plain ALTER here,
no inline REFERENCES -- matches this codebase's ALTER-added-column convention,
see v030/v049 precedent) + projects.highlight_ordinal (INTEGER) +
projects.reel_source_start_time / reel_source_end_time (REAL, T11430 fixround1
per-project staleness snapshot), and backfills them for existing (pre-v056)
databases.

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
app/routers/clips.py) AND the create/aspect-change paths: the latest
PUBLISHED final_videos.aspect_ratio for that project if one exists, else the
project's own aspect_ratio. Ordered by projects.id ASC (stable creation
order) within each group. Done via a Python loop (per-(source_raw_clip_id,
orientation) running counter) since a portable single-statement SQLite UPDATE
can't express a window function; this is a one-time backfill, not a hot path,
matching v019/v033's heal-style migrations.

reel_source_* backfill (fixround1): for a project with a produced video
(working_video or final_video), freeze the snapshot from the owning
raw_clip's CURRENT reel_source_* (joined via source_raw_clip_id). This is a
best-available APPROXIMATION -- the true historical producing window of each
individual project is not recoverable from stored state (pre-v056 there was
only one shared per-play snapshot), so existing rows inherit the play's
current snapshot. New projects (post-v056) freeze their own at creation.

Column-existence robustness (fixround1): the backfill chains reference
specific columns on OTHER tables (final_videos.project_id/source_clip_id/
published_at/aspect_ratio, working_clips.project_id/raw_clip_id,
raw_clips.reel_source_start_time/end_time). Several unrelated tests build
PARTIAL/synthetic schema snapshots where a table is PRESENT but missing those
columns. Each chain is therefore guarded not just on the table existing
(sqlite_master) but on the specific columns existing (PRAGMA table_info) --
skip the chain with a log line rather than crash, mirroring the existing
"table absent, skipping" pattern.

Idempotent: column-add guarded by PRAGMA table_info; source_raw_clip_id /
reel_source_* backfill statements only touch rows still NULL; highlight_ordinal
backfill loop only touches rows still NULL AND seeds its per-bucket counter
from the existing MAX(highlight_ordinal) for that bucket, so a re-run that
encounters new NULL rows alongside already-numbered rows cannot collide.
Re-running never changes an already-set value, so a partial-apply crash
recovery re-run (or a second accidental run) is safe. Applies automatically
at the per-user JIT seam on next access (T5083/T5085, hardened by T8190).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


def _columns(conn, table: str) -> set:
    """Column name set for `table` -- PRAGMA table_info rows are TUPLES under the
    migration runner's row factory, index positionally (row[1] == name; v017
    landmine)."""
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _table_exists(conn, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


class V056ProjectSourceRawClip(BaseMigration):
    version = 56
    description = "Add projects.source_raw_clip_id + highlight_ordinal + per-project reel_source_* snapshot, backfill durable play->highlight link (T11430)"

    def up(self, conn) -> None:
        if not _table_exists(conn, "projects"):
            return

        proj_cols = _columns(conn, "projects")
        if "source_raw_clip_id" not in proj_cols:
            conn.execute("ALTER TABLE projects ADD COLUMN source_raw_clip_id INTEGER")
            logger.info("[v056] added projects.source_raw_clip_id")
        if "highlight_ordinal" not in proj_cols:
            conn.execute("ALTER TABLE projects ADD COLUMN highlight_ordinal INTEGER")
            logger.info("[v056] added projects.highlight_ordinal")
        if "reel_source_start_time" not in proj_cols:
            conn.execute("ALTER TABLE projects ADD COLUMN reel_source_start_time REAL")
            logger.info("[v056] added projects.reel_source_start_time")
        if "reel_source_end_time" not in proj_cols:
            conn.execute("ALTER TABLE projects ADD COLUMN reel_source_end_time REAL")
            logger.info("[v056] added projects.reel_source_end_time")

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_projects_source_raw_clip "
            "ON projects(source_raw_clip_id)"
        )

        # Resolve which backfill chains are runnable given the ACTUAL schema in
        # front of us (table present AND the specific columns the chain needs).
        raw_cols = _columns(conn, "raw_clips") if _table_exists(conn, "raw_clips") else set()
        wc_cols = _columns(conn, "working_clips") if _table_exists(conn, "working_clips") else set()
        fv_cols = _columns(conn, "final_videos") if _table_exists(conn, "final_videos") else set()

        can_a = "auto_project_id" in raw_cols
        can_b = {"project_id", "raw_clip_id"}.issubset(wc_cols)
        can_c = {"project_id", "source_clip_id"}.issubset(fv_cols)
        # The resolved-orientation subquery needs these final_videos columns.
        can_resolved_orientation = {"project_id", "published_at", "aspect_ratio"}.issubset(fv_cols)

        # (a) legacy single auto_project_id pointer.
        cur_a_rowcount = 0
        if can_a:
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
            logger.info("[v056] raw_clips.auto_project_id absent, skipping auto_project_id backfill")

        # (b) working_clips.raw_clip_id for this project (any row).
        cur_b_rowcount = 0
        if can_b:
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
            logger.info("[v056] working_clips project_id/raw_clip_id absent, skipping working_clips backfill")

        # (c) final_videos.source_clip_id for this project (any row) -- the
        # published/orphaned-pointer case.
        cur_c_rowcount = 0
        if can_c:
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
            logger.info("[v056] final_videos project_id/source_clip_id absent, skipping final_videos backfill")

        logger.info(
            f"[v056] backfilled source_raw_clip_id: {cur_a_rowcount} via auto_project_id, "
            f"{cur_b_rowcount} via working_clips, {cur_c_rowcount} via final_videos"
        )

        # reel_source_* per-project snapshot backfill (fixround1): for a project
        # with a produced video, inherit the owning raw_clip's CURRENT snapshot.
        # Best-available approximation (see module docstring). Only fills rows
        # still NULL, and only when the raw_clips snapshot columns exist.
        if (
            {"reel_source_start_time", "reel_source_end_time"}.issubset(raw_cols)
            and {"reel_source_start_time", "reel_source_end_time"}.issubset(_columns(conn, "projects"))
        ):
            cur_rs = conn.execute(
                """
                UPDATE projects
                SET reel_source_start_time = (
                        SELECT rc.reel_source_start_time FROM raw_clips rc
                        WHERE rc.id = projects.source_raw_clip_id
                    ),
                    reel_source_end_time = (
                        SELECT rc.reel_source_end_time FROM raw_clips rc
                        WHERE rc.id = projects.source_raw_clip_id
                    )
                WHERE source_raw_clip_id IS NOT NULL
                  AND reel_source_start_time IS NULL
                  AND reel_source_end_time IS NULL
                  AND (working_video_id IS NOT NULL OR final_video_id IS NOT NULL)
                  AND EXISTS (
                    SELECT 1 FROM raw_clips rc
                    WHERE rc.id = projects.source_raw_clip_id
                      AND rc.reel_source_start_time IS NOT NULL
                  )
                """
            )
            logger.info(f"[v056] backfilled per-project reel_source_* for {cur_rs.rowcount} produced projects")
        else:
            logger.info("[v056] raw_clips/projects reel_source_* columns absent, skipping per-project snapshot backfill")

        # highlight_ordinal backfill -- one-based ordinal within
        # (source_raw_clip_id, orientation). Orientation resolved the SAME way
        # as the read + create + aspect-change paths: latest published
        # final_videos.aspect_ratio if any, else the project's own aspect_ratio.
        # Needs projects.aspect_ratio (the fallback orientation) -- a synthetic
        # schema snapshot lacking it (e.g. a minimal test fixture) can't bucket
        # by orientation, so skip the ordinal backfill rather than crash.
        if "aspect_ratio" not in _columns(conn, "projects"):
            logger.info("[v056] projects.aspect_ratio absent, skipping highlight_ordinal backfill")
            return

        if can_resolved_orientation:
            orientation_expr = """
                COALESCE(
                    (SELECT fv2.aspect_ratio FROM final_videos fv2
                     WHERE fv2.project_id = p.id AND fv2.published_at IS NOT NULL
                     ORDER BY fv2.id DESC LIMIT 1),
                    p.aspect_ratio
                )
            """
        else:
            # final_videos (or its columns) absent -> no project can be
            # published here, so resolved orientation is just the project ratio.
            orientation_expr = "p.aspect_ratio"

        # Seed per-bucket counters from the EXISTING max so a re-run that finds
        # new NULL rows beside already-numbered ones never collides (idempotence).
        existing = conn.execute(
            f"""
            SELECT p.source_raw_clip_id, {orientation_expr} AS ori, MAX(p.highlight_ordinal) AS maxord
            FROM projects p
            WHERE p.source_raw_clip_id IS NOT NULL
              AND p.highlight_ordinal IS NOT NULL
            GROUP BY p.source_raw_clip_id, ori
            """
        ).fetchall()
        counters: dict[tuple, int] = {(row[0], row[1]): (row[2] or 0) for row in existing}

        rows = conn.execute(
            f"""
            SELECT p.id, p.source_raw_clip_id, {orientation_expr} AS resolved_aspect_ratio
            FROM projects p
            WHERE p.source_raw_clip_id IS NOT NULL
              AND p.highlight_ordinal IS NULL
            ORDER BY p.source_raw_clip_id, resolved_aspect_ratio, p.id
            """
        ).fetchall()

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
