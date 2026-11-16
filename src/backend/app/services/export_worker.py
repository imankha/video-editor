"""
Export Worker - startup recovery for durable export jobs.

`recover_orphaned_jobs` runs on server startup and settles export_jobs rows
left 'processing' by a previous process. Exports themselves run through
`POST /api/export/render` (routers/export/multi_clip.py) and the overlay render.
"""

import logging

from ..database import get_db_connection
from . import export_job_repository

logger = logging.getLogger(__name__)


def recover_orphaned_jobs():
    """
    Recover jobs that were processing when the server stopped.

    Called on server startup to clean up any orphaned jobs.

    Behavior controlled by CLEAR_PENDING_JOBS_ON_STARTUP env var:
    - true: Mark all pending/processing jobs as error (dev mode)
    - false/unset: Try to recover Modal jobs, mark local orphans as error (production)

    T9135: plain `def`, not `async def` -- the whole body is blocking sqlite +
    a blocking `modal.FunctionCall.from_id(...).get()` network call, with no
    `await` anywhere. session_init._run_startup_recovery offloads this via
    `run_in_context` so it runs on a worker thread instead of whichever event
    loop the fire-and-forget recovery task lands on (same T6200 "whole body is
    synchronous -> should just be def" shape as the Publish-burst handlers).
    """
    import os
    clear_all = os.environ.get("CLEAR_PENDING_JOBS_ON_STARTUP", "false").lower() == "true"

    with get_db_connection() as conn:
        cursor = conn.cursor()

        if clear_all:
            # Dev mode: clear all pending/processing jobs
            cursor.execute("""
                SELECT id, status FROM export_jobs WHERE status IN ('pending', 'processing')
            """)
            stale_jobs = cursor.fetchall()

            if stale_jobs:
                logger.info(f"[ExportWorker] CLEAR_PENDING_JOBS_ON_STARTUP=true, clearing {len(stale_jobs)} stale jobs")
                export_job_repository.clear_pending_on_startup(cursor)
                conn.commit()
                for row in stale_jobs:
                    logger.info(f"[ExportWorker] Cleared stale job: {row['id']} (was {row['status']})")
            return

        # Production mode: try to recover Modal jobs
        cursor.execute("""
            SELECT id, modal_call_id FROM export_jobs WHERE status = 'processing'
        """)
        orphaned = cursor.fetchall()

    # T10360: this loop used to run its OWN ad-hoc Modal check whose `except
    # Exception` fell through to "mark as error" -- so ANY lookup hiccup killed a
    # dispatched job. routers/exports.check_modal_job_running is the T4240-hardened
    # three-state version of the same question; use it instead of a second copy.
    from ..routers.exports import check_modal_job_running
    from .export_helpers import refund_failed_export

    for row in orphaned:
        job_id = row['id']
        modal_call_id = row['modal_call_id']

        if modal_call_id:
            # T10360: a DISPATCHED job is never failed here, whatever Modal says.
            # This routine only knows that THIS process didn't render the job -- it
            # cannot see the render's output, so it cannot tell "died" from
            # "finished while we were restarting". `/modal-status` can (it
            # HEAD-probes the persisted output_key in R2 and finalizes), and
            # `cleanup_stale_exports` is the terminal backstop. NOTE: that sweep
            # is NOT an unattended reaper -- its only caller is this same user's
            # `GET /api/exports/active`, so both it and this routine run on the
            # owner's next visit. A user who never returns simply has no stuck UI
            # to see; nothing needs to reap on their behalf.
            # Failing it here instead just hides a finished render: the frontend
            # only polls /modal-status for jobs still listed active, and an errored
            # job is not. That is exactly how sakarati@'s 2026-09-18 Focus export
            # was lost -- Modal had already uploaded the finished video 2 minutes
            # before this loop marked the job error.
            running = check_modal_job_running(modal_call_id)
            if running:
                logger.info(f"[ExportWorker] Modal job {job_id} still running, keeping as processing")
            elif running is None:
                logger.info(f"[ExportWorker] Modal status unknown for {job_id}, keeping as processing")
            else:
                logger.info(f"[ExportWorker] Modal job {job_id} finished, will finalize on next status check")
            continue

        # Never dispatched to Modal -- nothing is running anywhere, so this one is
        # genuinely dead and the user must get their credits back.
        logger.warning(f"[ExportWorker] Found orphaned job: {job_id}, marking as error")
        with get_db_connection() as conn:
            cursor = conn.cursor()
            export_job_repository.fail(cursor, job_id, "Server restarted during processing")
            conn.commit()
        refund_failed_export(job_id)


