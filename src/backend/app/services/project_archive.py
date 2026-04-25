"""
Project Archive Service for Video Editor.

Archives completed projects to R2 as JSON files to reduce active database size.
Projects are archived when exported (final_video created) and can be restored
when user opens them from the gallery.

Archive location: {user_id}/archive/{project_id}.json
"""

import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any

from app.database import (
    get_db_connection,
    get_database_path,
    DB_SIZE_WARNING_THRESHOLD,
)
from app.queries import latest_working_clips_subquery
from app.storage import (
    R2_ENABLED,
    upload_bytes_to_r2,
    delete_from_r2,
    get_r2_client,
    R2_BUCKET,
    r2_key,
)
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

# Archive schema version for future migrations
ARCHIVE_VERSION = 1


def _get_archive_r2_key(project_id: int) -> str:
    """Get the R2 key for a project's archive JSON."""
    return f"archive/{project_id}.json"


def _row_to_dict(row) -> Dict[str, Any]:
    """Convert a sqlite3.Row to a dictionary."""
    return {key: row[key] for key in row.keys()}


def archive_project(project_id: int, user_id: Optional[str] = None) -> bool:
    """
    Archive a completed project to R2 as JSON.

    Serializes project, working_clips, and working_videos to JSON,
    uploads to R2, then deletes from the database.
    The final_videos row is kept in DB for gallery listing.

    Args:
        project_id: ID of the project to archive
        user_id: User ID (defaults to current user from context)

    Returns:
        True if archive succeeded, False otherwise
    """
    if user_id is None:
        user_id = get_current_user_id()

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. Get project data
            cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            project_row = cursor.fetchone()
            if not project_row:
                logger.warning(f"Project {project_id} not found for archiving")
                return False

            if R2_ENABLED:
                project_data = _row_to_dict(project_row)

                # 2. Get all working_clips for this project (all versions)
                cursor.execute("""
                    SELECT * FROM working_clips WHERE project_id = ?
                    ORDER BY version, sort_order
                """, (project_id,))
                working_clips_data = [_row_to_dict(row) for row in cursor.fetchall()]

                # 3. Get all working_videos for this project (all versions)
                cursor.execute("""
                    SELECT * FROM working_videos WHERE project_id = ?
                    ORDER BY version
                """, (project_id,))
                working_videos_data = [_row_to_dict(row) for row in cursor.fetchall()]

                # 4. Build archive JSON
                archive = {
                    "version": ARCHIVE_VERSION,
                    "archived_at": datetime.utcnow().isoformat() + "Z",
                    "project": project_data,
                    "working_clips": working_clips_data,
                    "working_videos": working_videos_data,
                }

                # 5. Serialize to JSON
                archive_json = json.dumps(archive, indent=2, default=str)
                archive_bytes = archive_json.encode('utf-8')

                # 6. Upload to R2
                r2_path = _get_archive_r2_key(project_id)
                if not upload_bytes_to_r2(user_id, r2_path, archive_bytes):
                    logger.error(f"Failed to upload archive to R2 for project {project_id}")
                    return False

                logger.info(f"Uploaded archive to R2: {user_id}/{r2_path} ({len(archive_bytes)} bytes)")

                # 7. Clear FK, delete working data, mark archived
                cursor.execute(
                    "UPDATE projects SET working_video_id = NULL, archived_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (project_id,),
                )
                cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
                clips_deleted = cursor.rowcount
                cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
                videos_deleted = cursor.rowcount

                conn.commit()
                conn.execute("VACUUM")

                logger.info(
                    f"Archived project {project_id}: deleted {clips_deleted} working_clips, "
                    f"{videos_deleted} working_videos from DB"
                )
            else:
                cursor.execute(
                    "UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (project_id,),
                )
                conn.commit()
                logger.info(f"Marked project {project_id} as archived (R2 disabled, working data kept)")
            return True

    except Exception as e:
        logger.error(f"Failed to archive project {project_id}: {e}", exc_info=True)
        return False


