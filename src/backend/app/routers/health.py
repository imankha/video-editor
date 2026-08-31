"""
Health and status endpoints for the Video Editor API.

This router handles health checks, status endpoints, and the hello world endpoint.
"""

import asyncio
import logging
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Response

from ..database import (
    SyncResult,
    get_database_path,
    get_user_data_path,
    has_sync_conflict,
    is_database_initialized,
    list_pending_scopes,
)
from ..middleware.db_sync import USER_DB_SCOPE, drain_pending_scopes, set_sync_failed
from ..models import HelloResponse
from ..profile_context import get_current_profile_id
from ..storage import R2_ENABLED
from ..user_context import get_current_user_id
from ..version import APP_BUILD, APP_VERSION
from ..websocket import export_progress

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/api/version")
async def get_version(response: Response):
    """T5070/Tbug40p: unauthenticated version handshake — lets the client (pre-
    or post-login, incl. an idle PWA that made no other API call) read the
    deployed server's monotonic build number and gate only if it is strictly
    behind. `build` is the orderable truth; `version` (sha) is for correlation.
    """
    response.headers["Cache-Control"] = "no-store"
    return {"version": APP_VERSION, "build": APP_BUILD}


@router.post("/api/sync/flush-verify")
async def flush_verify():
    """T5070: barrier endpoint for the update-gate's step-3 durable flush.

    Being a POST (a WRITE method), RequestContextMiddleware's pending-sync
    retry (T930/T1150, db_sync.py `_sync_aware_flow`) already ran -- awaited,
    inside this user's per-request write lock -- BEFORE this handler executed.
    That retry either had nothing to do (nothing was pending) or just landed
    (or re-confirmed the failure of) any previously deferred fire-and-forget
    sync (the 0.5s upload-lock defer window, T3250). This handler makes no
    writes of its own: the barrier confirms EXISTING state landed, it does not
    create new state to sync.

    T5081 (review round 3, Q2): the middleware's own retry only covers THIS
    session's two scopes (its profile + user.sqlite) -- a pending marker on a
    DIFFERENT profile of this user (a stuck background export worker, e.g.)
    is deliberately NOT drained there (folding a foreign scope into that
    retry's verdict would let one stuck foreign profile poison every future
    write's in-band healing -- see retry_pending_sync's docstring). This
    endpoint's contract is "confirm EVERYTHING landed", so it is the one place
    that drains every pending scope, own and foreign, awaited -- the barrier
    a user occasionally hits (the update gate) is exactly where correctness
    should win over latency.
    """
    user_id = get_current_user_id()
    # round 2 MAJOR-4 precedent (_retry_resolve_conflict): get_current_profile_id()
    # raises RuntimeError when unset BY DESIGN. This barrier must still drain
    # every OTHER pending scope even without a profile context (a webhook-only
    # or admin session) rather than 500 — the profile scope is simply absent
    # from the extra set below; list_pending_scopes still finds it if a real
    # profile marker exists on disk.
    try:
        profile_id = get_current_profile_id()
    except RuntimeError:
        profile_id = None
    scopes = list_pending_scopes(user_id) | {USER_DB_SCOPE}
    if profile_id:
        scopes.add(profile_id)
    await asyncio.to_thread(drain_pending_scopes, user_id, scopes)
    remaining = sorted(list_pending_scopes(user_id))
    if remaining:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "sync_failed",
                "retryable": True,
                "scopes": remaining,
                "detail": "Could not confirm your latest changes were saved. Please try again.",
            },
        )
    return {"status": "ok"}


@router.get("/")
async def root():
    """Root endpoint - API info"""
    return {
        "message": "Video Editor API is running!",
        "version": "0.1.0",
        "status": "healthy",
        "docs": "/docs"
    }


@router.get("/api/hello", response_model=HelloResponse)
async def hello_world():
    """
    Hello World endpoint that demonstrates:
    - FastAPI (Python web framework)
    - Pydantic (data validation)
    - Async/await support
    """
    return HelloResponse(
        message="Hello from FastAPI + Python!",
        timestamp=datetime.now().isoformat(),
        tech_stack={
            "backend": "FastAPI",
            "language": "Python 3.11+",
            "async": True,
            "validation": "Pydantic"
        },
        fun_fact="FastAPI is one of the fastest Python frameworks, thanks to Starlette and Pydantic!"
    )


@router.get("/api/status")
async def get_status():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "video-editor-api",
        "timestamp": datetime.now().isoformat()
    }


