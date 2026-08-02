"""
v032: Add poster-marker fields for the open-play window-gate poster rework (T5410).

Verified 2026-08-02: master profile_db head is v031
(v031_reclassify_teammate_clips_to_team.py); no unmerged sibling branch claims
v032. The runner only applies versions GREATER than the DB's current
user_version, so a duplicate number is silently skipped and these columns would
never get created (the T6340 class of bug) -- re-verify this at implementation
time, not just here.

Two purely additive columns, two different tables:

- `final_videos.poster_frame_time` (REAL, nullable): the final-timeline second
  the stored poster was captured at. NULL for uploads (no source frame) and
  for legacy rows (pre-T5410; treated as unknown/auto).
- `final_videos.poster_source` (TEXT, nullable): 'auto' | 'overlay' | 'upload'.
  NULL = legacy (treated as 'auto'). Guards the admin backfill from clobbering
  a user's manual cover choice under `force`.
- `projects.poster_marker_time` (REAL, nullable): the user's PRE-EXPORT poster
  marker, set from the overlay timeline before a `final_videos` row exists.
  Lives on `projects` (not `working_videos`) because `upsert_working_video`
  (export_finalize.py) INSERTs a new version row on every re-render -- a
  working_videos column would be silently dropped on re-export -- and
  `archive_project` DELETEs working_videos at publish entirely. The projects
  row's id never changes across re-render/archive/restore, so a column there
  survives the reel's whole lifecycle for free (Architect gate, T5410).
  NULL = no override -> the export-time selector falls back to the open-play
  window's midpoint.

No data backfill here -- legacy rows stay NULL on all three columns (the
correct "unknown/auto" value); the admin poster backfill (`backfill_posters`)
recomputes `poster_frame_time`/`poster_source` on regen.

Idempotent: only adds a column when missing (mirrors v024/v025).

Row-factory note: the migration runner hands ``up(conn)`` a TUPLE row factory
(not ``sqlite3.Row``), so `PRAGMA table_info` rows are indexed POSITIONALLY
(``row[1]`` for the column name) -- this migration reads no data rows at all,
only schema introspection, so the tuple-vs-Row distinction doesn't otherwise
bite here.
"""

import logging

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V032AddPosterMarkerFields(BaseMigration):
    version = 32
    description = "Add final_videos.poster_frame_time/poster_source + projects.poster_marker_time (T5410)"

    def up(self, conn) -> None:
        has_final_videos = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if has_final_videos:
            cols = {row[1] for row in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
            if "poster_frame_time" not in cols:
                conn.execute("ALTER TABLE final_videos ADD COLUMN poster_frame_time REAL")
                logger.info("[v032] added final_videos.poster_frame_time")
            if "poster_source" not in cols:
                conn.execute("ALTER TABLE final_videos ADD COLUMN poster_source TEXT")
                logger.info("[v032] added final_videos.poster_source")

        has_projects = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'"
        ).fetchone()
        if has_projects:
            proj_cols = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
            if "poster_marker_time" not in proj_cols:
                conn.execute("ALTER TABLE projects ADD COLUMN poster_marker_time REAL")
                logger.info("[v032] added projects.poster_marker_time")
