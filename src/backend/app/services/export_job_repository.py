"""
ExportJobRepository — the ONE owner of every export_jobs write (T4380).

Before this task, `export_jobs` had two competing create-helpers (one inserting
'pending', one 'processing' + swallowing insert failure) and 14+ raw
UPDATE/INSERT sites spread across 5 modules. Every function that writes to
`export_jobs` now lives here; callers pass an already-open `cursor` (they own
the connection/commit) so a transition can participate in a larger multi-table
transaction — e.g. export_finalize.upsert_working_video's single commit that
also writes working_videos/projects/working_clips.

Decisions recorded in docs/plans/tasks/export-write-path/T4380-export-job-repository.md
(Progress Log) and mirrored in .claude/knowledge/export-pipeline.md:

- `create()` inserts ExportStatus.PENDING — export_worker.process_export_job
  hard-gates on `status == 'pending'` before running a job, so this is the ONE
  value that keeps the async-worker path alive. `create_if_none_active()` is a
  SEPARATE creation path (T9540) for the synchronous inline-render endpoints,
  which insert PROCESSING because they ARE the worker for that request.
- `create()`/`create_if_none_active()` RAISE on insert failure. This is a
  deliberate behavior change from the old `export_helpers.create_export_job`,
  which swallowed the failure with a warning log and let the job run anyway
  with no DB record. Every other function here preserves its call site's
  existing swallow-or-raise behavior verbatim (most transition UPDATEs were
  already swallowed by their caller; that wrapping stays at the caller).
- `stage`/`output_key` (T5630 durable finalize checkpoints, ExportStage) are a
  DIFFERENT concept from `status` (ExportStatus) — kept as separate methods,
  never folded into start/complete/fail/recover.
"""

import logging

from ..constants import ExportStatus

logger = logging.getLogger(__name__)


# =============================================================================
# Creation
# =============================================================================

def create(cursor, *, job_id: str, project_id: int, job_type: str, input_data) -> str:
    """INSERT a new job as ExportStatus.PENDING. RAISES on failure (T4380: no
    more swallow-with-warning — a job that can't be recorded must not run).

    `input_data` is passed through as-is (already encoded by the caller — call
    sites disagree on encoding today, e.g. one passes a literal '{}' string
    rather than an encoded blob; the repository preserves each site's existing
    bytes verbatim rather than re-normalizing them).
    """
    cursor.execute(
        """
        INSERT INTO export_jobs (id, project_id, type, status, input_data)
        VALUES (?, ?, ?, ?, ?)
        """,
        (job_id, project_id, job_type, ExportStatus.PENDING.value, input_data),
    )
    logger.info(f"[ExportJobRepository] Created job {job_id} (type={job_type}, project={project_id}, status=pending)")
    return job_id


def create_processing(cursor, *, job_id: str, project_id: int, job_type: str, input_data) -> str:
    """INSERT a new job as ExportStatus.PROCESSING, unconditionally (no
    in-flight guard — see create_if_none_active for the guarded T9540
    variant). For a synchronous inline-render tracking row where the caller
    IS the worker for this request, same as create_if_none_active, but this
    specific call site (overlay.py's local-render path) never had the
    guard — preserved as its own plain insert rather than silently adding
    dedup semantics that weren't there before."""
    cursor.execute(
        """
        INSERT INTO export_jobs (id, project_id, type, status, input_data)
        VALUES (?, ?, ?, ?, ?)
        """,
        (job_id, project_id, job_type, ExportStatus.PROCESSING.value, input_data),
    )
    logger.info(f"[ExportJobRepository] Created job {job_id} (type={job_type}, project={project_id}, status=processing)")
    return job_id


def create_if_none_active(cursor, *, job_id: str, project_id: int, job_type: str, input_data) -> bool:
    """T9540 atomic per-(project, type) in-flight guard. INSERTs as
    ExportStatus.PROCESSING only when no active job already exists for this
    (project_id, type) — the caller IS the worker for this request (a
    synchronous inline render), unlike `create()`'s async-worker jobs. Already
    raised on failure before T4380 (a swallowed insert here would let a
    duplicate credit charge through); unchanged.

    Returns True if inserted (caller proceeds), False if an active job already
    exists (caller must charge nothing and return 409).
    """
    cursor.execute(
        """
        INSERT INTO export_jobs (id, project_id, type, status, input_data)
        SELECT ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1 FROM export_jobs
            WHERE project_id = ? AND type = ? AND status IN (?, ?)
        )
        """,
        (
            job_id, project_id, job_type, ExportStatus.PROCESSING.value, input_data,
            project_id, job_type, ExportStatus.PENDING.value, ExportStatus.PROCESSING.value,
        ),
    )
    inserted = cursor.rowcount == 1
    if inserted:
        logger.info(f"[ExportJobRepository] Created job {job_id} (type={job_type}, project={project_id}, status=processing)")
    else:
        logger.info(
            f"[ExportJobRepository] Duplicate dispatch blocked: active {job_type} job already exists "
            f"for project {project_id} (job {job_id} dropped)"
        )
    return inserted


