"""
Request Context Middleware — user context + database sync.

Combines user/profile context setup with R2 database synchronization in a
SINGLE BaseHTTPMiddleware. This is critical because BaseHTTPMiddleware's
call_next() copies the asyncio context for the inner app. If user context
and sync were in separate BaseHTTPMiddleware classes, ContextVar changes
(user_id, profile_id) set in one middleware would be invisible to the other
after call_next() returns. By combining them, all ContextVar reads/writes
happen in the same context — before and after a single call_next() boundary.

Flow:
1. Resolve user_id: rb_session cookie → auth DB → user_id (T405)
   Fallback: X-User-ID header (backward compat for tests/dev)
2. If no user_id and path is not allowlisted → 401
3. Set profile_id from header (or session init)
4. Initialize write tracking context (mutable dict)
5. call_next() — route handler runs, may write to DB
6. Check mutable dict for writes, sync to R2 if needed
7. Clean up context

Also tracks sync failure state per user and surfaces it via X-Sync-Status
header so the frontend can show a warning indicator.
"""

import asyncio
import cProfile
import contextlib
import logging
import os
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..profiling import (
    dump_profile,
    profile_on_breach_enabled,
    profile_breach_ms,
)

from ..database import (
    init_request_context,
    clear_request_context,
    sync_db_to_r2_explicit,
    sync_user_db_to_r2_explicit,
    get_request_has_writes,
    get_request_has_user_db_writes,
    mark_sync_pending,
    clear_sync_pending,
    has_sync_pending,
)
from ..profile_context import set_current_profile_id, get_current_profile_id
from ..session_init import user_session_init
from ..services.auth_db import validate_session
from ..storage import R2_ENABLED, APP_ENV
from ..user_context import set_current_user_id, set_current_req_id

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

# Thresholds for slow request warnings (in seconds)
SLOW_SYNC_THRESHOLD = 0.5  # 500ms - warn if DB sync takes this long
SLOW_REQUEST_THRESHOLD = 0.2  # 200ms - warn if total request takes this long (profiling target)

# Per-user in-flight request counter. Used to surface serialization: if a user
# has multiple concurrent requests and one of them is slow, other requests
# that wait behind it show up as "in_flight=N" at entry and exit times.
_INFLIGHT: dict[str, int] = defaultdict(int)
_INFLIGHT_LOCK = threading.Lock()

# Users with a sync attempt currently executing. Distinct from the
# `.sync_pending` marker file, which is set BEFORE a sync attempt for
# crash-recovery and stays set until the attempt succeeds. During a
# normal in-flight sync, concurrent readers would otherwise read that
# marker and emit X-Sync-Status: failed, flashing the frontend warning
# button. The header check AND-gates the marker with this set so only a
# persistent failure (marker present, no sync in flight) surfaces.
_SYNC_IN_PROGRESS: set[str] = set()
_SYNC_IN_PROGRESS_LOCK = threading.Lock()


def _begin_sync_attempt(user_id: str) -> None:
    with _SYNC_IN_PROGRESS_LOCK:
        _SYNC_IN_PROGRESS.add(user_id)


def _end_sync_attempt(user_id: str) -> None:
    with _SYNC_IN_PROGRESS_LOCK:
        _SYNC_IN_PROGRESS.discard(user_id)


def is_sync_attempt_in_progress(user_id: str) -> bool:
    with _SYNC_IN_PROGRESS_LOCK:
        return user_id in _SYNC_IN_PROGRESS

def _inflight_enter(user_id: str) -> int:
    with _INFLIGHT_LOCK:
        _INFLIGHT[user_id] += 1
        return _INFLIGHT[user_id]

def _inflight_exit(user_id: str) -> int:
    with _INFLIGHT_LOCK:
        _INFLIGHT[user_id] = max(0, _INFLIGHT[user_id] - 1)
        n = _INFLIGHT[user_id]
        if n == 0:
            _INFLIGHT.pop(user_id, None)
        return n


