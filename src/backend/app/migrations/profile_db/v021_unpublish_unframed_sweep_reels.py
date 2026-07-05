"""v021: Un-publish sweep-written unframed reels back into frameable Reel Drafts.

The game-expiry sweep (auto_export._export_brilliant_clip) used to PUBLISH each
never-framed brilliant clip as a raw 16:9 `final_videos` reel (source_type=
'brilliant_clip', filename `auto_{game}_{clip}_{hex}.mp4`) and then ARCHIVE the
auto-project (v020). The result: raw wide footage sat in My Reels masquerading
as a finished reel, and the draft left Reel Drafts.

T4175 changed the sweep to preserve the extract as the clip's source and leave a
frameable draft (no publish, no archive). This migration reverses BOTH the
publish and the v020 archive for rows already written, so every sweep artifact
becomes a frameable draft again.

Per matching row (predicate = published brilliant_clip reel with an `auto_`
filename — the sweep's writer, matching dev fv 37-57 and prod sarkarati 16-22):

  (a) Copy the R2 object final_videos/{filename} -> raw_clips/{filename} so the
      preserved artifact becomes the clip's source in the single source
      namespace. The copy happens BEFORE the row is deleted; a copy failure
      aborts THAT row visibly (never a silent source drop). Skipped if the dest
      already exists (idempotent re-run). Then set raw_clips.filename (only when
      empty — never clobber a real source).
  (b) Restore the auto-project to a frameable draft (reverse the v020 archive):
      prefer restore_project (re-hydrate working_clips from archive/{id}.msgpack);
      if the msgpack is missing, rebuild via _insert_working_clip_with_dims from
      the surviving raw_clip — never a bare archived_at=NULL (the T4050 empty-draft
      signature). Clear projects.final_video_id if it pointed at the deleted reel.
  (c) DELETE the published final_videos row so it leaves My Reels. This also
      drops the seeded Glicko rating + match_count that lived ON that row
      (rating/rd/match_count are columns on final_videos; there is NO separate
      match-history table). Correct: these raw 16:9 clips were never legitimate
      9:16 ranking contestants. before_after_tracks (ON DELETE CASCADE, but FK
      enforcement is off during migration) are swept manually — sweep reels have
      none, so this matches nothing but keeps referential integrity intact.

Positional tuple row-factory (the runner hands up(conn) plain tuples, not
sqlite3.Row — read every column by index r[0..]). Table-guarded. Idempotent:
a re-run finds no published `auto_` rows (deleted) and dest objects already
copied. version = 21.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)


class V021UnpublishUnframedSweepReels(BaseMigration):
    version = 21
    description = "T4175: un-publish unframed sweep reels back into frameable Reel Drafts"

    def up(self, conn) -> None:
        # The runner hands up(conn) a tuple row factory. The rebuild path calls
        # _insert_working_clip_with_dims -> _get_dims_from_raw_clip, which reads
        # columns by NAME (row['video_width']), so switch this connection to a
        # Row factory for the migration and restore it afterward. Positional
        # reads below (r[0..]) work identically on sqlite3.Row.
        orig_factory = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            self._run(conn)
        finally:
            conn.row_factory = orig_factory

    def _run(self, conn) -> None:
        cursor = conn.cursor()

        # Guard: required tables may be absent on a fresh/empty profile DB.
        tables = {
            r[0] for r in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not {"projects", "final_videos", "raw_clips"} <= tables:
            logger.info("[v021] projects/final_videos/raw_clips missing; nothing to heal")
            return

        # `_` is a LIKE wildcard, so escape it: only a literal `auto_` prefix
        # (the stream-copy sweep path) may match, never `automatic...`.
        rows = cursor.execute(
            r"""
            SELECT id, project_id, filename, source_clip_id
            FROM final_videos
            WHERE source_type = 'brilliant_clip'
              AND published_at IS NOT NULL
              AND filename LIKE 'auto\_%' ESCAPE '\'
            """
        ).fetchall()

        if not rows:
            logger.info("[v021] no published sweep reels to un-publish")
            return

        from ...user_context import get_current_user_id
        from ...services.project_archive import restore_project, is_project_archived
        from ...routers.clips import _insert_working_clip_with_dims

        user_id = get_current_user_id()
        healed = 0

        for r in rows:
            fv_id, project_id, filename, source_clip_id = r[0], r[1], r[2], r[3]

            # (a) Preserve the artifact as the clip's source. Copy final_videos/ ->
            # raw_clips/ BEFORE deleting the row so the source is never lost; a copy
            # failure aborts THIS row (visible), leaving the reel published for a retry.
            if not self._copy_to_raw_clips(user_id, filename):
                logger.error(
                    f"[v021] fv {fv_id}: failed to copy final_videos/{filename} -> "
                    f"raw_clips/{filename}; leaving reel published (retry next run)"
                )
                continue

            # (b) Restore the auto-project to a frameable draft (reverse v020).
            # restore_project opens its OWN connection, so run it BEFORE any write
            # on the migration connection — the per-row commit at the end releases
            # this connection's write lock so the next row's restore can't deadlock.
            restored = False
            if is_project_archived(project_id, user_id):
                restored = restore_project(project_id, user_id)

            # From here on, only migration-connection writes (committed at row end).
            if source_clip_id is not None:
                cursor.execute(
                    "UPDATE raw_clips SET filename = ? "
                    "WHERE id = ? AND (filename IS NULL OR filename = '')",
                    (filename, source_clip_id),
                )

            if not restored:
                # msgpack missing / never archived -> rebuild the 1-clip draft in
                # place. Never leave a bare archived_at=NULL with no working_clip
                # (T4050 empty-draft signature).
                cursor.execute(
                    "UPDATE projects SET archived_at = NULL WHERE id = ?",
                    (project_id,),
                )
                has_wc = cursor.execute(
                    "SELECT 1 FROM working_clips WHERE project_id = ? LIMIT 1",
                    (project_id,),
                ).fetchone()
                if not has_wc and source_clip_id is not None:
                    _insert_working_clip_with_dims(
                        cursor, project_id=project_id,
                        raw_clip_id=source_clip_id, sort_order=0,
                    )

            # Referential integrity: FK enforcement is off during migration, so
            # clear/cascade the references to the reel we are about to delete.
            cursor.execute(
                "UPDATE projects SET final_video_id = NULL WHERE final_video_id = ?",
                (fv_id,),
            )
            if "before_after_tracks" in tables:
                cursor.execute(
                    "DELETE FROM before_after_tracks WHERE final_video_id = ?",
                    (fv_id,),
                )

            # (c) Un-publish: delete the reel row (drops its seeded Glicko rating).
            cursor.execute("DELETE FROM final_videos WHERE id = ?", (fv_id,))
            # Commit per row so the write lock is released before the next row's
            # restore_project (separate connection) runs.
            conn.commit()
            healed += 1

        logger.info(f"[v021] un-published {healed}/{len(rows)} sweep reel(s) back to Reel Drafts")

    @staticmethod
    def _copy_to_raw_clips(user_id: str, filename: str) -> bool:
        """Server-side copy final_videos/{filename} -> raw_clips/{filename}.

        Idempotent (skips when the destination already exists). Synchronous —
        the async copy_file_in_r2 helper can't run inside the migration. Returns
        True on success or when R2 is disabled (nothing to copy in that mode).
        """
        from ...storage import (
            R2_ENABLED, get_r2_client, r2_key, R2_BUCKET, file_exists_in_r2,
        )

        if not R2_ENABLED:
            return True

        if file_exists_in_r2(user_id, f"raw_clips/{filename}"):
            return True

        client = get_r2_client()
        if not client:
            logger.error("[v021] R2 client unavailable for copy")
            return False

        source_key = r2_key(user_id, f"final_videos/{filename}")
        dest_key = r2_key(user_id, f"raw_clips/{filename}")
        try:
            from ...utils.retry import retry_r2_call, TIER_3
            retry_r2_call(
                client.copy_object,
                Bucket=R2_BUCKET,
                CopySource={'Bucket': R2_BUCKET, 'Key': source_key},
                Key=dest_key,
                operation=f"v021 copy {source_key}", **TIER_3,
            )
            logger.info(f"[v021] copied {source_key} -> {dest_key}")
            return True
        except Exception as e:
            logger.error(f"[v021] copy failed {source_key} -> {dest_key}: {e}")
            return False