# =============================================================================
# Reads (not write-owned by the single-owner rule, but the repository's own
# methods use these for transition validation; kept here per the task spec)
# =============================================================================

def get(cursor, job_id: str) -> dict | None:
    """Raw single-table read (no project join — see routers/exports.py
    get_export_job for the enriched response-shape read, which stays a plain
    SELECT and is out of this task's write-consolidation scope)."""
    cursor.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    return dict(row) if row else None


def get_stale_candidates(cursor, max_age_minutes: int) -> list:
    """Jobs still active (pending/processing) older than max_age_minutes —
    candidates for cleanup_stale_exports' Modal-liveness check.

    T10360 added `output_key` and `age_minutes`: the sweep must check whether the
    render actually produced its object in R2 before failing a job (a FINISHED
    generator call is indistinguishable from a dead one by Modal status alone),
    and must be able to give up on a permanently-UNKNOWN job by age instead of
    skipping it forever. Rows are read by NAME, never unpacked positionally."""
    cursor.execute(
        """
        SELECT id, modal_call_id, output_key,
               (julianday('now') - julianday(created_at)) * 1440 AS age_minutes
        FROM export_jobs
        WHERE status IN (?, ?)
          AND created_at < datetime('now', ? || ' minutes')
        """,
        (ExportStatus.PENDING.value, ExportStatus.PROCESSING.value, f'-{max_age_minutes}'),
    )
    return cursor.fetchall()


# =============================================================================
# Status transitions
# =============================================================================

def start(cursor, job_id: str) -> None:
    """pending -> processing (started_at stamped). Warns (never blocks) if the
    job wasn't pending — callers that need to REFUSE a non-pending job (the
    worker's own guard) check status themselves before calling this."""
    current = get(cursor, job_id)
    if current and current["status"] != ExportStatus.PENDING.value:
        logger.warning(f"[ExportJobRepository] start({job_id}): current status is {current['status']!r}, not pending")
    cursor.execute(
        "UPDATE export_jobs SET status = ?, started_at = datetime('now') WHERE id = ?",
        (ExportStatus.PROCESSING.value, job_id),
    )
    logger.info(f"[ExportJobRepository] Job {job_id} started processing")


def complete(
    cursor, job_id: str, *,
    output_video_id=None, output_filename=None,
    gpu_seconds=None, modal_function=None,
    preserve_gpu_metadata: bool = False,
) -> None:
    """-> complete (completed_at stamped).

    `preserve_gpu_metadata=True` COALESCEs gpu_seconds/modal_function onto
    their existing value instead of overwriting with None — used by
    export_finalize's resumable upsert, where a resumed call may omit metadata
    a prior attempt already recorded. All other call sites either always
    supply fresh gpu/modal values or never populate those columns for this job
    at all (so overwriting with None is a no-op against their existing NULL);
    direct-set (the default) matches their current behavior exactly.
    """
    current = get(cursor, job_id)
    if current and current["status"] in (ExportStatus.COMPLETE.value, ExportStatus.ERROR.value):
        logger.warning(f"[ExportJobRepository] complete({job_id}): job already terminal ({current['status']!r})")

    if preserve_gpu_metadata:
        cursor.execute(
            """
            UPDATE export_jobs
            SET status = ?, output_video_id = ?, output_filename = ?,
                completed_at = datetime('now'),
                gpu_seconds = COALESCE(?, gpu_seconds),
                modal_function = COALESCE(?, modal_function)
            WHERE id = ?
            """,
            (ExportStatus.COMPLETE.value, output_video_id, output_filename, gpu_seconds, modal_function, job_id),
        )
    else:
        cursor.execute(
            """
            UPDATE export_jobs
            SET status = ?, output_video_id = ?, output_filename = ?,
                completed_at = datetime('now'),
                gpu_seconds = ?, modal_function = ?
            WHERE id = ?
            """,
            (ExportStatus.COMPLETE.value, output_video_id, output_filename, gpu_seconds, modal_function, job_id),
        )
    logger.info(f"[ExportJobRepository] Job {job_id} completed (video_id: {output_video_id})")


def fail(cursor, job_id: str, error_message: str) -> None:
    """-> error (completed_at stamped). `error_message` is stored as given —
    truncation (some call sites cap at 500 chars, some don't) stays the
    caller's decision, matching current per-site behavior."""
    current = get(cursor, job_id)
    if current and current["status"] in (ExportStatus.COMPLETE.value, ExportStatus.ERROR.value):
        logger.warning(f"[ExportJobRepository] fail({job_id}): job already terminal ({current['status']!r})")
    cursor.execute(
        "UPDATE export_jobs SET status = ?, error = ?, completed_at = datetime('now') WHERE id = ?",
        (ExportStatus.ERROR.value, error_message, job_id),
    )
    logger.error(f"[ExportJobRepository] Job {job_id} failed: {error_message[:200]}")


