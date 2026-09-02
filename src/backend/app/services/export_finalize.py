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
from app.database import column_exists, get_db_connection
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
    except Exception as e:
        logger.warning(f"[Finalize] Could not set stage={stage} for job {job_id}: {e}")


def _claim_stage_for_finalize(job_id: str, expected_stage, new_stage: str) -> bool:
    """Compare-and-swap the stage column: only the caller whose `expected_stage`
    (its own snapshot read) still matches the DB gets to proceed into detect/persist.

    T7210: the in-band Modal path and a `/modal-status` recovery poll can now both
    reach `finalize_export` for the same job (recovery previously never finalized
    -- `modal_call_id` was always NULL). Both read a `job` snapshot before calling
    in, so a plain `UPDATE ... WHERE id = ?` would let both proceed and double-insert
    a working_videos row (the T5630 idempotency guard only catches an already-
    COMPLETE job, not two callers racing through detect/persist at once). Gating the
    stage transition on the caller's own snapshot makes only the first CAS win --
    SQLite serializes the UPDATE, so the loser's WHERE simply matches 0 rows.
    A legitimate sequential resume (previous attempt crashed) is unaffected: it
    re-reads the job fresh, so its snapshot's stage matches the DB and its CAS wins.
    """
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE export_jobs SET stage = ? WHERE id = ? AND stage IS ?",
                (new_stage, job_id, expected_stage),
            )
            if cursor.rowcount > 0:
                conn.commit()
                return True
            # No row matched the CAS. Distinguish "no export_jobs row exists at
            # all for this id" (some callers -- e.g. tests driving _export_clips
            # directly, and possibly other legacy entry points -- never insert
            # one; _set_export_stage's UPDATE has always silently no-op'd on
            # this before T7210, so there's nothing to race against) from "a
            # row exists but someone else already claimed it" (genuine
            # contention -- bail).
            exists = cursor.execute("SELECT 1 FROM export_jobs WHERE id = ?", (job_id,)).fetchone()
            conn.commit()
            return not exists
    except Exception as e:
        logger.warning(f"[Finalize] Could not claim stage={new_stage} for job {job_id}: {e}")
        # Below-head DB (deploy->v028 window, stage column absent) -- fail open,
        # matching _set_export_stage's existing best-effort behavior for that case.
        return True


def _working_videos_has_carry_columns(cursor) -> bool:
    """T4350 deploy->migrate guard: the carry columns (v046) may be absent on a
    profile DB that hasn't migrated yet. PRAGMA rows index positionally (row[1] ==
    column name) under either row factory."""
    cols = {row[1] for row in cursor.execute("PRAGMA table_info(working_videos)").fetchall()}
    return "framing_snapshot" in cols and "highlight_carry_note" in cols


