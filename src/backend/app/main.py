"""
Video Editor Backend API - Main Application Entry Point

This is the main FastAPI application that serves as the entry point for the
video editor backend. It configures CORS, exception handling, and includes
all routers for the API endpoints.

Architecture:
- main.py: App initialization, middleware, startup (this file)
- models.py: Pydantic models for request/response validation
- websocket.py: WebSocket connection management for real-time progress
- interpolation.py: Crop interpolation utilities for FFmpeg
- routers/health.py: Health check and status endpoints
- routers/export.py: Video export endpoints (crop, upscale, overlay)
- routers/detection.py: YOLO-based object detection endpoints
"""

import logging
import logging.handlers
import os
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file (if exists) BEFORE any `app.*` import.
# Must run first: several modules read env vars at import time (e.g. app.storage's
# module-level R2_ENABLED), and app.migrations transitively imports app.storage via
# one of its migration files -- if that import runs before load_dotenv(), R2_ENABLED
# (and any other such constant) freezes to its os.getenv() default for the process's
# whole life, regardless of what .env says.
_project_root = Path(__file__).parent.parent.parent.parent
_env_file = _project_root / ".env"
if _env_file.exists():
    load_dotenv(_env_file)
else:
    load_dotenv()  # Fallback to current directory

from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.migrations import BelowMigrationFloor, MigrationBlocked
from app.version import APP_BUILD, APP_VERSION

# Configure logging with timestamps
# Use DEBUG level if DEBUG env var is set, otherwise INFO
log_level = logging.DEBUG if os.getenv("DEBUG") else logging.INFO
logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# T2020: File-based log retention — survives Fly.io's ~47-line buffer limit
LOG_DIR = Path("/tmp/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
if sys.platform == "win32":
    _file_handler = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8")
else:
    _file_handler = logging.handlers.TimedRotatingFileHandler(
        LOG_DIR / "app.log", when="midnight", backupCount=1, encoding="utf-8"
    )
_file_handler.setFormatter(logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
))
logging.getLogger().addHandler(_file_handler)

# Quiet noisy third-party libraries (only show warnings and above)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("modal").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("grpc").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("s3transfer").setLevel(logging.WARNING)

# Import routers and websocket handler
from app.middleware import RequestContextMiddleware
from app.routers import (
    admin_router,
    auth_router,
    bootstrap_router,
    clips_router,
    collections_router,
    credits_router,
    detection_router,
    downloads_router,
    export_router,
    gallery_shares_router,
    games_router,
    games_upload_router,
    health_router,
    intro_cards_router,
    payments_router,
    profiles_router,
    projects_router,
    quests_router,
    settings_router,
    shared_router,
    storage_router,
    users_router,
)
from app.routers.exports import router as exports_router
from app.routers.privacy import router as privacy_router
from app.routers.rank import router as rank_router
from app.routers.telemetry import router as telemetry_router
from app.websocket import websocket_export_progress

# Environment detection
ENV = os.getenv("ENV", "development")
IS_DEV = ENV == "development"