def restore_project(project_id: int, user_id: Optional[str] = None) -> bool:
    """
    Restore a project from R2 archive back to the database.

    Downloads the archive JSON from R2, inserts records back into DB,
    sets restored_at timestamp, then deletes the archive from R2.

    Args:
        project_id: ID of the project to restore
        user_id: User ID (defaults to current user from context)

    Returns:
        True if restore succeeded, False otherwise
    """
    if not R2_ENABLED:
        logger.warning(f"R2 disabled, cannot restore project {project_id}")
        return False

    if user_id is None:
        user_id = get_current_user_id()

    try:
        # 1. Download archive JSON from R2
        client = get_r2_client()
        if not client:
            logger.error("R2 client not available for restore")
            return False

        r2_path = _get_archive_r2_key(project_id)
        full_key = r2_key(user_id, r2_path)

        try:
            response = client.get_object(Bucket=R2_BUCKET, Key=full_key)
            archive_bytes = response['Body'].read()
            archive = json.loads(archive_bytes.decode('utf-8'))
        except client.exceptions.NoSuchKey:
            logger.warning(f"Archive not found in R2 for project {project_id}")
            return False
        except Exception as e:
            logger.error(f"Failed to download archive from R2: {e}")
            return False

        logger.info(f"Downloaded archive from R2: {full_key} ({len(archive_bytes)} bytes)")

        # 2. Insert data back into DB
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Check if project row already exists (common after archival —
            # archive deletes working data but keeps the project row)
            cursor.execute("SELECT id, working_video_id FROM projects WHERE id = ?", (project_id,))
            existing = cursor.fetchone()

            project = archive["project"]
            if not existing:
                # Full restore — insert project row (without working_video_id FK
                # to avoid constraint issues; we set it after inserting working_videos)
                proj_data = {k: v for k, v in project.items() if k != "working_video_id"}
                columns = list(proj_data.keys())
                placeholders = ", ".join(["?" for _ in columns])
                column_names = ", ".join(columns)
                values = [proj_data[col] for col in columns]

                cursor.execute(
                    f"INSERT INTO projects ({column_names}) VALUES ({placeholders})",
                    values
                )

            # Insert working_clips
            for clip in archive.get("working_clips", []):
                columns = list(clip.keys())
                placeholders = ", ".join(["?" for _ in columns])
                column_names = ", ".join(columns)
                values = [clip[col] for col in columns]

                cursor.execute(
                    f"INSERT INTO working_clips ({column_names}) VALUES ({placeholders})",
                    values
                )

            # Insert working_videos (must happen before setting FK on project)
            for video in archive.get("working_videos", []):
                columns = list(video.keys())
                placeholders = ", ".join(["?" for _ in columns])
                column_names = ", ".join(columns)
                values = [video[col] for col in columns]

                cursor.execute(
                    f"INSERT INTO working_videos ({column_names}) VALUES ({placeholders})",
                    values
                )

            # Now safe to set working_video_id FK, restored_at, and clear archived_at
            cursor.execute(
                "UPDATE projects SET working_video_id = ?, restored_at = CURRENT_TIMESTAMP, archived_at = NULL WHERE id = ?",
                (project.get("working_video_id"), project_id)
            )
            logger.info(f"Project {project_id} {'updated' if existing else 'inserted'} with working data")

            conn.commit()

            logger.info(
                f"Restored project {project_id}: {len(archive.get('working_clips', []))} clips, "
                f"{len(archive.get('working_videos', []))} videos"
            )

        # 3. Delete archive from R2 (only after successful DB insert)
        if delete_from_r2(user_id, r2_path):
            logger.info(f"Deleted archive from R2: {full_key}")
        else:
            logger.warning(f"Failed to delete archive from R2: {full_key}")
            # Don't fail the restore if delete fails - data is in DB now

        return True

    except Exception as e:
        logger.error(f"Failed to restore project {project_id}: {e}", exc_info=True)
        return False



def archive_completed_projects(user_id: Optional[str] = None) -> int:
    """
    Archive all completed projects that haven't been archived yet.

    A project is "complete" when it has a final_video_id. This runs on
    session init so that previous sessions' completed work is archived,
    keeping the DB small for R2 sync.

    Args:
        user_id: User ID (defaults to current user from context)

    Returns:
        Number of projects archived
    """
    if user_id is None:
        user_id = get_current_user_id()

    archived_count = 0

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            cursor.execute("""
                SELECT id FROM projects
                WHERE final_video_id IS NOT NULL
                AND archived_at IS NULL
            """)
            completed_projects = cursor.fetchall()

            if not completed_projects:
                return 0

            logger.info(f"Found {len(completed_projects)} completed projects to archive")

        for row in completed_projects:
            project_id = row['id']
            if archive_project(project_id, user_id):
                archived_count += 1
                logger.info(f"Archived completed project {project_id}")
            else:
                logger.warning(f"Failed to archive completed project {project_id}")

        return archived_count

    except Exception as e:
        logger.error(f"Failed to archive completed projects: {e}", exc_info=True)
        return archived_count


def cleanup_database_bloat() -> dict:
    """
    Clean up data that accumulates and bloats the database over time.

    Two sources of bloat:
    1. Old working_video versions: Each framing export creates a new version,
       but only the latest is ever read. Old versions with large highlights_data
       JSON waste significant space.
    2. Completed export_jobs: Historical export jobs with input_data blobs
       are never cleaned up. Keep only the last 7 days.

    Called on app startup (from ensure_database) to keep the DB small for R2 sync.

    Returns:
        Dict with counts of deleted rows per category.
    """
    result = {
        "working_videos_pruned": 0,
        "export_jobs_pruned": 0,
        "working_clips_pruned": 0,
        "before_after_tracks_pruned": 0,
        "modal_tasks_pruned": 0,
    }

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # 1. Delete old working_video versions (keep only latest per project)
            cursor.execute("""
                DELETE FROM working_videos
                WHERE id NOT IN (
                    SELECT wv1.id FROM working_videos wv1
                    WHERE wv1.version = (
                        SELECT MAX(wv2.version) FROM working_videos wv2
                        WHERE wv2.project_id = wv1.project_id
                    )
                )
            """)
            result["working_videos_pruned"] = cursor.rowcount

            # 2. Delete completed/errored export_jobs older than 7 days
            cursor.execute("""
                DELETE FROM export_jobs
                WHERE status IN ('complete', 'error')
                AND completed_at < datetime('now', '-7 days')
            """)
            result["export_jobs_pruned"] = cursor.rowcount

            # 3. T1160: Delete old working_clips versions (keep only latest per identity)
            # Pre-delete audit: identify exactly which rows will be removed and
            # whether any project would end up with zero surviving working_clips.
            # That's the T1532 data-loss signature — log it LOUDLY (ERROR) so a
            # future regression in latest_working_clips_subquery is visible in logs.
            cursor.execute(f"""
                SELECT wc.id, wc.project_id, wc.raw_clip_id, wc.version
                FROM working_clips wc
                WHERE wc.id NOT IN ({latest_working_clips_subquery(project_filter=False)})
            """)
            doomed = [dict(row) for row in cursor.fetchall()]

            if doomed:
                affected_projects = sorted({row['project_id'] for row in doomed})
                placeholders = ','.join(['?'] * len(affected_projects))
                cursor.execute(f"""
                    SELECT p.id, p.name,
                           (SELECT COUNT(*) FROM working_clips wc
                            WHERE wc.project_id = p.id
                            AND wc.id IN ({latest_working_clips_subquery(project_filter=False)})) AS surviving
                    FROM projects p
                    WHERE p.id IN ({placeholders})
                """, tuple(affected_projects))
                orphans = [dict(row) for row in cursor.fetchall() if row['surviving'] == 0]

                if orphans:
                    logger.error(
                        f"[Cleanup] T1532 signature: pruning {len(doomed)} working_clips "
                        f"will leave {len(orphans)} project(s) with zero surviving clips: "
                        f"{orphans}. Doomed rows: {doomed[:10]}"
                        f"{'...' if len(doomed) > 10 else ''}. "
                        f"Check queries.latest_working_clips_subquery for partition-key regression"
                    )
                else:
                    logger.info(
                        f"[Cleanup] Pruning {len(doomed)} old working_clips "
                        f"across projects {affected_projects}; "
                        f"sample: {doomed[:5]}{'...' if len(doomed) > 5 else ''}"
                    )

                cursor.execute(f"""
                    DELETE FROM working_clips
                    WHERE id NOT IN ({latest_working_clips_subquery(project_filter=False)})
                """)
                if cursor.rowcount != len(doomed):
                    logger.warning(
                        f"[Cleanup] working_clips delete count mismatch: "
                        f"predicted={len(doomed)} actual={cursor.rowcount} — "
                        f"rows changed between audit and delete"
                    )
                result["working_clips_pruned"] = cursor.rowcount

            # 4. T1160: Delete before_after_tracks for non-current final_videos
            cursor.execute("""
                DELETE FROM before_after_tracks
                WHERE final_video_id NOT IN (
                    SELECT final_video_id FROM projects WHERE final_video_id IS NOT NULL
                )
            """)
            result["before_after_tracks_pruned"] = cursor.rowcount

            # 5. T1160: Delete terminal modal_tasks older than 24h
            cursor.execute("""
                DELETE FROM modal_tasks
                WHERE status IN ('complete', 'error', 'cancelled')
                AND COALESCE(completed_at, created_at) < datetime('now', '-1 day')
            """)
            result["modal_tasks_pruned"] = cursor.rowcount

            any_pruned = any(v > 0 for v in result.values())
            if any_pruned:
                conn.commit()
                logger.info(
                    f"Database cleanup pruned: "
                    f"working_videos={result['working_videos_pruned']}, "
                    f"export_jobs={result['export_jobs_pruned']}, "
                    f"working_clips={result['working_clips_pruned']}, "
                    f"before_after_tracks={result['before_after_tracks_pruned']}, "
                    f"modal_tasks={result['modal_tasks_pruned']}"
                )

            # T1170: VACUUM only when DB exceeds threshold. Must run outside a
            # transaction; commit above ensures we're in autocommit state.
            db_path = get_database_path()
            if db_path.exists():
                size_before = db_path.stat().st_size
                if size_before > DB_SIZE_WARNING_THRESHOLD:
                    logger.info(
                        f"[Cleanup] DB {size_before // 1024}KB > "
                        f"{DB_SIZE_WARNING_THRESHOLD // 1024}KB — running VACUUM"
                    )
                    conn.execute("VACUUM")
                    size_after = db_path.stat().st_size
                    logger.info(
                        f"[Cleanup] VACUUM: {size_before // 1024}KB -> {size_after // 1024}KB "
                        f"({(size_before - size_after) // 1024}KB freed)"
                    )
                else:
                    logger.debug(
                        f"[Cleanup] DB {size_before // 1024}KB under "
                        f"{DB_SIZE_WARNING_THRESHOLD // 1024}KB — skipping VACUUM"
                    )

        return result

    except Exception as e:
        logger.error(f"Failed to cleanup database bloat: {e}", exc_info=True)
        return result


def is_project_archived(project_id: int, user_id: Optional[str] = None) -> bool:
    """
    Check if a project has an archive in R2.

    Args:
        project_id: ID of the project
        user_id: User ID (defaults to current user from context)

    Returns:
        True if archive exists in R2
    """
    if not R2_ENABLED:
        return False

    if user_id is None:
        user_id = get_current_user_id()

    from app.storage import file_exists_in_r2
    r2_path = _get_archive_r2_key(project_id)
    return file_exists_in_r2(user_id, r2_path)