def upsert_working_video(
    job: dict,
    *,
    filename: str,
    duration: float | None,
    highlights_data: bytes | None,
    detections_data: bytes | None = None,
    new_framing_snapshot: dict | None = None,
    gpu_seconds: float | None = None,
    modal_function: str | None = None,
) -> int:
    """Shared idempotent persist transaction for the multi-clip finalizer.

    ``highlights_data`` / ``detections_data`` are ALREADY-ENCODED msgpack blobs
    (or None). The local in-band writer passes ``detections_data=None``
    (preserving its historical column omission — regions carry embedded
    detections); the Modal path passes both.

    T4350: ``highlights_data`` is the FRESHLY-DETECTED regions (the first-export
    seed / multi-clip fallback). When ``new_framing_snapshot`` (a DECODED framing
    snapshot dict of what THIS export rendered with) is supplied, the INSERT branch
    reads the PRIOR working video's user-edited highlights + framing snapshot and
    runs ``resolve_carried_highlights`` to CARRY/transform them forward instead of
    silently discarding them. The decision runs ONLY on the INSERT branch — the
    resume/UPDATE branch preserves the already-carried columns (the project pointer
    has already been repointed, so re-reading the prior wv would read the new row
    itself). Detection output still feeds ``detections_data`` unconditionally.

    Returns the working_videos.id (existing row reused, or newly inserted).
    Insert-once-per-job via the ``output_video_id`` back-reference (see module
    docstring).
    """
    from app.utils.encoding import encode_data
    job_id = job["id"]
    project_id = job["project_id"]
    existing_wv_id = job.get("output_video_id")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # T6780: detections_data (v027) may be absent on a below-head profile DB in
        # the deploy->migrate window — this render/finalize path is reachable there
        # (the sibling v029/v046 columns are already guarded above/below, and the
        # matching READ in overlay.py is column_exists-guarded). Mirror the sanctioned
        # column-omit guard (T6030's slowmo INSERT): omit detections_data from the
        # write when the column is absent rather than 500 the export. A bare 503 would
        # abort the whole render — the wrong shape for a finalize path — and the value
        # is an OPTIONAL video-level detection cache that v027's migration backfills
        # later anyway (NULL now is correct). One PRAGMA per finalize, not per row.
        _has_detections = column_exists(cursor, "working_videos", "detections_data")

        wv_id = None
        if existing_wv_id:
            cursor.execute("SELECT id FROM working_videos WHERE id = ?", (existing_wv_id,))
            if cursor.fetchone():
                # Resume: UPDATE the existing row in place (same version) — never
                # a second coexisting version for the same job.
                # T4350: do NOT re-set highlights_data / framing_snapshot /
                # highlight_carry_note here. The carry decision ran on the original
                # INSERT; the project pointer is already repointed at THIS row, so
                # recomputing carry would read the new row as its own "prior" and
                # re-seed detected regions over the carried ones (the original bug,
                # on the recovery path). Only filename/duration/detections refresh.
                if _has_detections:
                    cursor.execute(
                        """
                        UPDATE working_videos
                        SET filename = ?, duration = ?, detections_data = ?
                        WHERE id = ?
                        """,
                        (filename, duration, detections_data, existing_wv_id),
                    )
                else:
                    cursor.execute(
                        "UPDATE working_videos SET filename = ?, duration = ? WHERE id = ?",
                        (filename, duration, existing_wv_id),
                    )
                wv_id = existing_wv_id

        if wv_id is None:
            # T4350: carry the prior version's user-edited highlights forward on a
            # brand-new version, instead of discarding them for `highlights_data`
            # (the fresh detection). Read the prior wv via the project pointer BEFORE
            # the repoint below (it still points at the OLD version here).
            insert_highlights = highlights_data
            snapshot_blob = None
            carry_note = None
            has_carry_cols = _working_videos_has_carry_columns(cursor)
            if new_framing_snapshot is not None and has_carry_cols:
                from app.services.highlight_carry import resolve_carried_highlights

                cursor.execute(
                    """
                    SELECT wv.highlights_data, wv.framing_snapshot
                    FROM working_videos wv
                    JOIN projects p ON p.working_video_id = wv.id
                    WHERE p.id = ?
                    """,
                    (project_id,),
                )
                prior = cursor.fetchone()
                prior_highlights = (
                    decode_data(prior["highlights_data"]) if prior and prior["highlights_data"] else None
                )
                prior_snapshot = (
                    decode_data(prior["framing_snapshot"]) if prior and prior["framing_snapshot"] else None
                )
                detected_regions = decode_data(highlights_data) if highlights_data else []
                final_regions, carry_note = resolve_carried_highlights(
                    prior_highlights=prior_highlights,
                    prior_snapshot=prior_snapshot,
                    new_snapshot=new_framing_snapshot,
                    detected_regions=detected_regions,
                    clip_count=int(new_framing_snapshot.get("clip_count", 1) or 1),
                )
                insert_highlights = encode_data(final_regions)
                snapshot_blob = encode_data(new_framing_snapshot)
                logger.info(
                    f"[Finalize] T4350 carry job={job_id}: prior_regions="
                    f"{len(prior_highlights) if prior_highlights else 0} -> "
                    f"final_regions={len(final_regions)} note={carry_note}"
                )

            cursor.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM working_videos WHERE project_id = ?",
                (project_id,),
            )
            next_version = cursor.fetchone()["next_version"]
            if has_carry_cols:
                cursor.execute(
                    """
                    INSERT INTO working_videos
                        (project_id, filename, version, duration, highlights_data, detections_data,
                         framing_snapshot, highlight_carry_note)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (project_id, filename, next_version, duration, insert_highlights, detections_data,
                     snapshot_blob, carry_note),
                )
            elif _has_detections:
                # deploy->migrate window (pre-v046): carry columns absent, INSERT the
                # historical shape. Carry is skipped this once; the next re-export
                # after migration takes the legacy_uncertain path.
                cursor.execute(
                    """
                    INSERT INTO working_videos
                        (project_id, filename, version, duration, highlights_data, detections_data)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (project_id, filename, next_version, duration, insert_highlights, detections_data),
                )
            else:
                # T6780: even older window (pre-v027) — detections_data column also
                # absent. Omit it too (v027's migration backfills it later); the carry
                # columns are guaranteed absent here as well (v046 > v027).
                cursor.execute(
                    """
                    INSERT INTO working_videos
                        (project_id, filename, version, duration, highlights_data)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (project_id, filename, next_version, duration, insert_highlights),
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

        # T8070: refresh the per-clip reel-source window to each clip's CURRENT
        # boundaries for every clip this (multi-clip) export rendered. Mirrors the
        # single-clip framing.py refresh; keeps a multi-clip reel from going
        # permanently stale. Column-guarded for the deploy->migrate window (v049).
        if column_exists(cursor, "raw_clips", "reel_source_start_time"):
            cursor.execute(
                f"""
                UPDATE raw_clips
                SET reel_source_start_time = start_time,
                    reel_source_end_time = end_time
                WHERE id IN (
                    SELECT raw_clip_id FROM working_clips
                    WHERE project_id = ?
                    AND id IN ({latest_working_clips_subquery()})
                    AND raw_clip_id IS NOT NULL
                )
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
        except Exception as db_err:
            logger.error(f"[Finalize] Also failed to mark job {job_id} error: {db_err}", exc_info=True)
        return {"finalized": False, "error": "Modal result incomplete: no output_key"}

    # Project must still exist (preserves writer 3's validation).
    with get_db_connection() as conn:
        if not conn.cursor().execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone():
            logger.error(f"[Finalize] Project {project_id} not found for job {job_id}")
            return {"finalized": False, "error": "Project not found"}

    # ---- detect -----------------------------------------------------------
    # CAS on the caller's own snapshot -- see _claim_stage_for_finalize. Losing
    # the race is not an error: the winner (in-band export or a concurrent
    # recovery poll) is already finalizing this job.
    if not _claim_stage_for_finalize(job_id, job.get("stage"), ExportStage.DETECTING.value):
        logger.info(f"[Finalize] Job {job_id} is already being finalized elsewhere — skipping")
        return {"finalized": False, "already_finalizing": True}

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
    except Exception as det_error:
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
        # T4350: the framing this export rendered with, captured at export START and
        # persisted into input_data (survives a recovery restart). None on a
        # pre-T4350 job -> upsert falls back to seeding the detected regions.
        new_framing_snapshot=input_data.get("framing_snapshot"),
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