# T1531: Per-user WRITE lock. Writers (POST/PUT/PATCH/DELETE) serialize per-user
# so two concurrent writes can't race on the R2 db-version (last-write-wins
# would silently lose data). Readers (GET/HEAD/OPTIONS) take no lock — SQLite
# WAL handles read concurrency, and a stale read 200ms behind an in-flight
# write is acceptable. The dict is keyed per user, so users don't block each
# other. Locks are created lazily and never removed (one asyncio.Lock per
# active user is negligible memory).
WRITE_METHODS = frozenset(("POST", "PUT", "PATCH", "DELETE"))
_USER_WRITE_LOCKS: dict[str, asyncio.Lock] = {}
_USER_WRITE_LOCKS_GUARD = threading.Lock()
WRITE_LOCK_WAIT_LOG_MS = 50  # log when a writer waited longer than this for the lock


def _get_user_write_lock(user_id: str) -> asyncio.Lock:
    """Return the asyncio.Lock for this user, creating it on first access."""
    with _USER_WRITE_LOCKS_GUARD:
        lock = _USER_WRITE_LOCKS.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            _USER_WRITE_LOCKS[user_id] = lock
        return lock


@contextlib.asynccontextmanager
async def _maybe_write_lock(user_id: str | None, method: str, path: str, req_id: str):
    """Hold the per-user write lock for write methods; no-op for reads."""
    if not user_id or method not in WRITE_METHODS:
        yield
        return
    lock = _get_user_write_lock(user_id)
    wait_start = time.perf_counter()
    async with lock:
        wait_ms = (time.perf_counter() - wait_start) * 1000.0
        if wait_ms >= WRITE_LOCK_WAIT_LOG_MS:
            req_id_suffix = f" req_id={req_id}" if req_id else ""
            logger.info(
                f"[WRITE_LOCK_WAIT] {method} {path} user={user_id} "
                f"waited_ms={int(wait_ms)}{req_id_suffix}"
            )
        yield

# T1152: Sync failure state is backed by the .sync_pending marker file on disk
# (same marker used by T930 for crash-survival). This keeps a single source of
# truth and makes the degraded state survive backend restarts.


def is_sync_failed(user_id: str) -> bool:
    """Check if the given user has a pending sync failure."""
    return has_sync_pending(user_id)


def set_sync_failed(user_id: str, failed: bool) -> None:
    """Set or clear the sync failure marker for a user."""
    was_failed = has_sync_pending(user_id)
    if failed:
        mark_sync_pending(user_id)
        if not was_failed:
            logger.warning(f"[SYNC] User {user_id} entered degraded state - R2 sync failed")
    else:
        clear_sync_pending(user_id)
        if was_failed:
            logger.info(f"[SYNC] User {user_id} recovered - R2 sync succeeded")


def retry_pending_sync(user_id: str, profile_id: str | None = None) -> bool:
    """
    Retry a previously-failed R2 sync using explicit sync functions.

    Runs before init_request_context(), so it must NOT rely on request-scoped
    ContextVars. Uses the explicit helpers that take user_id/profile_id directly.

    Returns True iff both profile.sqlite and user.sqlite synced successfully.
    """
    from app import database as db_module
    from app import storage as storage_module

    profile_ok = True
    db_path = db_module.get_database_path()
    if db_path.exists() and profile_id:
        current_version = db_module.get_local_db_version(user_id, profile_id)
        success, new_version = storage_module.sync_database_to_r2_with_version(
            user_id, db_path, current_version, skip_version_check=True,
        )
        if success and new_version is not None:
            db_module.set_local_db_version(user_id, profile_id, new_version)
            profile_ok = True
        else:
            profile_ok = False

    user_ok = True
    user_db_path = db_module.USER_DATA_BASE / user_id / "user.sqlite"
    if user_db_path.exists():
        local_version = db_module.get_local_user_db_version(user_id)
        success, new_version = storage_module.sync_user_db_to_r2_with_version(
            user_id, user_db_path, local_version, skip_version_check=True,
        )
        if success and new_version is not None:
            db_module.set_local_user_db_version(user_id, new_version)
            user_ok = True
        else:
            user_ok = False

    return profile_ok and user_ok


