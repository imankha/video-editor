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


def final_filenames(project_id: int) -> list[str]:
    """Filenames of every final video of this project. Read BEFORE a new version is
    inserted, so the version the insert replaces (and deletes) is included (T16530)."""
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT filename FROM final_videos WHERE project_id = ?", (project_id,)
        ).fetchall()
    return [r["filename"] for r in rows]


def repoint_replaced_shares(user_id: str, profile_id, project_id: int, final_video_id: int,
                            old_filenames: list[str]) -> None:
    """T16530: a redo replaces the highlight in place, so share links made for an older
    version move to `final_video_id`. Callers run this only AFTER the DB sync to R2
    succeeded (a refused sync leaves the links on the old version and the manual
    "Update shared version" button). Never raises: a failure is logged and leaves
    the links where they were."""
    from app.services.sharing_db import repoint_shares_by_filename
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT fv.filename, fv.name, fv.duration, p.final_video_id FROM final_videos fv "
                "JOIN projects p ON p.id = fv.project_id WHERE fv.id = ? AND p.id = ?",
                (final_video_id, project_id),
            ).fetchone()
        if row is None or row["final_video_id"] != final_video_id:
            # A later render already replaced this one; it moves the links itself.
            logger.info(f"[Redo] project={project_id} final_video={final_video_id} is no longer "
                        f"current - share links left for the newer version")
            return
        moved = repoint_shares_by_filename(
            user_id, profile_id, [f for f in old_filenames if f != row["filename"]], final_video_id,
            row["filename"], row["name"], row["duration"],
        )
        if moved:
            logger.info(f"[Redo] project={project_id} moved {moved} share link(s) to "
                        f"final_video={final_video_id} user={user_id}")
    except Exception as e:
        logger.error(f"[Redo] FAILED moving share links project={project_id} "
                     f"final_video={final_video_id} user={user_id}: {e} - links keep the old version",
                     exc_info=True)


def _linked_final_video(cursor, project_id: int, working_video_id: int):
    # Deploy->v063 window: a below-head DB has no link column, so nothing is linked.
    if not column_exists(cursor, "final_videos", "source_working_video_id"):
        return None
    return cursor.execute(
        "SELECT id FROM final_videos WHERE project_id = ? AND source_working_video_id = ?",
        (project_id, working_video_id),
    ).fetchone()