@router.get("/api/health")
async def health_check():
    """Health check with database status.

    Works without X-Profile-ID header — reports profile-scoped DB status
    only when profile context is available.
    """
    t0 = time.perf_counter()
    from ..profile_context import get_current_profile_id
    try:
        get_current_profile_id()
        db_info = {
            "db_initialized": is_database_initialized(),
            "db_path": str(get_database_path()),
            "user_data_path": str(get_user_data_path()),
        }
    except RuntimeError:
        db_info = {
            "db_initialized": None,
            "db_path": None,
            "user_data_path": None,
            "note": "No X-Profile-ID header — call /api/auth/init first",
        }
    t1 = time.perf_counter()
    logger.info(f"[PROFILE health] handler={int((t1-t0)*1000)}ms")

    # T4120: non-secret render-mode flag for diagnostics (nothing branches on it;
    # dev-verify always runs local). Lets a worker eyeball whether a reused stack
    # is rendering locally.
    from ..services.modal_client import modal_enabled
    return {
        "status": "healthy",
        "modal_enabled": modal_enabled(),
        **db_info,
    }


@router.get("/api/debug/tasks")
async def debug_modal_tasks():
    """Debug endpoint: show modal_tasks status (for E2E test diagnostics)."""

    from ..database import get_db_connection
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, task_type, status, raw_clip_id, error,
                       created_at, started_at, completed_at
                FROM modal_tasks
                ORDER BY created_at DESC
                LIMIT 20
            """)
            tasks = []
            for row in cursor.fetchall():
                tasks.append({
                    "id": row["id"],
                    "task_type": row["task_type"],
                    "status": row["status"],
                    "raw_clip_id": row["raw_clip_id"],
                    "error": row["error"],
                    "created_at": row["created_at"],
                    "started_at": row["started_at"],
                    "completed_at": row["completed_at"],
                })
            return {"tasks": tasks}
    except Exception as e:
        return {"error": str(e)}


@router.post("/api/retry-sync")
async def retry_sync():
    """
    Manually retry syncing the local database to R2.

    Called by frontend when user clicks the sync failure indicator.
    Returns success/failure so the UI can update accordingly.
    """
    if not R2_ENABLED:
        return {"success": True, "message": "R2 not enabled, no sync needed"}

    user_id = get_current_user_id()
    logger.info(f"[SYNC] Manual retry requested by user {user_id}")

    # T5870: a CAS conflict is NOT blind-retryable — re-uploading a stale local
    # copy just re-refuses forever (the baseline is frozen by T4310), which is why
    # a refresh appeared to be "the only cure" (and, since session_init is
    # first-access-only, a refresh may not even heal it). Retry must instead pull
    # the newer R2 copy (restore-if-newer, the T4315 guard) so the user's local
    # copy is current again; the superseded local edit is reported honestly rather
    # than silently retried. Never loops.
    if has_sync_conflict(user_id):
        return await _retry_resolve_conflict(user_id)

    # T5081 (review round 3, Q4): route through drain_pending_scopes (the same
    # primitives every other sync path uses) instead of sync_db_to_cloud, which
    # only ever uploaded the CURRENT profile and then had its caller blanket-
    # clear .sync_pending for user.sqlite too, without ever having uploaded it.
    profile_id = get_current_profile_id()
    report = await asyncio.to_thread(
        drain_pending_scopes, user_id, {profile_id, USER_DB_SCOPE}
    )
    agg = report.aggregate()
    if agg is None:
        # Nothing was pending: the alarm the user clicked is stale (another
        # request's sync already landed these dbs). Clear the ALARM, not a
        # durability record — under INV-P there is none left to clear.
        set_sync_failed(user_id, False, profile_id=profile_id)
        logger.info(f"[SYNC] Manual retry user={user_id}: nothing pending, alarm was stale")
        return {"success": True, "nothing_pending": True}
    if agg == SyncResult.CONFLICT:
        # The drain surfaced a fresh conflict — resolve it the same way.
        return await _retry_resolve_conflict(user_id)
    if agg == SyncResult.FAILED:
        return {"success": False, "message": "Sync to R2 failed"}
    set_sync_failed(user_id, False, profile_id=profile_id)
    return {"success": True}


async def _retry_resolve_conflict(user_id: str) -> dict:
    """T5870: restore-if-newer to heal a CAS conflict, then report honestly.

    Pulls R2's newer copy into the local user.sqlite AND the current profile.sqlite
    (whichever moved) via the shared confirm_current_before_write guard, off the
    event loop, then drains whatever .sync_pending markers survive. On success the
    local copy is current again. On a refresh failure we DO NOT loop or force-push
    — we tell the user a newer version exists and to reload.

    T5081 (rounds 3-6): this function does NOT try to detect which scope its own
    confirm_current_before_write calls actually restored, and does not clear
    .sync_pending itself. Two failed designs tried that: (round 5) a version-
    before/after comparison across the two awaited restores was neither necessary
    nor sufficient proof a scope's pending record was moot; (round 6 self-found)
    a `downloaded` signal plumbed out of confirm_current_before_write was also
    wrong, because the reheal a CAS conflict schedules (schedule_profile_db_reheal
    / schedule_user_db_reheal) is very often already consumed by an ORDINARY
    request before Retry ever runs (e.g. the status poll that renders the
    conflict banner) — so by the time this function calls confirm_current_before_
    write, local is already current and it reports no download, even though the
    scope genuinely WAS just restored moments earlier by a different code path.
    INV-P reason (b) is now discharged at every site that actually performs a
    restore's download+swap (ensure_database, ensure_user_database,
    ensure_user_database_fresh, materialization.ensure_profile_db_local,
    migrations._migrate_profile_db — see the INV-P comment in database.py), so
    by the time we reach drain_pending_scopes below, has_sync_pending_scope is
    already accurate: a marker survives iff its scope's write is still
    genuinely undelivered (merely deferred, never behind R2), and the drain is
    exactly what delivers it — closing the gap where Retry used to report
    "restored" without ever uploading a scope that needed uploading.
    """
    from ..services.db_refresh import RefreshFailed, confirm_current_before_write

    honest_refusal = {
        "success": False,
        "conflict": True,
        "message": "A newer version of your work exists. Please reload the page to continue.",
    }

    # round 2 MAJOR-4: get_current_profile_id() raises RuntimeError when unset BY
    # DESIGN ("fails loudly"). Do NOT swallow it — without a profile we cannot
    # restore the conflicted profile.sqlite, so clearing .sync_conflict/.sync_pending
    # and reporting success would be a silent fallback over unresolved internal
    # state (CLAUDE.md). Refuse honestly instead; the markers stay set.
    try:
        profile_id = get_current_profile_id()
    except RuntimeError:
        logger.warning(
            f"[SYNC] Conflict retry for user {user_id} has no profile context — refusing"
        )
        return honest_refusal

    try:
        await asyncio.to_thread(confirm_current_before_write, user_id, None)
        await asyncio.to_thread(confirm_current_before_write, user_id, profile_id)
    except RefreshFailed as e:
        logger.warning(f"[SYNC] Conflict restore failed for user {user_id}: {e}")
        return honest_refusal

    # Deliver whatever is genuinely still undelivered (a scope merely deferred,
    # never behind R2, keeps its marker through the no-op restore above and
    # must still be uploaded) — drain_pending_scopes is a no-op per scope where
    # has_sync_pending_scope is already False, so this costs nothing when both
    # restores fully resolved everything.
    report = await asyncio.to_thread(
        drain_pending_scopes, user_id, {USER_DB_SCOPE, profile_id}
    )
    agg = report.aggregate()
    if agg == SyncResult.CONFLICT:
        # A fresh conflict surfaced during the drain (e.g. another machine wrote
        # again in the interim). Do NOT call set_sync_failed(False) first — that
        # would wipe the marker mark_sync_conflict just set for this new one.
        logger.warning(f"[SYNC] Conflict retry for user {user_id} hit a fresh conflict during drain")
        return honest_refusal
    if agg == SyncResult.FAILED:
        return {"success": False, "message": "Sync to R2 failed"}

    # Local is now current with R2 — BUT the user's refused local edit was replaced
    # by the newer copy from R2. The frontend MUST tell the user and reload so the
    # in-memory UI matches the restored DB (see syncStore.retrySyncToR2); it must
    # never silently flip to a clean state (round 2 BLOCKING). A conflict always
    # means the edit was superseded, regardless of whether THIS call is what
    # performed the download.
    set_sync_failed(user_id, False, profile_id=profile_id)
    logger.info(f"[SYNC] Conflict resolved via restore-if-newer for user {user_id} (local edit superseded)")
    return {
        "success": True,
        "restored": True,
        "message": "Your local changes were replaced by a newer version saved elsewhere.",
    }


@router.get("/api/export/progress/{export_id}")
async def get_export_progress(export_id: str):
    """
    Get the progress of an ongoing export operation (legacy - use WebSocket instead)
    """
    if export_id not in export_progress:
        raise HTTPException(status_code=404, detail="Export ID not found")

    return export_progress[export_id]