class RequestContextMiddleware(BaseHTTPMiddleware):
    """
    Combined middleware for user context setup and R2 database sync.

    Merges UserContextMiddleware and DatabaseSyncMiddleware into one class
    to avoid ContextVar isolation across BaseHTTPMiddleware boundaries.
    """

    # Skip sync for these path prefixes (static files, health checks, auth, etc.)
    # T1531: /api/quests/achievements — idempotent INSERT OR IGNORE writes that
    # don't need immediate R2 sync. Skipping avoids the ~768ms R2 upload (and
    # the per-user write lock) on a fire-and-forget POST. The local SQLite
    # commit is durable; data syncs to R2 on the next non-achievement write.
    SKIP_SYNC_PATHS = (
        '/docs',
        '/redoc',
        '/openapi.json',
        '/api/health',
        '/api/auth',
        '/api/quests/achievements',
        '/api/shared/',
        '/static',
    )

    # T450: Routes that work WITHOUT prior user context (they establish it).
    # These get passed through even when no session cookie or X-User-ID is present.
    AUTH_ALLOWLIST_PREFIXES = (
        '/api/auth/',               # All auth sub-routes (google, email/*, me, logout)
        '/api/health',              # Health check
        '/api/quests/definitions',  # T1330: quest catalog is public (onboarding checklist)
        '/api/quests/progress',     # Pre-login quest panel: returns all-incomplete shape for anonymous callers
        '/api/shared/',             # T1750: public share links work without auth
        '/docs',                    # API docs
        '/redoc',                   # API docs
        '/openapi.json',            # OpenAPI spec
    )

    # Routes that are authenticated but touch only auth.sqlite — they don't
    # need the profile DB loaded, so skip the expensive user_session_init
    # cold path (R2 HEAD/GET on user.sqlite + profile.sqlite + cleanup passes).
    # /api/auth/init is intentionally NOT in this list — it runs session_init
    # itself in its handler, which is the explicit bootstrap call.
    SKIP_SESSION_INIT_PATHS = (
        '/api/auth/me',
        '/api/auth/whoami',
        '/api/auth/logout',
        '/api/auth/google',
        '/api/auth/send-otp',
        '/api/auth/verify-otp',
        '/api/auth/test-login',
    )

    def _is_allowlisted(self, request: Request) -> bool:
        """Check if this request can proceed without user context."""
        # OPTIONS preflight never needs user context
        if request.method == "OPTIONS":
            return True
        path = request.url.path
        return any(path.startswith(prefix) for prefix in self.AUTH_ALLOWLIST_PREFIXES)

    async def dispatch(self, request: Request, call_next) -> Response:
        """Profile-wrapped entry point.

        T1530/T1531: cProfile wraps ALL paths through the middleware (allowlisted,
        sync-skipped, and main) so any slow call is captured. The inner
        `_dispatch_impl` contains the original logic; this outer shell owns the
        timing/profile/log emission so there is a single place that logs
        `[SLOW REQUEST]` with the profile path attached.
        """
        method = request.method
        path = request.url.path
        req_id = request.headers.get("X-Request-ID", "")
        # Publish req_id to a ContextVar so downstream log lines (R2_CALL,
        # [Restore], slow-query traces) can attach it without being passed it
        # explicitly. Safe to set before user_id is resolved — the ContextVar
        # is request-scoped by Starlette.
        set_current_req_id(req_id)

        force_profile = request.headers.get("X-Profile-Request", "").lower() in ("1", "true", "yes")
        do_profile = profile_on_breach_enabled() or force_profile

        prof = None
        if do_profile:
            prof = cProfile.Profile()
            prof.enable()

        request_start = time.perf_counter()
        meta: dict = {"sync_duration": 0.0, "handler_duration": 0.0,
                      "user_id": None, "inflight_entry": 0, "inflight_exit": 0}
        try:
            return await self._dispatch_impl(request, call_next, meta)
        finally:
            total_duration = time.perf_counter() - request_start
            total_ms = total_duration * 1000.0
            profile_path = None
            req_id_suffix = f" req_id={req_id}" if req_id else ""
            if prof is not None:
                prof.disable()
                if force_profile or total_ms >= profile_breach_ms():
                    profile_path = dump_profile(
                        prof,
                        tag=f"{method}_{path}",
                        elapsed_ms=total_ms,
                        req_id=req_id,
                        extra=meta.get("user_id"),
                    )

            sync_duration = meta["sync_duration"]
            handler_duration = meta["handler_duration"]

            if sync_duration >= SLOW_SYNC_THRESHOLD:
                logger.warning(
                    f"[SLOW DB SYNC] {method} {path} - sync took {sync_duration:.2f}s "
                    f"(threshold: {SLOW_SYNC_THRESHOLD}s). Consider background sync."
                    f"{req_id_suffix}"
                )
            if total_duration >= SLOW_REQUEST_THRESHOLD:
                profile_suffix = f" profile={profile_path}" if profile_path else ""
                logger.warning(
                    f"[SLOW REQUEST] {method} {path} - total {total_duration:.2f}s "
                    f"(sync: {sync_duration:.2f}s, handler: {total_duration - sync_duration:.2f}s)"
                    f"{req_id_suffix}{profile_suffix}"
                )
            profile_timing_suffix = f" profile={profile_path}" if profile_path else ""
            logger.info(
                f"[REQ_TIMING] {method} {path} user={meta.get('user_id') or 'none'} "
                f"total_ms={int(total_ms)} "
                f"handler_ms={int(handler_duration * 1000)} "
                f"sync_ms={int(sync_duration * 1000)} "
                f"inflight_entry={meta['inflight_entry']} "
                f"inflight_exit={meta['inflight_exit']}"
                f"{req_id_suffix}{profile_timing_suffix}"
            )

    async def _dispatch_impl(self, request: Request, call_next, meta: dict) -> Response:
        """Set user context, process request, sync DB if writes occurred."""

        # --- User context setup (T405: cookie-first, header-fallback) ---
        user_id = None
        auth_source = "none"

        # 1. Try session cookie → central auth DB
        session_id = request.cookies.get("rb_session")
        if session_id:
            session = validate_session(session_id)
            if session:
                user_id = session["user_id"]
                auth_source = "session"

        # 2. Fallback: X-User-ID header (backward compat for dev/tests)
        # SECURITY: Only enabled in dev/staging -- never in production.
        if not user_id and APP_ENV != "production":
            raw_user_id = request.headers.get('X-User-ID')
            if raw_user_id:
                sanitized = ''.join(c for c in raw_user_id if c.isalnum() or c in '_-')
                if sanitized:
                    user_id = sanitized
                    auth_source = "header"

        # 3. T450: No default fallback — if no user and not allowlisted, reject
        if not user_id:
            if self._is_allowlisted(request):
                # Auth/health endpoints proceed without user context
                logger.info(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"user=none (allowlisted) | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return await call_next(request)
            else:
                logger.warning(
                    f"[REQ] {request.method} {request.url.path} | "
                    f"REJECTED — no session cookie or X-User-ID | "
                    f"origin={request.headers.get('origin', '-')}"
                )
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required. Please refresh the page to initialize a session."},
                )

        req_id = request.headers.get("X-Request-ID", "")
        req_id_suffix = f" req_id={req_id}" if req_id else ""
        logger.info(
            f"[REQ] {request.method} {request.url.path} | "
            f"user={user_id} (via {auth_source}) | "
            f"origin={request.headers.get('origin', '-')}"
            f"{req_id_suffix}"
        )

        meta["user_id"] = user_id
        set_current_user_id(user_id)

        # Identity-only routes (auth.sqlite only) skip session_init so /me stays
        # cheap on cold cache. /api/auth/init and all non-auth paths still run it.
        path = request.url.path
        skip_session_init = path in self.SKIP_SESSION_INIT_PATHS

        profile_id = request.headers.get('X-Profile-ID')
        if profile_id and re.match(r'^[a-f0-9]{8}$', profile_id):
            set_current_profile_id(profile_id)
        elif not skip_session_init:
            if profile_id:
                logger.warning(f"Invalid X-Profile-ID format: '{profile_id}', falling back to session init")
            init_result = user_session_init(user_id)
            profile_id = init_result.get("profile_id")
            if profile_id:
                set_current_profile_id(profile_id)

        # --- Skip sync for certain paths ---
        should_sync = R2_ENABLED and not any(
            request.url.path.startswith(prefix) for prefix in self.SKIP_SYNC_PATHS
        )

        if not should_sync:
            return await call_next(request)

        # T1531: serialize WRITE requests per user (R2 version race protection).
        # Reads bypass the lock — SQLite WAL handles concurrent reads, and the
        # next request after a write will see locally-committed state since we
        # commit BEFORE releasing the lock.
        async with _maybe_write_lock(user_id, request.method, request.url.path, req_id):
            return await self._sync_aware_flow(request, call_next, meta, user_id, req_id, profile_id=profile_id)

    async def _sync_aware_flow(
        self,
        request: Request,
        call_next,
        meta: dict,
        user_id: str,
        req_id: str,
        profile_id: str | None = None,
    ) -> Response:
        """Original write-tracking + R2 sync flow. Held inside the per-user
        write lock when the request is a writer; runs lock-free for readers."""

        # --- T930/T1150: Retry pending sync from previous failed request ---
        # T1536: run on a worker thread so the sync boto3 call (200-1000ms)
        # doesn't block the asyncio event loop.
        # T1537: only retry on WRITE requests. A read changes nothing, so
        # there is nothing for it to push to R2; running retry here just adds
        # an unnecessary R2 PutObject (~300-1000ms) onto the read latency.
        # Worse, when N concurrent reads all retry the same object, R2 returns
        # 429 ("reduce concurrent request rate"), keeping the user stuck in
        # degraded state. Writers run inside the per-user write lock, so only
        # one retry runs at a time per user — no concurrent same-key uploads.
        if request.method in WRITE_METHODS and has_sync_pending(user_id):
            # T1539: Skip retry if another sync (e.g. export worker) is already
            # uploading for this user. Their upload will either succeed (making
            # our retry redundant) or fail (leaving the marker for next request).
            from ..storage import get_upload_lock
            profile_lock = get_upload_lock(user_id, "profile")
            if not profile_lock.acquire(blocking=False):
                logger.info(f"[SYNC] Skipping retry - upload in progress for user {user_id}")
            else:
                profile_lock.release()
                logger.info(f"[SYNC] Retrying pending sync for user {user_id}")
                _begin_sync_attempt(user_id)
                try:
                    ok = await asyncio.to_thread(retry_pending_sync, user_id, profile_id)
                    if ok:
                        clear_sync_pending(user_id)
                        logger.info(f"[SYNC] Retry succeeded for user {user_id}")
                    else:
                        logger.warning(f"[SYNC] Retry still failing for user {user_id}")
                except Exception as e:
                    logger.warning(f"[SYNC] Retry failed for user {user_id}: {e}")
                finally:
                    _end_sync_attempt(user_id)

        # --- Request with sync tracking ---
        sync_duration = 0.0
        inflight_at_entry = _inflight_enter(user_id) if user_id else 0
        meta["inflight_entry"] = inflight_at_entry

        # Profiler enable/dispatch-level logging happens in dispatch() — see outer shell.
        force_profile = request.headers.get("X-Profile-Request", "").lower() in ("1", "true", "yes")
        do_profile = profile_on_breach_enabled() or force_profile

        try:
            # Initialize request context for write tracking
            init_request_context()

            # Process the request
            handler_start = time.perf_counter()
            response = await call_next(request)
            handler_duration = time.perf_counter() - handler_start
            meta["handler_duration"] = handler_duration

            # After request, sync if writes occurred
            had_writes = get_request_has_writes()
            had_user_db_writes = get_request_has_user_db_writes()
            if had_writes or had_user_db_writes:
                # T930: Mark pending BEFORE sync attempt — survives crash
                mark_sync_pending(user_id)
                _begin_sync_attempt(user_id)

                sync_start = time.perf_counter()
                sync_status = "ok"
                try:
                    if had_writes and had_user_db_writes:
                        # Both need syncing — run in parallel using explicit
                        # functions that take args instead of relying on ContextVars
                        _user_id = user_id
                        _profile_id = profile_id
                        timing = {}

                        # T1530/T1531: these run on worker threads, so the
                        # request-level cProfile (which only traces its own
                        # thread) misses them. Install per-worker profilers
                        # and dump siblings on breach.
                        do_sync_profile = do_profile

                        def _sync_profile():
                            sub_prof = cProfile.Profile() if do_sync_profile else None
                            if sub_prof:
                                sub_prof.enable()
                            t0 = time.perf_counter()
                            try:
                                return sync_db_to_r2_explicit(_user_id, _profile_id)
                            finally:
                                elapsed_ms = (time.perf_counter() - t0) * 1000
                                timing['profile_ms'] = elapsed_ms
                                if sub_prof:
                                    sub_prof.disable()
                                    if force_profile or elapsed_ms >= profile_breach_ms():
                                        dump_profile(
                                            sub_prof,
                                            tag=f"syncthread_profile_{_user_id}",
                                            elapsed_ms=elapsed_ms,
                                            req_id=req_id,
                                        )

                        def _sync_user():
                            sub_prof = cProfile.Profile() if do_sync_profile else None
                            if sub_prof:
                                sub_prof.enable()
                            t0 = time.perf_counter()
                            try:
                                return sync_user_db_to_r2_explicit(_user_id)
                            finally:
                                elapsed_ms = (time.perf_counter() - t0) * 1000
                                timing['user_ms'] = elapsed_ms
                                if sub_prof:
                                    sub_prof.disable()
                                    if force_profile or elapsed_ms >= profile_breach_ms():
                                        dump_profile(
                                            sub_prof,
                                            tag=f"syncthread_user_{_user_id}",
                                            elapsed_ms=elapsed_ms,
                                            req_id=req_id,
                                        )

                        # T1536: run both syncs on worker threads and AWAIT them.
                        # Uses asyncio.to_thread (not run_in_executor) so that
                        # ContextVars (profile_id, user_id) propagate to the
                        # worker threads — r2_key() reads them to build R2 paths.
                        profile_ok, user_ok = await asyncio.gather(
                            asyncio.to_thread(_sync_profile),
                            asyncio.to_thread(_sync_user),
                        )

                        # T1154: distinguishing log for partial-success events so we can
                        # measure frequency before deciding on atomic-sync strategy.
                        if profile_ok != user_ok:
                            logger.warning(
                                f"[SYNC_PARTIAL] user={_user_id} profile_ok={profile_ok} "
                                f"user_ok={user_ok} path={request.url.path} "
                                f"method={request.method}"
                            )

                        # Map explicit sync return values to middleware expectations
                        db_status = "ok" if profile_ok else "failed"
                        user_sync_success = user_ok

                        if PROFILING_ENABLED:
                            parallel_ms = (time.perf_counter() - sync_start) * 1000
                            p_ms = timing.get('profile_ms', 0)
                            u_ms = timing.get('user_ms', 0)
                            logger.info(
                                f"[PROFILE] R2 sync: {parallel_ms:.0f}ms parallel "
                                f"(would be {p_ms + u_ms:.0f}ms sequential: "
                                f"profile: {p_ms:.0f}ms + user: {u_ms:.0f}ms)"
                            )
                    elif had_writes:
                        _user_id = user_id
                        _profile_id = profile_id
                        result = await asyncio.to_thread(sync_db_to_r2_explicit, _user_id, _profile_id)
                        db_status = "ok" if result else "failed"
                        user_sync_success = True
                    else:
                        # had_user_db_writes only
                        db_status = "ok"
                        user_sync_success = await asyncio.to_thread(sync_user_db_to_r2_explicit, user_id)

                    if db_status == "conflict":
                        sync_status = "conflict"
                    elif db_status == "failed" or not user_sync_success:
                        sync_status = "failed"
                except Exception as sync_error:
                    logger.error(f"Sync to R2 raised exception: {sync_error}")
                    sync_status = "failed"
                finally:
                    _end_sync_attempt(user_id)
                sync_duration = time.perf_counter() - sync_start

                if sync_status == "ok":
                    # T930/T1152: clearing the marker is the single source of truth for recovery
                    clear_sync_pending(user_id)
                    logger.info(f"[SYNC] {request.method} {request.url.path} -> R2 sync OK ({sync_duration:.2f}s)")
                elif sync_status == "conflict":
                    # Marker remains (set by mark_sync_pending before the attempt)
                    logger.warning(f"[SYNC] {request.method} {request.url.path} -> version conflict ({sync_duration:.2f}s)")
                else:
                    logger.warning(f"[SYNC] {request.method} {request.url.path} -> R2 sync FAILED ({sync_duration:.2f}s)")

            # T950: Distinguish conflict from failure in header.
            # AND-gate with is_sync_attempt_in_progress: during a normal
            # in-flight sync the .sync_pending marker exists (set BEFORE
            # the attempt for crash-recovery), so concurrent readers would
            # otherwise emit X-Sync-Status: failed and flicker the
            # frontend warning button. Surface "failed" only when the
            # marker is stale and no attempt is running.
            if is_sync_failed(user_id) and not is_sync_attempt_in_progress(user_id):
                response.headers["X-Sync-Status"] = sync_status if (had_writes or had_user_db_writes) else "failed"

            return response

        except Exception as e:
            # On exception, still try to sync (changes may have been committed)
            try:
                had_writes = get_request_has_writes()
                had_user_db_writes = get_request_has_user_db_writes()
                if had_writes or had_user_db_writes:
                    sync_start = time.perf_counter()
                    _begin_sync_attempt(user_id)
                    try:
                        _err_user_id = user_id
                        _err_profile_id = profile_id
                        profile_ok = await asyncio.to_thread(
                            sync_db_to_r2_explicit, _err_user_id, _err_profile_id
                        ) if had_writes and _err_profile_id else True
                        user_ok = await asyncio.to_thread(
                            sync_user_db_to_r2_explicit, _err_user_id
                        ) if had_user_db_writes else True
                        overall_ok = profile_ok and user_ok
                    except Exception as sync_error:
                        logger.error(f"Sync to R2 raised exception after request error: {sync_error}")
                        overall_ok = False
                    finally:
                        _end_sync_attempt(user_id)
                    sync_duration = time.perf_counter() - sync_start

                    set_sync_failed(user_id, not overall_ok)
            except Exception as tracking_error:
                logger.error(f"Failed to track sync state after error: {tracking_error}")

            # Re-raise the original exception
            raise

        finally:
            # Always clean up request context
            clear_request_context()
            meta["sync_duration"] = sync_duration
            meta["inflight_exit"] = _inflight_exit(user_id) if user_id else 0


# Keep old name for backward compatibility with imports
DatabaseSyncMiddleware = RequestContextMiddleware
