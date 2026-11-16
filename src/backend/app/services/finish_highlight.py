"""
Server-side finish (T16520): put a sharpened highlight in Highlights without a tap.

A highlight is finished when its latest final_videos row has published_at set. Until
T16520 only the browser did that (Finish -> no-keyframes overlay render -> POST
/api/downloads/publish), so a parent who closed the tab during the ~3.5 minute sharpen
never got a finished highlight. Now the framing finalize (export_finalize) calls
`finish_highlight` once the working video is persisted and synced, in the owner's own
request (in-band render or /modal-status recovery) or the next session's startup
recovery. Never from a session-less writer, so the request's DB seam is the copy it holds.

Three pieces live here so there is one writer of published_at and one place that
records `highlight_finished`:
- `mark_published`: the publish UPDATE (also used by POST /publish and the spotlight render).
- `record_finish`: the analytics event, once per highlight.
- `finish_highlight`: copy working -> final (deterministic key), insert + publish in one
  BEGIN IMMEDIATE transaction that re-checks the `source_working_video_id` link (a retry
  or a racing caller reuses the row), sync (CAS), and only THEN delete the replaced object.

It does not archive: the session-start sweep (archive_completed_projects) does, so the
Spotlight editor keeps its working data in this session (owner ruling, 2026-11-16).
It never raises: a failure is logged `[Finish] FAILED` and the highlight keeps its
pre-T16520 state (no published row; the Finish button still works).
"""

import asyncio
import logging

from app.database import column_exists, get_db_connection

logger = logging.getLogger(__name__)


def mark_published(cursor, final_video_id: int, project_id: int) -> bool:
    """Set published_at on this final video (caller commits). Returns newly_published.

    T5260: the name is frozen from the CURRENT project name (a rename after render
    must reach Highlights); a missing name keeps the render-time name, never NULL.
    """
    row = cursor.execute(
        "SELECT published_at FROM final_videos WHERE id = ?", (final_video_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"final_video {final_video_id} not found for project {project_id}")
    newly_published = row["published_at"] is None

    project_row = cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,)).fetchone()
    current_name = project_row["name"] if project_row else None
    if current_name:
        cursor.execute(
            "UPDATE final_videos SET published_at = CURRENT_TIMESTAMP, watched_at = NULL, "
            "name = ? WHERE id = ?",
            (current_name, final_video_id),
        )
    else:
        cursor.execute(
            "UPDATE final_videos SET published_at = CURRENT_TIMESTAMP, watched_at = NULL WHERE id = ?",
            (final_video_id,),
        )
        logger.info(
            f"[Publish] project name missing or empty for project={project_id} "
            f"final_video_id={final_video_id} - keeping existing frozen final_video name, "
            f"not overwriting with NULL"
        )
    return newly_published


def record_finish(user_id: str, profile_id, final_video_id: int) -> None:
    """T16510's event. Callers decide "once per highlight" (newly published and not
    a replacement of an already-published version)."""
    from app.analytics import SPORT_PROFILE_ID_CONTEXT_KEY, record_milestone
    record_milestone(user_id, "highlight_finished", {
        "final_video_id": final_video_id, SPORT_PROFILE_ID_CONTEXT_KEY: profile_id,
    })


def _linked_final_video(cursor, project_id: int, working_video_id: int):
    # Deploy->v063 window: a below-head DB has no link column, so nothing is linked.
    if not column_exists(cursor, "final_videos", "source_working_video_id"):
        return None
    return cursor.execute(
        "SELECT id FROM final_videos WHERE project_id = ? AND source_working_video_id = ?",
        (project_id, working_video_id),
    ).fetchone()


