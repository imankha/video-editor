"""
Project Archive Service for Video Editor.

Archives completed projects to R2 as JSON files to reduce active database size.
Projects are archived when exported (final_video created) and can be restored
when user opens them from the gallery.

Archive location: {user_id}/archive/{project_id}.json
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from io import BytesIO

from app.database import get_db_connection
from app.storage import (
    R2_ENABLED,
    upload_bytes_to_r2,
    download_from_r2,
    delete_from_r2,
    get_r2_client,
    R2_BUCKET,
    r2_key,
)
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

# Archive schema version for future migrations
ARCHIVE_VERSION = 1

# Stale threshold for restored projects (48 hours)
STALE_RESTORE_HOURS = 48


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
    if not R2_ENABLED:
        logger.debug(f"R2 disabled, skipping archive for project {project_id}")
        return False

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

            # 7. Delete from DB (order matters for FK constraints)
            # Note: final_videos stays - we only delete project-related data
            # Unlink FK references on project before deleting related records
            cursor.execute("UPDATE projects SET working_video_id = NULL, final_video_id = NULL WHERE id = ?", (project_id,))

            cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
            clips_deleted = cursor.rowcount

            cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
            videos_deleted = cursor.rowcount

            cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))

            conn.commit()

            logger.info(
                f"Archived project {project_id}: deleted {clips_deleted} working_clips, "
                f"{videos_deleted} working_videos from DB"
            )
            # VACUUM to reclaim disk space - keeps DB small for R2 sync
            conn.execute("VACUUM")
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

            # Check if project already exists (shouldn't happen, but safety check)
            cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
            if cursor.fetchone():
                logger.warning(f"Project {project_id} already exists in DB, skipping restore")
                return False

            # Insert project
            project = archive["project"]
            columns = list(project.keys())
            placeholders = ", ".join(["?" for _ in columns])
            column_names = ", ".join(columns)
            values = [project[col] for col in columns]

            cursor.execute(
                f"INSERT INTO projects ({column_names}) VALUES ({placeholders})",
                values
            )

            # Set restored_at timestamp
            cursor.execute(
                "UPDATE projects SET restored_at = CURRENT_TIMESTAMP WHERE id = ?",
                (project_id,)
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

            # Insert working_videos
            for video in archive.get("working_videos", []):
                columns = list(video.keys())
                placeholders = ", ".join(["?" for _ in columns])
                column_names = ", ".join(columns)
                values = [video[col] for col in columns]

                cursor.execute(
                    f"INSERT INTO working_videos ({column_names}) VALUES ({placeholders})",
                    values
                )

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


def clear_restored_flag(project_id: int) -> None:
    """
    Clear the restored_at flag for a project.

    Call this when a project is edited, making it a "real" active project
    that shouldn't be auto-archived on startup.

    Args:
        project_id: ID of the project
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE projects SET restored_at = NULL WHERE id = ?",
                (project_id,)
            )
            if cursor.rowcount > 0:
                logger.debug(f"Cleared restored_at flag for project {project_id}")
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to clear restored_at flag for project {project_id}: {e}")


def cleanup_stale_restored_projects(user_id: Optional[str] = None) -> int:
    """
    Re-archive any projects that were restored but not edited within 48 hours.

    Call this on app startup to clean up projects that users opened
    from gallery but didn't actually edit.

    Args:
        user_id: User ID (defaults to current user from context)

    Returns:
        Number of projects re-archived
    """
    if not R2_ENABLED:
        return 0

    if user_id is None:
        user_id = get_current_user_id()

    archived_count = 0

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # Find projects with restored_at older than 48 hours
            cursor.execute("""
                SELECT id FROM projects
                WHERE restored_at IS NOT NULL
                AND restored_at < datetime('now', '-48 hours')
            """)
            stale_projects = cursor.fetchall()

            if not stale_projects:
                return 0

            logger.info(f"Found {len(stale_projects)} stale restored projects to re-archive")

        # Archive each stale project (outside the connection context)
        for row in stale_projects:
            project_id = row['id']
            if archive_project(project_id, user_id):
                archived_count += 1
                logger.info(f"Re-archived stale project {project_id}")
            else:
                logger.warning(f"Failed to re-archive stale project {project_id}")

        return archived_count

    except Exception as e:
        logger.error(f"Failed to cleanup stale restored projects: {e}", exc_info=True)
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
    result = {"working_videos_pruned": 0, "export_jobs_pruned": 0}

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

            if result["working_videos_pruned"] > 0 or result["export_jobs_pruned"] > 0:
                conn.commit()
                # VACUUM to reclaim disk space after deletes
                conn.execute("VACUUM")
                logger.info(
                    f"Database cleanup: pruned {result['working_videos_pruned']} old working_video versions, "
                    f"{result['export_jobs_pruned']} old export_jobs"
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