# Create FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    """App startup/shutdown (T5060: replaces the deprecated @app.on_event
    handlers with the fastapi lifespan pattern). Bodies are unchanged; only the
    registration mechanism moved. Startup runs before `yield`, shutdown after.
    """
    # T6200: replace the loop's default executor. asyncio's default is
    # ThreadPoolExecutor(max_workers=min(32, cpu_count + 4)) = 5 on a 1-vCPU
    # Fly machine — far too small once request-path blocking I/O (validate_session,
    # hot sqlite reads) is offloaded via asyncio.to_thread. These offloads are
    # I/O-bound (psycopg2/sqlite3 release the GIL during their I/O), so a larger
    # bounded pool genuinely overlaps them. Bounded (not unbounded) so a
    # pathological burst can't exhaust memory.
    #
    # 32 (not maxconn=10): most offloads are sqlite/R2, not PG, and sqlite reads
    # need no pool connection — sizing this to 10 would needlessly throttle them.
    # The PG-touching subset is bounded SEPARATELY by pg.py's checkout gate
    # (a BoundedSemaphore sized to maxconn), NOT by this pool and NOT by the PG
    # pool itself: psycopg2's ThreadedConnectionPool does not backpressure — its
    # getconn() RAISES PoolError the moment maxconn connections are out, which
    # db_sync turns into a 503. So the two numbers are decoupled on purpose: 32
    # threads for I/O concurrency, <=10 of them ever inside a PG checkout at once.
    import asyncio
    from concurrent.futures import ThreadPoolExecutor

    io_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="io")
    asyncio.get_running_loop().set_default_executor(io_executor)
    logger.info("[Startup] Default asyncio executor set to bounded I/O pool (max_workers=32)")

    # T6240: hand the main loop to session_init so startup recovery scheduled from
    # the offloaded (worker-thread) user_session_init still lands on this loop
    # fire-and-forget, instead of blocking the worker via asyncio.run().
    from .session_init import set_main_loop
    set_main_loop(asyncio.get_running_loop())

    await _startup_event()
    try:
        yield
    finally:
        await _shutdown_event()
        set_main_loop(None)
        io_executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(
    title="Video Editor API",
    version="0.1.0",
    description="Backend API for video editing application with AI upscaling",
    lifespan=lifespan,
)

# Configure CORS
_cors_extra = os.getenv("CORS_ORIGINS", "")
_cors_origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # Alternative port
]
if _cors_extra:
    _cors_origins.extend(origin.strip() for origin in _cors_extra.split(",") if origin.strip())

# NOTE: CORSMiddleware is added LAST (below, after every other middleware) so it
# is the OUTERMOST HTTP middleware. This is deliberate and load-bearing — see the
# block near the bottom of the middleware section. Do not re-add it here.

# Single combined middleware for user context + R2 sync.
# Must be ONE middleware because BaseHTTPMiddleware's call_next() copies the
# asyncio context. Separate middlewares can't share ContextVar state across
# the call_next() boundary. See db_sync.py for details.
app.add_middleware(RequestContextMiddleware)

# T1190: ASGI-level WebSocket replay. Added AFTER RequestContextMiddleware so it
# sits OUTSIDE it for WebSocket scopes (the only scopes it checks for
# fly_machine_id; HTTP scopes pass straight through). NOTE: the CORS and gpc
# middleware below are added even later, so they wrap this for HTTP — that is
# intentional (see the CORS block) and harmless here because both ignore
# WebSocket scopes, leaving FlyReplay first to see every ws connection.
from app.middleware.fly_replay import FlyReplayMiddleware

app.add_middleware(FlyReplayMiddleware)

# T1740: Log Global Privacy Control signal for CCPA compliance records
@app.middleware("http")
async def gpc_signal_middleware(request, call_next):
    if request.headers.get("Sec-GPC") == "1":
        logging.getLogger(__name__).debug(f"[Privacy] GPC signal detected: {request.url.path}")
    return await call_next(request)

# CORS must be the OUTERMOST HTTP middleware (added LAST so Starlette wraps it
# around everything). Prod bug 31p: overlay action POSTs to the cross-origin API
# host failed as "TypeError: Failed to fetch" (188x over a 6-min session) while
# same-origin video streaming kept working. Root cause: error/control responses
# produced by the middlewares below — the auth 401/503 in RequestContextMiddleware
# and the Fly machine-pinning replay Response (db_sync.py) — are emitted OUTSIDE
# the CORS boundary when CORS is inner, so they carry NO Access-Control-Allow-*
# headers. A cross-origin browser then blocks the response and surfaces it as an
# opaque network error instead of a real status the frontend can act on. Making
# CORS outermost guarantees every response (success, 4xx/5xx, and preflight)
# carries CORS headers, and lets preflights be answered before auth/pinning run.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # T6390: X-Sync-Diag rides alongside X-Sync-Status. It MUST be exposed or the
    # cross-origin staging/prod client cannot read it (same-origin dev hides this).
    expose_headers=["X-Sync-Status", "X-Sync-Diag", "X-App-Version", "X-App-Build"],
    max_age=86400,
)


# T5070/Tbug40p: stamps X-App-Version (commit sha) and X-App-Build (monotonic build
# number) on EVERY response (success, 4xx/5xx, preflight) so the frontend update gate
# (sessionInit.js fetch interceptor + pwaUpdate.js resume poll) can compare the running
# client's baked build number against the deployed server's. Added even after
# CORSMiddleware (outermost per the T4900 CORS lesson above) so these headers survive
# auth 401s and fly-replay Responses too.
class AppVersionHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-App-Version"] = APP_VERSION
        response.headers["X-App-Build"] = str(APP_BUILD)
        return response


app.add_middleware(AppVersionHeaderMiddleware)

# Include routers
app.include_router(health_router)
app.include_router(export_router)
app.include_router(detection_router)
app.include_router(projects_router)
app.include_router(clips_router)
app.include_router(games_router)
app.include_router(games_upload_router)
app.include_router(downloads_router)
app.include_router(collections_router)
app.include_router(rank_router)
app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(settings_router)
app.include_router(profiles_router)
app.include_router(intro_cards_router)
app.include_router(credits_router, prefix="/api")
app.include_router(quests_router, prefix="/api")
app.include_router(exports_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(payments_router, prefix="/api")
app.include_router(gallery_shares_router)
app.include_router(shared_router)
app.include_router(telemetry_router)
app.include_router(users_router)
app.include_router(bootstrap_router)
app.include_router(privacy_router)

# T1530/T1531: debug endpoints (profile listing/reading). Gated internally
# by DEBUG_ENDPOINTS_ENABLED=true.
from app.routers._debug import router as _debug_router

app.include_router(_debug_router, prefix="/api")

# T4120: durability test seams — mounted ONLY in dev/development/local/test, never
# production/staging (layer 2 of the prod-impossibility gate). The router prefixes
# its own /api/test. See app/routers/test_seams.py.
from app.storage import _test_seams_enabled

if _test_seams_enabled():
    from app.routers.test_seams import router as test_seams_router
    app.include_router(test_seams_router)
    logging.getLogger(__name__).warning("[T4120] test seams mounted (/api/test/*) — non-prod env")


# T5180: rich text engine font delivery (design §5, gate decision Q3). ONE
# physical copy of each TTF (in app/assets/fonts/), served here to the
# browser for @font-face AND resolved by absolute path in
# app/services/text_render.py for Pillow rendering — same bytes both sides,
# the precondition for the parity test to mean anything. This mount serves
# ONLY assets/fonts/ (not the broader assets/ tree, so it never exposes
# assets/branding/ used by branded_outro.py).
class _LongCacheTTFStaticFiles(StaticFiles):
    """Long, immutable Cache-Control for .ttf responses; manifest.json/fonts.json
    stays at StaticFiles' default (short/no special caching) so a future
    catalogue change is picked up without a cache-bust scheme."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        full_path = args[0] if args else kwargs.get("full_path")
        if full_path and str(full_path).endswith(".ttf"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


_FONTS_ASSETS_DIR = Path(__file__).resolve().parent / "assets" / "fonts"
app.mount("/api/fonts", _LongCacheTTFStaticFiles(directory=_FONTS_ASSETS_DIR), name="fonts")


# WebSocket endpoint for export progress
@app.websocket("/ws/export/{export_id}")
async def ws_export_progress(websocket: WebSocket, export_id: str):
    """WebSocket endpoint for real-time export progress updates"""
    await websocket_export_progress(websocket, export_id)



def get_git_version_info():
    """Get git commit hash and branch name for logging"""
    try:
        commit_hash = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        short_hash = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        branch = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        commit_date = subprocess.check_output(
            ['git', 'log', '-1', '--format=%cd', '--date=iso'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        dirty = subprocess.call(
            ['git', 'diff-index', '--quiet', 'HEAD', '--'],
            stderr=subprocess.DEVNULL
        ) != 0

        return {
            'commit': commit_hash,
            'short_commit': short_hash,
            'branch': branch,
            'commit_date': commit_date,
            'dirty': dirty
        }
    except Exception as e:
        logger.warning(f"Could not retrieve git version info: {e}")
        return None


def _graceful_shutdown(signum, frame):
    """Handle SIGTERM for graceful shutdown: checkpoint WAL and sync databases to R2."""
    shutdown_start = time.perf_counter()
    logger.info("[Shutdown] SIGTERM received, starting graceful shutdown")

    try:
        from app.database import USER_DATA_BASE
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            logger.info("[Shutdown] R2 not enabled, skipping sync")
            sys.exit(0)

        # T405: Auth DB — sessions are ephemeral, no sync needed on shutdown

        # Find all user database files and checkpoint + sync each
        synced = 0
        failed = 0
        if USER_DATA_BASE.exists():
            import sqlite3

            from app.database import get_local_db_version
            from app.storage import sync_database_to_r2_with_version

            for db_file in USER_DATA_BASE.glob("*/profiles/*/profile.sqlite"):
                parts = db_file.relative_to(USER_DATA_BASE).parts
                user_id = parts[0]
                profile_id = parts[2]
                try:
                    # WAL checkpoint
                    conn = sqlite3.connect(str(db_file))
                    pages = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    conn.close()
                    logger.info(f"[Shutdown] WAL checkpoint for user={user_id} profile={profile_id}: {pages}")

                    # Sync to R2. T5340: pass profile_id explicitly — the SIGTERM
                    # handler runs with NO request context, so the ContextVar is
                    # unset (r2_key would raise) or stale (mis-keys). Key off the
                    # profile_id parsed from the path.
                    # T4310: CAS ON (skip_version_check=False) — the signal handler
                    # is never on a request thread, so the HEAD adds no request
                    # latency. A stale machine going down mid-conflict must not
                    # overwrite R2 with its stale copy; storage.py refuses the
                    # upload on conflict (no re-download — see storage.py MAJOR-2 —
                    # the local baseline stays frozen, refused again on next boot).
                    version = get_local_db_version(user_id, profile_id)
                    success, new_version = sync_database_to_r2_with_version(
                        user_id, db_file, version, skip_version_check=False, profile_id=profile_id)
                    if success:
                        synced += 1
                    else:
                        failed += 1
                        if new_version is not None:
                            logger.warning(
                                f"[Shutdown] R2 version conflict for user={user_id} "
                                f"profile={profile_id} — refused (R2 at v{new_version})"
                            )
                        else:
                            logger.warning(f"[Shutdown] R2 sync failed for user={user_id} profile={profile_id}")
                except Exception as e:
                    failed += 1
                    logger.error(f"[Shutdown] Error syncing user={user_id} profile={profile_id}: {e}")

            # T4320: user.sqlite was NOT covered by shutdown sync before — a SIGTERM
            # after a user.sqlite write (credits, profile registry, quests) could lose
            # it on the next cold machine. Mirror the profile.sqlite block for it.
            from app.database import get_local_user_db_version
            from app.storage import sync_user_db_to_r2_with_version

            for db_file in USER_DATA_BASE.glob("*/user.sqlite"):
                user_id = db_file.relative_to(USER_DATA_BASE).parts[0]
                try:
                    # WAL checkpoint
                    conn = sqlite3.connect(str(db_file))
                    pages = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    conn.close()
                    logger.info(f"[Shutdown] WAL checkpoint for user={user_id} user.sqlite: {pages}")

                    # Sync to R2. T4310: CAS ON — see the profile.sqlite loop above.
                    version = get_local_user_db_version(user_id)
                    success, new_version = sync_user_db_to_r2_with_version(user_id, db_file, version, skip_version_check=False)
                    if success:
                        synced += 1
                    else:
                        failed += 1
                        if new_version is not None:
                            logger.warning(
                                f"[Shutdown] R2 version conflict for user={user_id} "
                                f"user.sqlite — refused (R2 at v{new_version})"
                            )
                        else:
                            logger.warning(f"[Shutdown] R2 sync failed for user={user_id} user.sqlite")
                except Exception as e:
                    failed += 1
                    logger.error(f"[Shutdown] Error syncing user={user_id} user.sqlite: {e}")

        elapsed = time.perf_counter() - shutdown_start
        logger.info(f"[Shutdown] Graceful shutdown completed in {elapsed:.2f}s ({synced} synced, {failed} failed)")

    except Exception as e:
        logger.error(f"[Shutdown] Error during graceful shutdown: {e}")

    sys.exit(0)


async def _startup_event():
    """Log version information on startup and register signal handlers"""
    logger.info("=" * 80)
    logger.info("VIDEO EDITOR BACKEND STARTING")
    logger.info("=" * 80)

    git_info = get_git_version_info()
    if git_info:
        logger.info("Git Version Information:")
        logger.info(f"  Branch: {git_info['branch']}")
        logger.info(f"  Commit: {git_info['short_commit']} ({git_info['commit'][:12]}...)")
        logger.info(f"  Date: {git_info['commit_date']}")
        if git_info['dirty']:
            logger.warning("  Status: DIRTY (uncommitted changes present)")
        else:
            logger.info("  Status: Clean")
    else:
        logger.info("Git version info not available")

    logger.info(f"Environment: {ENV}")
    logger.info(f"Python version: {sys.version.split()[0]}")
    logger.info("=" * 80)

    # T1570: Auto-enable profiling in dev/staging
    from app.profiling import profile_on_breach_enabled
    if ENV in ("development", "staging") and not os.getenv("PROFILE_ON_BREACH_ENABLED"):
        os.environ["PROFILE_ON_BREACH_ENABLED"] = "true"
        os.environ.setdefault("PROFILE_ON_BREACH_MS", "500")
        os.environ.setdefault("DEBUG_ENDPOINTS_ENABLED", "true")
        logger.info("[PROFILE] Auto-enabled profiling for dev/staging (threshold=500ms)")
    if profile_on_breach_enabled():
        from app.profiling import profile_breach_ms
        logger.info(f"[PROFILE] Profiling enabled (breach threshold={profile_breach_ms()}ms)")

    # Register SIGTERM handler for graceful shutdown (Fly.io sends SIGTERM before stopping)
    if not IS_DEV:
        signal.signal(signal.SIGTERM, _graceful_shutdown)
        logger.info("SIGTERM handler registered for graceful shutdown")

    # Log R2 restore status
    from app.storage import R2_ENABLED as _r2
    if _r2:
        logger.info("[Startup] R2 enabled — databases will be lazy-restored from R2 on first user request")
    else:
        logger.info("[Startup] R2 disabled — using local database only")

    # T1960: Initialize Postgres connection pool + schema for global data
    # (auth, sharing, game storage refs). Per-user SQLite stays as-is.
    from app.services.pg import init_pg_pool, init_pg_schema
    init_pg_pool()
    init_pg_schema()
    logger.info("[Startup] Postgres pool + schema initialized")

    # T5683: Initialize poster warming service (in-flight dedup + bounded concurrency)
    from app.services.poster_warmer import init_poster_warmer
    init_poster_warmer()
    logger.info("[Startup] Poster warming service initialized")

    # Default user 'a' init removed — all users now go through auth.
    # Profile context is set per-request by the middleware.

    # T1380 + T1390: orphaned-job recovery and modal queue drain are deferred to
    # each user's first request of this server process (see session_init.py).
    # Boot-time iteration over all users does not scale — most users have no
    # pending work, and per-user R2 restore at boot would dominate cold start.
    logger.info(
        "[Startup] orphaned-job recovery + modal queue drain deferred to "
        "per-user first request (runs once per user via user_session_init)"
    )

    # T1583: Start background sweep loop for auto-export + R2 cleanup
    from app.services.sweep_scheduler import start_sweep_loop
    await start_sweep_loop()

    # T1960: Hourly cleanup of expired sessions + OTP codes
    from app.services.cleanup import start_cleanup_loop
    await start_cleanup_loop()


async def _shutdown_event():
    from app.services.sweep_scheduler import stop_sweep_loop
    await stop_sweep_loop()

    from app.services.cleanup import stop_cleanup_loop
    await stop_cleanup_loop()

    from app.services.pg import close_pg_pool
    close_pg_pool()


@app.exception_handler(MigrationBlocked)
async def migration_blocked_handler(request, exc):
    """T5083: the JIT load-seam raises MigrationBlocked when a profile/user
    DB cannot be verified at head (wal_busy after one retry, sync_failed
    after one re-pull+retry, not_at_head, missing, or an outright exception —
    design §2.6). Never serve a below-head DB (no silent fallback) — map to a
    retryable 503 so the client re-lands once migration completes, matching
    the existing T5970/T6550 "pending migration" convention.
    """
    logger.warning(
        "[Migration] blocked user=%s profile=%s reason=%s",
        exc.user_id, exc.profile_id, exc.reason,
    )
    return JSONResponse(
        status_code=503,
        content={"detail": "Your data is being upgraded, please retry", "code": "pending_migration"},
    )


@app.exception_handler(BelowMigrationFloor)
async def below_migration_floor_handler(request, exc):
    """T5089: a DB below the hard migration floor is UNRECOVERABLE — the
    migrations that would lift it were pruned. Unlike MigrationBlocked (503,
    "retry, it'll resolve"), retrying can NEVER resolve this, so we return a
    non-retryable 500 with a distinct `code` (stops the client's retry loop)
    and log CRITICAL as the operator's signal to hand-recover the account
    (restore from backup / bespoke migrate). Fail visibly, never self-repair
    (CLAUDE.md no-silent-fallback)."""
    logger.critical(
        "[Migration] REFUSED below-floor DB: track=%s v%03d < floor v%03d path=%s",
        exc.db_type, exc.current, exc.floor, request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "This account's data is on an unsupported schema version and "
            "cannot be loaded. Support has been notified.",
            "code": "schema_below_floor",
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global exception handler that provides detailed errors in dev mode
    and sanitized errors in production
    """
    if IS_DEV:
        error_detail = {
            "error": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
            "request_url": str(request.url),
            "method": request.method
        }
        return JSONResponse(status_code=500, content=error_detail)
    else:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal Server Error",
                "message": "An error occurred while processing your request"
            }
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
