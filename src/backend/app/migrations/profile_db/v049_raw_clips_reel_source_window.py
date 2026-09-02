"""
v049: Add raw_clips.reel_source_start_time / reel_source_end_time -- the exact
start/end window the clip's currently-linked reel's most recent successful
export actually rendered from (T8070).

Why a value snapshot (not the existing boundaries_version counter): the Reel
control must stop showing a produced status when the clip's start/end changed
after the reel was produced, and RESUME showing it when the boundaries are
reverted to EXACTLY the producing values. A monotonic version counter can detect
"changed since export" but never "changed back to the producing value," so the
producing window has to be recorded as an actual value and compared by value.
These columns are written ONLY at reel creation (seed) and at every export
completion (refresh); update_raw_clip's boundary-change path NEVER touches them,
which is what makes revert-to-exact naturally restore validity.

BACKFILL (T8070 Q1, user decision -- "I am not a fan of self heals; migrate old
accounts"): every existing raw_clip that belongs to a PRODUCED reel (a project
with a working_video or a final_video) gets its snapshot set to that raw_clip's
OWN current start_time/end_time at migration time. There is no historical record
of the exact producing window, so current-state-at-migration becomes the initial
frozen value going forward ("migrations MAKE data correct; no runtime fallback").
After this runs, reel_source_* is NULL ONLY for raw_clips with no produced reel
-- a legitimately different meaning ("no reel"), already handled by the frontend
hasReel gate, NOT an unknown-snapshot cohort.

Two backfill statements (both idempotent, run in order):
  1. Join over working_clips.raw_clip_id -> produced project. This is the
     canonical membership mapping and covers EVERY clip of a produced reel --
     single-clip auto drafts, clips ADDED to a reel, and user-created multi-clip
     reels (which carry NO auto_project_id on any clip). It is a superset of the
     seed-clip set whenever the reel's working_clips still exist.
  2. Auto_project_id -> produced project, for rows statement 1 did not already
     set. This catches the SEED clip of a produced auto-draft whose working_clips
     were pruned at publish time (published reels), which statement 1's join would
     miss. Only fills rows still NULL, so it never overwrites statement 1.

Modeled on v044_working_clips_framing_version.py (guarded PRAGMA table_info
ALTER; migration up(conn) rows are TUPLES under the runner's row factory -- index
positionally, never by name -- the v017 landmine). Idempotent: columns added only
when missing; re-running the backfill sets the same values. Applies automatically
at the per-user JIT seam on next access (T5083/T5085, hardened by T8190).
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V049RawClipsReelSourceWindow(BaseMigration):
    version = 49
    description = "Add raw_clips.reel_source_start_time/end_time + backfill produced reels (T8070)"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='raw_clips'"
        ).fetchone()
        if not has_table:
            return

        # PRAGMA table_info rows are tuples under the migration runner's row
        # factory -> index positionally (row[1] == column name; v017 landmine).
        cols = {row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
        if "reel_source_start_time" not in cols:
            conn.execute("ALTER TABLE raw_clips ADD COLUMN reel_source_start_time REAL")
            logger.info("[v049] added raw_clips.reel_source_start_time")
        if "reel_source_end_time" not in cols:
            conn.execute("ALTER TABLE raw_clips ADD COLUMN reel_source_end_time REAL")
            logger.info("[v049] added raw_clips.reel_source_end_time")

        has_projects = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        has_working_clips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone()

        if not has_projects:
            # A profile at an older/minimal schema state (e.g. a fresh share-
            # materialization target that has raw_clips but hasn't gained the
            # reel tables yet) has no produced-reel membership to backfill at
            # all -- skip both statements rather than crashing the JIT seam.
            # Neither table gains rows retroactively once created (each new
            # project/working_clip is written post-migration, at head), so
            # there is nothing this migration would ever need to re-run for.
            logger.info("[v049] projects table absent, skipping backfill")
            return

        # Statement 1: every clip that is a member of a produced reel, via the
        # canonical working_clips.raw_clip_id mapping (covers multi-clip + user-
        # created reels that carry no auto_project_id). working_clips may not
        # exist yet on a profile at an older/minimal schema state -- skip this
        # statement rather than crashing the JIT seam; statement 2's
        # auto_project_id backfill still runs and statement 1 will simply catch
        # up next time a produced reel gains working_clips (idempotent re-run).
        cur1_rowcount = 0
        if has_working_clips:
            cur1 = conn.execute(
                """
                UPDATE raw_clips
                SET reel_source_start_time = start_time,
                    reel_source_end_time = end_time
                WHERE start_time IS NOT NULL AND end_time IS NOT NULL
                  AND id IN (
                    SELECT DISTINCT wc.raw_clip_id
                    FROM working_clips wc
                    JOIN projects p ON p.id = wc.project_id
                    WHERE wc.raw_clip_id IS NOT NULL
                      AND (p.working_video_id IS NOT NULL OR p.final_video_id IS NOT NULL)
                  )
                """
            )
            cur1_rowcount = cur1.rowcount
        else:
            logger.info("[v049] working_clips table absent, skipping member-clip backfill")

        # Statement 2: seed clips of produced auto-drafts whose working_clips were
        # pruned (published reels) -- only rows statement 1 left NULL.
        cur2 = conn.execute(
            """
            UPDATE raw_clips
            SET reel_source_start_time = start_time,
                reel_source_end_time = end_time
            WHERE start_time IS NOT NULL AND end_time IS NOT NULL
              AND reel_source_start_time IS NULL
              AND auto_project_id IN (
                SELECT id FROM projects
                WHERE working_video_id IS NOT NULL OR final_video_id IS NOT NULL
              )
            """
        )

        logger.info(
            f"[v049] backfilled reel_source_* for {cur1_rowcount} member clips + "
            f"{cur2.rowcount} pruned-reel seed clips"
        )
