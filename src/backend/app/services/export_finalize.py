"""
Unified, resumable, idempotent finalize for the multi-clip export pipeline
(T5630).

Two functions collapse the three divergent multi-clip finalize writers into one
code path so a restart-interrupted export recovers into the SAME state as an
uninterrupted one (the Brilliant-Control incident: recovery used to write a
minimal working_videos row with NO highlights/detections):

- ``upsert_working_video`` — the shared idempotent *persist transaction*
  (working_videos INSERT/UPDATE -> repoint project -> complete export_jobs ->
  stamp working_clips.exported_at + raw_clip_version). Used by the Modal in-band
  writer (via finalize_export), the local in-band writer, and recovery.

- ``finalize_export`` — the Modal *detect -> persist -> sync* orchestrator,
  resumable by ``export_jobs.stage``. Used by the Modal in-band path AND recovery
  (collapsing the old recovery-only ``finalize_modal_export`` stub).

Scope boundary (explicit): this is ONLY the multi-clip render->detect->persist
finalizer. Framing carry-forward and restore are OUT of scope and untouched.

Idempotency contract (there is NO UNIQUE constraint on working_videos
(project_id, version) — coexisting versions are by design, invariant #5 — so
insert-once is enforced in CODE, not by the DB):
- ``finalize_export`` early-returns when the job is already complete
  (stage=='complete' OR status=='complete') -> returns the existing working
  video, no duplicate row.
- ``upsert_working_video`` reuses the job's ``output_video_id`` row if it still
  exists (UPDATE in place, same version); otherwise INSERTs MAX(version)+1 and
  writes the new id back onto export_jobs.output_video_id so a later resume finds
  it. So a job that crashed AFTER insert but BEFORE complete never doubles up.
"""

import asyncio
import logging

from app.constants import ExportStage
from app.database import get_db_connection
from app.queries import latest_working_clips_subquery
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)


def _set_export_stage(job_id: str, stage: str) -> None:
    """Durable single-column stage checkpoint. Best-effort: a below-head profile
    DB missing the column (deploy->v028 window) must not crash the finalize."""
    try:
        with get_db_connection() as conn:
            conn.cursor().execute("UPDATE export_jobs SET stage = ? WHERE id = ?", (stage, job_id))
            conn.commit()
    except Exception as e:  # noqa: BLE001 — column may not exist pre-v028
        logger.warning(f"[Finalize] Could not set stage={stage} for job {job_id}: {e}")