async def finish_highlight(
    user_id: str, profile_id, project_id: int, working_video_id: int, *, record_event: bool = True,
) -> dict:
    """Finish the highlight sharpened into `working_video_id`. Never raises.

    `record_event=False` (T16540 backfill): no `highlight_finished`, a parent made no gesture now.

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
        old_filenames = final_filenames(project_id)

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

        if record_event and newly and not prior_published:
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
        step = "share_links"
        await asyncio.to_thread(repoint_replaced_shares, user_id, profile_id, project_id,
                                final_video_id, old_filenames)

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


# T16540: how long a session start waits for the stranded finish before going on
# without it (the rest is picked up on a later session start).
STRANDED_FINISH_TIMEOUT_S = 30

# An export still owns the project's finish (T16520's finalize or its recovery).
_ACTIVE_EXPORT_SQL = (
    "EXISTS (SELECT 1 FROM export_jobs ej WHERE ej.project_id = p.id "
    "AND (ej.status IN ('pending', 'processing') OR ej.stage = 'finishing'))"
)


def _stranded_highlights(cursor) -> list:
    """Highlights stranded before the server finish (T16540).

    A non-archived project with a sharpened working video whose latest final video is
    missing or unpublished. A project the parent moved back to drafts (re-edit sets
    restored_at) is their choice and stays as it is.
    """
    return cursor.execute(f"""
        SELECT p.id AS project_id, wv.id AS working_video_id, wv.created_at AS wv_created_at,
               fv.id AS final_video_id, fv.created_at AS fv_created_at,
               {_ACTIVE_EXPORT_SQL} AS active_export
        FROM projects p
        JOIN working_videos wv ON wv.id = p.working_video_id
        LEFT JOIN final_videos fv ON fv.id = (
            SELECT f.id FROM final_videos f WHERE f.project_id = p.id
            ORDER BY f.version DESC, f.id DESC LIMIT 1)
        WHERE p.archived_at IS NULL
          AND p.restored_at IS NULL
          AND (fv.id IS NULL OR fv.published_at IS NULL)
        ORDER BY p.id
    """).fetchall()


async def finish_stranded_highlights() -> dict:
    """Finish the current profile's stranded highlights. Never raises.

    T16540: 42 highlights were sharpened and paid for before T16520 and never reached
    Highlights. Each is finished the next time its owner's session starts, before the
    archive sweep, in the owner's own context (like resume_interrupted_finishes):
    - a rendered spotlight made from the latest sharpen (not older than it) is published
      as it is (mark_published on that row, so the spotlight is kept);
    - otherwise the latest sharpen is finished by finish_highlight (R2 copy, new final).
    No credits, no `highlight_finished` event. A failure (e.g. the working video is gone
    from R2) leaves the highlight as it was and is counted; the next session retries it.
    """
    from app.profile_context import get_current_profile_id
    from app.services import export_helpers
    from app.user_context import get_current_user_id

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    report = {"finished": 0, "failed": 0, "skipped_active": 0}
    try:
        with get_db_connection() as conn:
            stranded = _stranded_highlights(conn.cursor())
        if not stranded:
            return report

        published_rows = []
        for row in stranded:
            project_id = row["project_id"]
            if row["active_export"]:
                report["skipped_active"] += 1
                continue
            spotlight_is_current = (
                row["final_video_id"] is not None and row["fv_created_at"] >= row["wv_created_at"]
            )
            if spotlight_is_current:
                with get_db_connection() as conn:
                    mark_published(conn.cursor(), row["final_video_id"], project_id)
                    conn.commit()
                published_rows.append(project_id)
                continue
            finish = await finish_highlight(
                user_id, profile_id, project_id, row["working_video_id"], record_event=False,
            )
            report["finished" if finish["finished"] else "failed"] += 1

        if published_rows:
            if await asyncio.to_thread(export_helpers.sync_export_db_to_r2, user_id, profile_id):
                report["finished"] += len(published_rows)
            else:
                # Committed locally and marked sync-pending; the next write request retries.
                logger.error(f"[FinishStranded] FAILED step=sync projects={published_rows} "
                             f"user={user_id} - published locally, R2 sync pending")
                report["failed"] += len(published_rows)
    except Exception as e:
        logger.error(f"[FinishStranded] FAILED user={user_id} profile={profile_id}: {e}", exc_info=True)

    logger.info(f"[FinishStranded] user={user_id} profile={profile_id} finished={report['finished']} "
                f"failed={report['failed']} skipped_active={report['skipped_active']}")
    return report


def finish_stranded_highlights_for_session(timeout_s: float = STRANDED_FINISH_TIMEOUT_S) -> None:
    """Run finish_stranded_highlights from the synchronous session start. Never raises.

    The session start may itself run on the event loop (dev-login), so the coroutine
    runs on its own loop in a worker thread that carries this thread's user/profile
    context. It waits at most `timeout_s`; a finish still running then completes in
    the background (finish_highlight is idempotent, so a later session is safe).
    """
    import contextvars
    import threading

    try:
        with get_db_connection() as conn:
            if not _stranded_highlights(conn.cursor()):
                return  # the common case: nothing stranded, no thread
    except Exception as e:
        logger.error(f"[FinishStranded] FAILED to read stranded highlights: {e}", exc_info=True)
        return

    ctx = contextvars.copy_context()
    worker = threading.Thread(
        target=lambda: ctx.run(asyncio.run, finish_stranded_highlights()),
        name="finish-stranded", daemon=True,
    )
    worker.start()
    worker.join(timeout_s)
    if worker.is_alive():
        logger.warning(f"[FinishStranded] still running after {timeout_s}s - session start "
                       f"continues; the archive sweep will reach these on a later session")