async def finish_highlight(user_id: str, profile_id, project_id: int, working_video_id: int) -> dict:
    """Finish the highlight sharpened into `working_video_id`. Never raises.

    Returns {"finished": True, "final_video_id": id} or
            {"finished": False, "reason": "<step>"}.
    """
    from app import storage
    from app.services import export_helpers, poster
    from app.services import publish_final_video as pfv

    step = "read"
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            wv = cursor.execute(
                "SELECT filename FROM working_videos WHERE id = ? AND project_id = ?",
                (working_video_id, project_id),
            ).fetchone()
            if wv is None:
                raise ValueError(f"working_video {working_video_id} not found")
            project = cursor.execute(
                "SELECT aspect_ratio FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            linked = _linked_final_video(cursor, project_id, working_video_id)

        published = None  # publish_final_video result, when this call inserted the row
        if linked:
            final_video_id = linked["id"]
            logger.info(f"[Finish] project={project_id} working_video={working_video_id} "
                        f"already has final_video={final_video_id} - reusing it")
            with get_db_connection() as conn:
                cursor = conn.cursor()
                newly = mark_published(cursor, final_video_id, project_id)
                conn.commit()
            prior_published = False
        else:
            step = "copy"
            output_filename = f"final_{project_id}_wv{working_video_id}.mp4"
            if not await storage.copy_file_in_r2(
                user_id, f"working_videos/{wv['filename']}", f"final_videos/{output_filename}"
            ):
                raise RuntimeError("R2 copy returned False")

            step = "aspect_ratio"
            aspect_ratio = await asyncio.to_thread(
                pfv.resolve_output_aspect_ratio,
                project_aspect_ratio=project["aspect_ratio"] if project else None,
                user_id=user_id,
                r2_relative_path=f"final_videos/{output_filename}",
                log_context=f"finish_highlight project={project_id}",
            )

            step = "publish"
            with get_db_connection() as conn:
                conn.execute("BEGIN IMMEDIATE")
                cursor = conn.cursor()
                linked = _linked_final_video(cursor, project_id, working_video_id)
                if linked:
                    # A racing finish (in-band vs startup recovery) inserted it first.
                    final_video_id = linked["id"]
                    newly = mark_published(cursor, final_video_id, project_id)
                    prior_published = False
                else:
                    published = pfv.publish_final_video(
                        cursor,
                        project_id=project_id,
                        output_filename=output_filename,
                        aspect_ratio=aspect_ratio,
                        source_working_video_id=working_video_id,
                    )
                    final_video_id = published["final_video_id"]
                    newly = mark_published(cursor, final_video_id, project_id)
                    prior_published = published["prior_published"]
                conn.commit()

            if published:
                step = "poster"
                try:
                    await poster.generate_poster_at_export(
                        user_id, final_video_id, output_filename,
                        published["slowmo_section"], published["duration"],
                        published["poster_marker_time"],
                    )
                except Exception as e:
                    # Same tolerance as publish: unfurl falls back to text without a poster.
                    logger.warning(f"[Finish] poster failed project={project_id} "
                                   f"final_video={final_video_id}: {e}")

        if newly and not prior_published:
            record_finish(user_id, profile_id, final_video_id)

        step = "sync"
        if not await asyncio.to_thread(export_helpers.sync_export_db_to_r2, user_id, profile_id):
            # Committed locally and marked sync-pending (sync_export_db_to_r2); the
            # replaced object is NOT deleted, so the R2 copy of the DB never points at
            # a missing file.
            logger.error(f"[Finish] FAILED project={project_id} step=sync "
                         f"final_video={final_video_id} user={user_id} - published locally, "
                         f"R2 sync pending")
            return {"finished": False, "reason": "sync_failed", "final_video_id": final_video_id}

        if published and published["prior_filename"] and not published["keep_prior"]:
            pfv.delete_prior_final_object(user_id, published["prior_filename"], output_filename)

        logger.info(f"[Finish] project={project_id} working_video={working_video_id} "
                    f"final_video={final_video_id} in Highlights (newly={newly}) user={user_id}")
        return {"finished": True, "final_video_id": final_video_id}
    except Exception as e:
        logger.error(
            f"[Finish] FAILED project={project_id} step={step} working_video={working_video_id} "
            f"user={user_id}: {e} - highlight keeps its unfinished state (Finish button)",
            exc_info=True,
        )
        return {"finished": False, "reason": step}