def upsert_working_video(
    job: dict,
    *,
    filename: str,
    duration: float | None,
    highlights_data: bytes | None,
    detections_data: bytes | None = None,
    gpu_seconds: float | None = None,
    modal_function: str | None = None,
) -> int:
    """Shared idempotent persist transaction for the multi-clip finalizer.

    ``highlights_data`` / ``detections_data`` are ALREADY-ENCODED msgpack blobs
    (or None). The local in-band writer passes ``detections_data=None``
    (preserving its historical column omission — regions carry embedded
    detections); the Modal path passes both.

    Returns the working_videos.id (existing row reused, or newly inserted).
    Insert-once-per-job via the ``output_video_id`` back-reference (see module
    docstring).
    """
    job_id = job["id"]
    project_id = job["project_id"]
    existing_wv_id = job.get("output_video_id")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        wv_id = None
        if existing_wv_id:
            cursor.execute("SELECT id FROM working_videos WHERE id = ?", (existing_wv_id,))
            if cursor.fetchone():
                # Resume: UPDATE the existing row in place (same version) — never
                # a second coexisting version for the same job.
                cursor.execute(
                    """
                    UPDATE working_videos
                    SET filename = ?, duration = ?, highlights_data = ?, detections_data = ?
                    WHERE id = ?
                    """,
                    (filename, duration, highlights_data, detections_data, existing_wv_id),
                )
                wv_id = existing_wv_id

        if wv_id is None:
            cursor.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM working_videos WHERE project_id = ?",
                (project_id,),
            )
            next_version = cursor.fetchone()["next_version"]
            cursor.execute(
                """
                INSERT INTO working_videos
                    (project_id, filename, version, duration, highlights_data, detections_data)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (project_id, filename, next_version, duration, highlights_data, detections_data),
            )
            wv_id = cursor.lastrowid

        # Repoint the project at the new/updated working video.
        cursor.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, project_id))

        # Complete the job + write the output_video_id back-reference (idempotency
        # key for a later resume). COALESCE keeps prior gpu/function metadata when a
        # caller does not supply it (local path).
        cursor.execute(
            """
            UPDATE export_jobs
            SET status = 'complete',
                output_video_id = ?,
                output_filename = ?,
                completed_at = CURRENT_TIMESTAMP,
                gpu_seconds = COALESCE(?, gpu_seconds),
                modal_function = COALESCE(?, modal_function)
            WHERE id = ?
            """,
            (wv_id, filename, gpu_seconds, modal_function, job_id),
        )

        # Stamp the exported working clips (snapshot the raw-clip boundary version).
        cursor.execute(
            f"""
            UPDATE working_clips
            SET exported_at = datetime('now'),
                raw_clip_version = (
                    SELECT COALESCE(rc.boundaries_version, 1)
                    FROM raw_clips rc WHERE rc.id = working_clips.raw_clip_id
                )
            WHERE project_id = ? AND id IN ({latest_working_clips_subquery()})
            """,
            (project_id, project_id),
        )

        conn.commit()

    logger.info(f"[Finalize] upsert_working_video: job={job_id} project={project_id} working_video_id={wv_id}")
    return wv_id


async def finalize_export(
    job: dict,
    output_key: str,
    user_id: str,
    profile_id,
    *,
    video_duration: float | None = None,
    gpu_seconds: float | None = None,
    modal_function: str | None = None,
    progress_callback=None,
) -> dict:
    """Modal detect -> persist -> sync orchestrator, resumable by ``job['stage']``.

    Used by BOTH the Modal in-band path (writer 1) and recovery (collapsing the
    old ``finalize_modal_export`` stub). Re-running is safe: a completed job
    early-returns; a ``detecting``/``persisting`` job completes once.

    Detection is reconstructed from the persisted config: it decodes
    ``job['input_data']`` -> ``build_clip_boundaries_from_input(clips, transition)``
    and runs ``run_player_detection_for_highlights(user_id, output_key,
    source_clips)`` — **fps defaults to 30, matching writer 1 exactly (BINDING:
    do NOT pass input.target_fps)**. On any detection failure it falls back to
    ``generate_default_highlight_regions(source_clips)`` + ``_empty_video_detections()``
    (**BINDING: NOT None**) so a reel is never blank.

    Returns a dict:
      {finalized, working_video_id, output_filename, already_finalized?,
       sync_failed?, error?}
    """
    # Lazy import: the detection helpers live in the multi_clip router; importing
    # at module load would be circular (multi_clip imports services).
    from app.routers.export.multi_clip import (
        _empty_video_detections,
        build_clip_boundaries_from_input,
        generate_default_highlight_regions,
        run_player_detection_for_highlights,
    )
    from app.services.export_helpers import sync_export_db_to_r2
    from app.utils.encoding import encode_data

    job_id = job["id"]
    project_id = job["project_id"]

    # Idempotency (generalizes the old finalize_modal_export guard): a job already
    # complete returns its existing working video, no duplicate row.
    if job.get("stage") == ExportStage.COMPLETE.value or job.get("status") == "complete":
        logger.info(f"[Finalize] Job {job_id} already complete — no-op")
        return {
            "finalized": True,
            "already_finalized": True,
            "working_video_id": job.get("output_video_id"),
            "output_filename": job.get("output_filename"),
        }

    # A render with no output object cannot be finalized (preserves writer 3's
    # T4240 guard — never fabricate a filename / a row pointing at a missing R2
    # object). Mark the job error and fail loudly.
    if not output_key:
        logger.error(f"[Finalize] Cannot finalize job {job_id}: no output_key")
        try:
            with get_db_connection() as conn:
                conn.cursor().execute(
                    "UPDATE export_jobs SET status = 'error', error = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?",
                    ("Modal result incomplete: no output_key", job_id),
                )
                conn.commit()
        except Exception as db_err:  # noqa: BLE001
            logger.error(f"[Finalize] Also failed to mark job {job_id} error: {db_err}", exc_info=True)
        return {"finalized": False, "error": "Modal result incomplete: no output_key"}

    # Project must still exist (preserves writer 3's validation).
    with get_db_connection() as conn:
        if not conn.cursor().execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone():
            logger.error(f"[Finalize] Project {project_id} not found for job {job_id}")
            return {"finalized": False, "error": "Project not found"}

    # ---- detect -----------------------------------------------------------
    _set_export_stage(job_id, ExportStage.DETECTING.value)
    input_data = decode_data(job.get("input_data")) or {}
    clips = input_data.get("clips", [])
    transition = input_data.get("transition")
    source_clips = build_clip_boundaries_from_input(clips, transition)

    try:
        # fps defaults to 30 — BINDING fidelity rule #1 (do NOT pass target_fps).
        regions, video_detections = await run_player_detection_for_highlights(
            user_id=user_id,
            output_key=output_key,
            source_clips=source_clips,
            progress_callback=progress_callback,
        )
        logger.info(f"[Finalize] Detection complete for job {job_id}: {len(regions)} regions")
    except Exception as det_error:  # noqa: BLE001
        logger.warning(f"[Finalize] Detection failed for job {job_id}, using defaults: {det_error}")
        # Fallback uses _empty_video_detections() — BINDING fidelity rule #2 (NOT None).
        regions = generate_default_highlight_regions(source_clips)
        video_detections = _empty_video_detections()

    # ---- persist ----------------------------------------------------------
    _set_export_stage(job_id, ExportStage.PERSISTING.value)
    output_filename = output_key.split("/")[-1]
    wv_id = upsert_working_video(
        job,
        filename=output_filename,
        duration=video_duration,
        highlights_data=encode_data(regions),
        detections_data=encode_data(video_detections),
        gpu_seconds=gpu_seconds,
        modal_function=modal_function,
    )

    # ---- sync gate (invariant #1: sync BEFORE announcing complete) --------
    if not await asyncio.to_thread(sync_export_db_to_r2, user_id, profile_id):
        # Stay at 'persisting'; the working_video is committed locally and
        # mark_sync_pending (inside sync_export_db_to_r2) drives the R2 retry.
        logger.warning(f"[Finalize] R2 sync failed for job {job_id} — staying at persisting")
        return {
            "finalized": True,
            "sync_failed": True,
            "working_video_id": wv_id,
            "output_filename": output_filename,
        }

    _set_export_stage(job_id, ExportStage.COMPLETE.value)
    logger.info(f"[Finalize] Job {job_id} finalized: working_video_id={wv_id}")
    return {"finalized": True, "working_video_id": wv_id, "output_filename": output_filename}