def recover(cursor, job_id: str) -> None:
    """error -> processing, clearing error/completed_at. `/modal-status`'s
    reset when Modal reports still-running but the DB was wrongly marked
    error (e.g. a transient connection hiccup)."""
    current = get(cursor, job_id)
    if current and current["status"] != ExportStatus.ERROR.value:
        logger.warning(f"[ExportJobRepository] recover({job_id}): current status is {current['status']!r}, not error")
    cursor.execute(
        "UPDATE export_jobs SET status = ?, error = NULL, completed_at = NULL WHERE id = ?",
        (ExportStatus.PROCESSING.value, job_id),
    )
    logger.info(f"[ExportJobRepository] Job {job_id} recovered: error -> processing")


def clear_pending_on_startup(cursor, error_message: str = "Cleared on startup (dev mode)") -> int:
    """Dev-mode startup recovery bulk clear (CLEAR_PENDING_JOBS_ON_STARTUP=true):
    every pending/processing job -> error in one statement. Returns rowcount."""
    cursor.execute(
        "UPDATE export_jobs SET status = ?, error = ?, completed_at = CURRENT_TIMESTAMP WHERE status IN (?, ?)",
        (ExportStatus.ERROR.value, error_message, ExportStatus.PENDING.value, ExportStatus.PROCESSING.value),
    )
    return cursor.rowcount


# =============================================================================
# Non-status-transition writes (still export_jobs writes -> still owned here)
# =============================================================================

def acknowledge(cursor, job_ids: list[str] | None = None) -> int:
    """Mark exports as acknowledged (notification shown). Specific ids when
    given, else every unacknowledged terminal (complete/error) job. Returns
    rowcount."""
    if job_ids:
        placeholders = ','.join(['?' for _ in job_ids])
        cursor.execute(
            f"""
            UPDATE export_jobs
            SET acknowledged_at = datetime('now')
            WHERE id IN ({placeholders})
              AND acknowledged_at IS NULL
            """,
            job_ids,
        )
    else:
        cursor.execute(
            """
            UPDATE export_jobs
            SET acknowledged_at = datetime('now')
            WHERE acknowledged_at IS NULL
              AND status IN (?, ?)
            """,
            (ExportStatus.COMPLETE.value, ExportStatus.ERROR.value),
        )
    return cursor.rowcount


def store_modal_call_id(cursor, job_id: str, modal_call_id: str) -> None:
    """Record Modal's call_id + started_at for job recovery (no stage write —
    see store_modal_call_id_with_stage for the multi-clip variant that also
    stamps the T5630 stage checkpoint)."""
    cursor.execute(
        "UPDATE export_jobs SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?",
        (modal_call_id, job_id),
    )
    logger.info(f"[ExportJobRepository] Stored modal_call_id for {job_id}: {modal_call_id[:16]}...")


def store_modal_call_id_with_stage(cursor, job_id: str, modal_call_id: str, stage: str, output_key: str) -> None:
    """Multi-clip dispatch: record modal_call_id + started_at AND stamp
    stage='rendering' + output_key in the same write. Falls back to the
    stage-less UPDATE when the stage/output_key columns are absent (deploy->
    v028 window) — mirrors the pre-T4380 nested try/except exactly."""
    try:
        cursor.execute(
            """
            UPDATE export_jobs
            SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP, stage = ?, output_key = ?
            WHERE id = ?
            """,
            (modal_call_id, stage, output_key, job_id),
        )
    except Exception:
        cursor.execute(
            "UPDATE export_jobs SET modal_call_id = ?, started_at = CURRENT_TIMESTAMP WHERE id = ?",
            (modal_call_id, job_id),
        )


def set_input_data_checkpoint(cursor, job_id: str, input_data) -> None:
    """T5630 recovery checkpoint: persist the render config (clips/transition/
    framing_snapshot) so a restart can rebuild source_clips without Modal."""
    cursor.execute("UPDATE export_jobs SET input_data = ? WHERE id = ?", (input_data, job_id))


def set_rendered_checkpoint(cursor, job_id: str, stage: str, output_key: str) -> None:
    """T5630 stage='rendered': the render output now exists in R2."""
    cursor.execute("UPDATE export_jobs SET stage = ?, output_key = ? WHERE id = ?", (stage, output_key, job_id))


def set_stage(cursor, job_id: str, stage: str) -> None:
    """Durable single-column stage checkpoint (T5630). Caller retains its own
    best-effort try/except for the below-head-DB case (stage column absent)."""
    cursor.execute("UPDATE export_jobs SET stage = ? WHERE id = ?", (stage, job_id))


def claim_stage_for_finalize(cursor, job_id: str, expected_stage, new_stage: str) -> bool:
    """CAS the stage column on the caller's own snapshot (T7210) — only the
    caller whose `expected_stage` still matches the DB proceeds into detect/
    persist. Returns True on a successful claim (rowcount > 0); the caller
    (export_finalize._claim_stage_for_finalize) does its own SELECT-exists
    fallback + try/except when this returns False, unchanged."""
    cursor.execute(
        "UPDATE export_jobs SET stage = ? WHERE id = ? AND stage IS ?",
        (new_stage, job_id, expected_stage),
    )
    return cursor.rowcount > 0
