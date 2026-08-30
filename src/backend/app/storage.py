"""
R2 Storage Backend for Video Editor.

Provides an abstraction layer for accessing user data either from local filesystem
or Cloudflare R2. When R2 is configured (via environment variables), files are
synced between local cache and R2.

Configuration:
    Set these environment variables to enable R2:
    - R2_ENABLED=true
    - R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
    - R2_ACCESS_KEY_ID=<your_access_key>
    - R2_SECRET_ACCESS_KEY=<your_secret_key>
    - R2_BUCKET=reel-ballers-users
"""

import logging
import os
import sqlite3
import threading
import time
from enum import Enum
from functools import lru_cache
from pathlib import Path

from cachetools import TTLCache

logger = logging.getLogger(__name__)

PROFILING_ENABLED = os.getenv("PROFILING_ENABLED", "false").lower() == "true"

# T2880: Module-level presigned URL cache. URLs are valid for hours (expires_in param);
# 3.5h outer TTL bounds memory and evicts long-lived entries eventually. Keyed on
# (r2_key, expires_in). timer=time.time: monotonic clock pauses during Fly.io machine
# suspension, causing expired URLs to be served from cache after wake-up.
# T7380: the outer TTL alone is NOT sufficient to guarantee freshness -- it only bounds
# the OLDEST an entry can be, not whether a given entry's own `expires_in` has already
# elapsed. A caller passing expires_in SHORTER than the outer ttl (e.g. poster.py's
# expires_in=3600 against this cache's 12600s ttl) would otherwise get an
# already-R2-expired URL served back for the remaining window, causing real 403s.
# Values are (url, expires_at) so every read validates the URL's OWN signature window,
# never just the cache's.
_PRESIGNED_URL_CACHE: TTLCache = TTLCache(maxsize=1000, ttl=12600, timer=time.time)
_PRESIGNED_URL_CACHE_LOCK = threading.Lock()
# Regenerate this many seconds before the actual R2 expiry so a URL handed to a caller
# doesn't expire mid-use (e.g. an ffmpeg process that opens it a few seconds later).
_PRESIGNED_URL_EXPIRY_SAFETY_MARGIN_SEC = 30

# T1539: Per-user, per-db-type upload locks. Prevents concurrent PutObject on
# the same R2 key from different code paths (middleware sync vs export worker
# vs shutdown sync). threading.Lock because callers run on different thread
# types (asyncio executor threads, background task threads, main thread).
_USER_UPLOAD_LOCKS: dict[str, threading.Lock] = {}
_USER_UPLOAD_LOCKS_GUARD = threading.Lock()
UPLOAD_LOCK_WAIT_LOG_MS = 50  # log when upload waited longer than this for the lock


def get_upload_lock(user_id: str, db_type: str) -> threading.Lock:
    """Return the per-(user, db_type) upload lock, creating on first access."""
    lock_key = f"{user_id}:{db_type}"
    with _USER_UPLOAD_LOCKS_GUARD:
        lock = _USER_UPLOAD_LOCKS.get(lock_key)
        if lock is None:
            lock = threading.Lock()
            _USER_UPLOAD_LOCKS[lock_key] = lock
        return lock


# T6402: the highest sync version THIS PROCESS has successfully PUT for each R2
# key. A version we uploaded ourselves can never be the "another writer moved R2
# ahead" case CAS exists to catch — those bytes came from this same local file —
# so a caller still holding a pre-upload baseline must not be refused against it.
# Written under the same upload lock as the PUT, so a sync that waited on the lock
# observes its predecessor's version (the caller's set_local_db_version happens
# AFTER the primitive returns, i.e. outside the lock — which is exactly why the
# baseline alone cannot close this race). Grows one entry per R2 key, same
# unbounded-by-user shape as _USER_UPLOAD_LOCKS above.
_OWN_UPLOAD_VERSIONS: dict[str, int] = {}
_OWN_UPLOAD_VERSIONS_GUARD = threading.Lock()


def _is_own_upload_version(key: str, r2_version: int) -> bool:
    """True iff R2 currently sits at the exact version THIS PROCESS last PUT there.

    Deliberately an equality test, not a range: it forgives only "R2 is where we
    ourselves put it", never "R2 is somewhere at or below our high-water mark".
    Any foreign write lands strictly ABOVE our own version and so still conflicts.
    The baseline is NOT modified — new_version arithmetic is unchanged for every
    caller — and an unconfirmed (None) baseline is never rescued by this.
    """
    with _OWN_UPLOAD_VERSIONS_GUARD:
        return _OWN_UPLOAD_VERSIONS.get(key) == r2_version


def _record_own_upload(key: str, version: int) -> None:
    """Remember a version we just PUT. Call while holding the upload lock."""
    with _OWN_UPLOAD_VERSIONS_GUARD:
        if version > _OWN_UPLOAD_VERSIONS.get(key, -1):
            _OWN_UPLOAD_VERSIONS[key] = version


class R2VersionResult(Enum):
    """Distinguishes 'not found' (genuinely new user) from 'error' (transient failure)."""
    NOT_FOUND = "not_found"
    ERROR = "error"


# Environment prefix for R2 paths (dev | staging | prod)
APP_ENV = os.getenv("APP_ENV", "dev")

# Check if R2 is enabled
R2_ENABLED = os.getenv("R2_ENABLED", "false").lower() == "true"
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")

# T4310: identifies which machine refused a CAS conflict, for the CRITICAL log.
FLY_MACHINE_ID = os.getenv("FLY_MACHINE_ID", "")


def _db_writer_metadata() -> dict:
    """T6390: writer identity stamped next to db-version on EVERY DB upload, so a
    later CAS conflict can name WHO moved R2 ahead — read from the HEAD that already
    runs on the conflict path (zero extra R2 calls). `db-writer` = machine + req_id;
    `db-written-at` = UTC ISO timestamp. A missing req_id renders as '-' (honest),
    never a fabricated id."""
    from datetime import UTC, datetime

    from .user_context import get_current_req_id
    return {
        "db-writer": f"{FLY_MACHINE_ID or 'local'}/{get_current_req_id() or '-'}",
        "db-written-at": datetime.now(UTC).isoformat(),
    }


def _conflict_diag(reason: str, r2_metadata: dict) -> dict:
    """T6390: the R2-SIDE facts of a refused upload — the reason and the identity of
    the writer that moved R2 ahead (from the conflict HEAD's metadata). The
    request-side facts (db, profile_id, loaded, req_id, method, path) are merged in
    by the marker writer (database.py). `writer`/`written_at` are None for a legacy
    R2 object with no writer stamp — an honest 'unknown', NOT a fabricated default."""
    return {
        "reason": reason,
        "writer": r2_metadata.get("db-writer"),
        "written_at": r2_metadata.get("db-written-at"),
    }

# ---------------------------------------------------------------------------
# T4120: durability test seams (gated; PROD AND STAGING inert)
# ---------------------------------------------------------------------------
# A /dotask container worker self-verifies the durable-export boundary (T4110)
# by forcing R2 sync to fail mid-run, then clearing it — all in one process.
# Every seam funnels through ONE default-deny gate so it is impossible on prod
# AND staging (stricter than `!= production`, mirroring dev-login auth.py:897).

# Process-global override flipped by POST /api/test/sync-fault. None = unset
# (fall back to the static env var). Lets a spec force -> clear in one process.
_force_sync_failure_override: bool | None = None
_force_sync_failure_lock = threading.Lock()


def _test_seams_enabled() -> bool:
    """True only in dev/development/local/test — never production/prod/staging.

    Single gate for ALL test seams (sync-fault, machine-cycle, force-sync-failure).
    Default-deny: any unrecognized APP_ENV is treated as non-dev and returns False
    is NOT used here — we allowlist the safe envs explicitly so a typo never opens
    the seam on a shared environment.
    """
    return APP_ENV in ("dev", "development", "local", "test")


def set_force_r2_sync_failure(enabled: bool | None) -> None:
    """Set/clear the runtime FORCE_R2_SYNC_FAILURE override (test seam only)."""
    global _force_sync_failure_override
    with _force_sync_failure_lock:
        _force_sync_failure_override = enabled


def _force_r2_sync_failure() -> bool:
    """Whether R2 sync should be force-failed (test seam). Inert unless enabled.

    Order: (1) the gate — if seams are disabled (prod/staging), ALWAYS False so the
    real sync runs even if FORCE_R2_SYNC_FAILURE=1 leaked into the env; (2) the
    process-global runtime override (set by /api/test/sync-fault); (3) the static
    FORCE_R2_SYNC_FAILURE env var as the default.
    """
    if not _test_seams_enabled():
        return False
    with _force_sync_failure_lock:
        if _force_sync_failure_override is not None:
            return _force_sync_failure_override
    return os.getenv("FORCE_R2_SYNC_FAILURE", "").lower() in ("1", "true", "yes")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "reel-ballers-users")


def _register_r2_timing(client, label: str):
    """Register botocore event hooks to log per-S3-operation wall time.

    Emits `[R2_CALL] client=<label> op=<op> status=<code> elapsed_ms=<n>` for
    every S3 call. Captures retry-sleep latency (elapsed spans retries) so a
    single slow op shows up as one long line, not many short ones.

    T1531/T1530: this is the building block that attributes R2 time at the
    operation level rather than requiring a cProfile dump.
    """
    def _before(context, **kwargs):
        context["_r2_t0"] = time.perf_counter()

    def _after(context, model=None, http_response=None, parsed=None, **kwargs):
        t0 = context.get("_r2_t0")
        if t0 is None:
            return
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        op = getattr(model, "name", "?")
        status = getattr(http_response, "status_code", "?")
        try:
            from .user_context import get_current_req_id
            req_id = get_current_req_id()
        except Exception:
            req_id = ""
        suffix = f" req_id={req_id}" if req_id else ""
        logger.info(f"[R2_CALL] client={label} op={op} status={status} elapsed_ms={elapsed_ms:.0f}{suffix}")

    client.meta.events.register("before-call.s3", _before)
    client.meta.events.register("after-call.s3", _after)


@lru_cache(maxsize=1)
def get_r2_client():
    """Get boto3 S3 client configured for R2. Cached for reuse."""
    if not R2_ENABLED:
        return None

    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                max_pool_connections=25,  # 10 for upload threads + 15 headroom
                connect_timeout=5,
                read_timeout=30,
                retries={"max_attempts": 0},
            ),
            region_name="auto"
        )
        _register_r2_timing(client, "default")
        logger.info(f"R2 client initialized for bucket: {R2_BUCKET}")
        return client
    except ImportError:
        logger.warning("boto3 not installed, R2 disabled")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 client: {e}")
        return None


@lru_cache(maxsize=1)
def get_r2_sync_client():
    """Get boto3 S3 client with short timeouts for database sync.

    Database sync runs in the middleware request path — long timeouts
    block the HTTP response. This client fails fast (3s connect, 10s read)
    so the user sees sync failure quickly instead of waiting 20s+.
    """
    if not R2_ENABLED:
        return None

    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=3,
                read_timeout=10,
                retries={"max_attempts": 0},
            ),
            region_name="auto"
        )
        _register_r2_timing(client, "sync")
        return client
    except ImportError:
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 sync client: {e}")
        return None


@lru_cache(maxsize=1)
def get_r2_transfer_client():
    """Get boto3 S3 client optimized for large file transfers.

    Uses a larger connection pool and longer read timeout for operations
    like download_from_r2_global and multipart uploads that transfer
    large video files (1GB+).
    """
    if not R2_ENABLED:
        return None

    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                max_pool_connections=20,
                read_timeout=120,
            ),
            region_name="auto"
        )
        _register_r2_timing(client, "transfer")
        return client
    except ImportError:
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 transfer client: {e}")
        return None


def r2_key(user_id: str, path: str) -> str:
    """Generate R2 object key for user profile data.

    Format: {env}/users/{user_id}/profiles/{profile_id}/{path}
    """
    from .profile_context import get_current_profile_id
    profile_id = get_current_profile_id()
    # Normalize path separators for R2
    path = path.replace("\\", "/")
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}"


def r2_user_prefix(user_id: str) -> str:
    """Return the R2 key prefix for a user+profile.

    Format: {env}/users/{user_id}/profiles/{profile_id}

    Use this when passing the user's R2 "folder" to external services
    (e.g., Modal) that prepend it to relative paths like
    "final_videos/xxx.mp4".
    """
    from .profile_context import get_current_profile_id
    profile_id = get_current_profile_id()
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}"


def download_from_r2(user_id: str, relative_path: str, local_path: Path, progress_callback=None,
                     profile_id: str | None = None) -> bool:
    """
    Download a file from R2 to local filesystem.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Local path to save the file
        progress_callback: Optional callback(bytes_transferred) for download progress
        profile_id: If given, key the object under THIS profile (arg, not the
            ContextVar). Required for background/cross-profile callers where the
            ContextVar is dead or points at a different profile (T5340). When None,
            falls back to the request-scoped ContextVar via r2_key().

    Returns:
        True if download succeeded, False otherwise
    """
    from .utils.retry import TIER_1, retry_r2_call

    client = get_r2_client()
    if not client:
        return False

    key = profile_r2_key(user_id, profile_id, relative_path) if profile_id else r2_key(user_id, relative_path)
    try:
        # Ensure parent directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # Use callback if provided for progress tracking
        if progress_callback:
            retry_r2_call(
                client.download_file, R2_BUCKET, key, str(local_path),
                Callback=progress_callback, operation=f"download {key}", **TIER_1,
            )
        else:
            retry_r2_call(
                client.download_file, R2_BUCKET, key, str(local_path),
                operation=f"download {key}", **TIER_1,
            )
        logger.debug(f"Downloaded from R2: {key} -> {local_path}")
        return True
    except client.exceptions.NoSuchKey:
        logger.debug(f"File not found in R2: {key}")
        return False
    except Exception as e:
        logger.error(f"Failed to download from R2: {key} - {e}")
        return False


def get_r2_file_size(user_id: str, relative_path: str) -> int | None:
    """
    Get the size of a file in R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/

    Returns:
        File size in bytes, or None if file not found or error
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        from .utils.retry import TIER_2, retry_r2_call
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"head {key}", **TIER_2,
        )
        return response.get('ContentLength')
    except Exception as e:
        logger.debug(f"Could not get file size from R2: {key} - {e}")
        return None


async def download_from_r2_with_progress(
    user_id: str,
    relative_path: str,
    local_path: Path,
    export_id: str,
    export_type: str,
    project_id: int | None = None,
    project_name: str | None = None,
    progress_start: int = 5,
    progress_end: int = 15,
    global_path: bool = False,
) -> bool:
    """
    Download a file from R2 with WebSocket progress updates.

    DRY helper for annotate, framing, and overlay exports.
    Sends progress updates during download matching Modal's pattern.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/ (or global if global_path=True)
        local_path: Local path to save the file
        export_id: Export ID for WebSocket progress
        export_type: 'annotate', 'framing', or 'overlay'
        project_id: Optional project ID for progress data
        project_name: Optional project name for progress data
        progress_start: Starting progress percentage (default 5%)
        progress_end: Ending progress percentage (default 15%)
        global_path: If True, relative_path is used as-is (no user_id prefix)

    Returns:
        True if download succeeded, False otherwise
    """
    import asyncio

    from app.websocket import manager

    # Get file size for progress calculation
    if global_path:
        total_size = get_r2_file_size_global(relative_path)
    else:
        total_size = get_r2_file_size(user_id, relative_path)

    # Send initial progress
    progress_data = {
        'progress': progress_start,
        'message': 'Downloading source video...',
        'phase': 'downloading',
        'status': 'processing',
        'type': export_type
    }
    if project_id is not None:
        progress_data['projectId'] = project_id
    if project_name is not None:
        progress_data['projectName'] = project_name

    await manager.send_progress(export_id, progress_data)

    # Download with progress callback
    if total_size and total_size > 0:
        downloaded_bytes = [0]
        last_progress_sent = [progress_start]
        loop = asyncio.get_running_loop()

        def download_callback(bytes_transferred):
            downloaded_bytes[0] += bytes_transferred
            # Calculate progress within our range
            download_fraction = min(downloaded_bytes[0] / total_size, 1.0)
            current_progress = int(progress_start + download_fraction * (progress_end - progress_start))

            # Send update every 2% or more
            if current_progress >= last_progress_sent[0] + 2:
                last_progress_sent[0] = current_progress
                mb_downloaded = downloaded_bytes[0] / (1024 * 1024)
                try:
                    asyncio.run_coroutine_threadsafe(
                        manager.send_progress(export_id, {
                            'progress': current_progress,
                            'message': f'Downloading... ({mb_downloaded:.0f} MB)',
                            'phase': 'downloading',
                            'status': 'processing',
                            'type': export_type,
                            **({"projectId": project_id} if project_id else {}),
                            **({"projectName": project_name} if project_name else {}),
                        }),
                        loop
                    )
                except Exception:
                    pass

        # Run sync download in thread pool
        if global_path:
            success = await asyncio.to_thread(
                download_from_r2_global, relative_path, local_path, download_callback
            )
        else:
            success = await asyncio.to_thread(
                download_from_r2, user_id, relative_path, local_path, download_callback
            )
    else:
        # No file size available - just do simple download
        if global_path:
            success = await asyncio.to_thread(
                download_from_r2_global, relative_path, local_path
            )
        else:
            success = await asyncio.to_thread(
                download_from_r2, user_id, relative_path, local_path
            )

    if success:
        # Send download complete
        complete_data = {
            'progress': progress_end,
            'message': 'Download complete',
            'phase': 'downloading',
            'status': 'processing',
            'type': export_type
        }
        if project_id is not None:
            complete_data['projectId'] = project_id
        if project_name is not None:
            complete_data['projectName'] = project_name
        await manager.send_progress(export_id, complete_data)

    return success


def _probe_local_mp4_moov(local_path: Path) -> tuple[str, list[str]]:
    """
    Pre-upload moov placement check for MP4 files.

    Reads the first 256 bytes and walks top-level boxes to find moov/mdat/moof.
    Returns (verdict, box_list) where verdict is 'FASTSTART', 'MOOV-AT-END',
    or 'UNKNOWN'. Cheap (~256 bytes, no subprocess).
    """
    try:
        with open(local_path, "rb") as f:
            buf = f.read(256)
    except Exception:
        return "UNKNOWN", []
    boxes = []
    offset = 0
    while offset + 8 <= len(buf) and len(boxes) < 6:
        size = int.from_bytes(buf[offset:offset + 4], "big")
        btype = buf[offset + 4:offset + 8].decode("ascii", errors="replace")
        if size == 1:
            if offset + 16 > len(buf):
                break
            size = int.from_bytes(buf[offset + 8:offset + 16], "big")
        if size < 8:
            break
        boxes.append(f"{btype}@{offset}")
        if btype == "moov":
            return "FASTSTART", boxes
        if btype in ("mdat", "moof"):
            return "MOOV-AT-END", boxes
        offset += size
    return "UNKNOWN", boxes


def upload_to_r2(user_id: str, relative_path: str, local_path: Path) -> bool:
    """
    Upload a file from local filesystem to R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Local path of the file to upload

    Returns:
        True if upload succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)

    if relative_path.startswith("working_videos/") and relative_path.endswith(".mp4"):
        verdict, boxes = _probe_local_mp4_moov(local_path)
        head = " ".join(boxes[:4]) if boxes else "-"
        if verdict == "MOOV-AT-END":
            logger.error(
                f"[FaststartCheck] pre-upload verdict=MOOV-AT-END key={key} head=[{head}] "
                f"— this file will cause slow browser loads. Fix the producer to emit +faststart."
            )
        else:
            logger.info(f"[FaststartCheck] pre-upload verdict={verdict} key={key} head=[{head}]")

    try:
        from .utils.retry import TIER_1, retry_r2_call
        retry_r2_call(
            client.upload_file, str(local_path), R2_BUCKET, key,
            operation=f"upload {key}", **TIER_1,
        )
        logger.debug(f"Uploaded to R2: {local_path} -> {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload to R2: {local_path} - {e}")
        return False


def upload_bytes_to_r2(
    user_id: str,
    relative_path: str,
    data: bytes,
    *,
    fast: bool = False,
    content_type: str | None = None,
    metadata: dict | None = None,
) -> bool:
    """
    Upload bytes directly to R2 without writing to disk.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        data: Bytes to upload
        fast: Use the sync client (short timeouts). Use for small payloads (<1MB)
              where a 30s stall on a cold connection is unacceptable.
        content_type: Optional Content-Type stored on the object (e.g. image/jpeg)
              so a browser/crawler fetch serves the right MIME.
        metadata: Optional small string map stored as object user-metadata
              (x-amz-meta-*); returned by HEAD. Values are coerced to str.

    Returns:
        True if upload succeeded, False otherwise
    """
    from io import BytesIO

    client = get_r2_sync_client() if fast else get_r2_client()
    if not client:
        logger.error(f"R2 client unavailable (fast={fast}) - cannot upload bytes to {relative_path}")
        return False

    key = r2_key(user_id, relative_path)

    if relative_path.startswith("working_videos/") and relative_path.endswith(".mp4"):
        # Same moov probe as upload_to_r2 but operating on in-memory bytes.
        buf = data[:256]
        boxes = []
        offset = 0
        verdict = "UNKNOWN"
        while offset + 8 <= len(buf) and len(boxes) < 6:
            size = int.from_bytes(buf[offset:offset + 4], "big")
            btype = buf[offset + 4:offset + 8].decode("ascii", errors="replace")
            if size == 1:
                if offset + 16 > len(buf):
                    break
                size = int.from_bytes(buf[offset + 8:offset + 16], "big")
            if size < 8:
                break
            boxes.append(f"{btype}@{offset}")
            if btype == "moov":
                verdict = "FASTSTART"
                break
            if btype in ("mdat", "moof"):
                verdict = "MOOV-AT-END"
                break
            offset += size
        head = " ".join(boxes[:4]) if boxes else "-"
        if verdict == "MOOV-AT-END":
            logger.error(
                f"[FaststartCheck] pre-upload verdict=MOOV-AT-END key={key} head=[{head}] "
                f"— this file will cause slow browser loads. Fix the producer to emit +faststart."
            )
        else:
            logger.info(f"[FaststartCheck] pre-upload verdict={verdict} key={key} head=[{head}]")

    try:
        from .utils.retry import TIER_1, retry_r2_call

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        if metadata:
            extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}

        def _upload():
            client.upload_fileobj(BytesIO(data), R2_BUCKET, key, ExtraArgs=extra_args)

        retry_r2_call(_upload, operation=f"upload_bytes {key}", **TIER_1)
        logger.debug(f"Uploaded bytes to R2: {key} ({len(data)} bytes)")
        return True
    except Exception as e:
        logger.error(
            f"Failed to upload bytes to R2: {key} ({len(data)} bytes, fast={fast}) - "
            f"{type(e).__name__}: {e}", exc_info=True,
        )
        return False


def upload_bytes_to_r2_global(
    key: str,
    data: bytes,
    *,
    fast: bool = False,
    content_type: str | None = None,
    metadata: dict | None = None,
    cache_control: str | None = None,
) -> bool:
    """Upload bytes to a FULL (env-prefixed) R2 key, not a user-scoped path.

    Mirrors upload_bytes_to_r2 but takes the complete object key (the same key
    space as r2_head_object_global / generate_presigned_url_global). Used to write
    objects under another profile's prefix from an unauthenticated context (e.g.
    the recap poster cache at
    `{env}/users/{sharer}/profiles/{profile}/recaps/posters/{game_id}.jpg`, T5180)
    where the request's ContextVar profile is NOT the object owner. Returns True
    on success, False otherwise (never raises)."""
    from io import BytesIO

    client = get_r2_sync_client() if fast else get_r2_client()
    if not client:
        logger.error(f"R2 client unavailable (fast={fast}) - cannot upload bytes to {key}")
        return False

    try:
        from .utils.retry import TIER_1, retry_r2_call

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        if metadata:
            extra_args["Metadata"] = {k: str(v) for k, v in metadata.items()}
        if cache_control:
            # Stored on the object and served on every GET (R2/S3 semantics) —
            # without it a presigned GET has NO Cache-Control and browsers fall
            # back to heuristic freshness (10% of the object's age), which for
            # a just-uploaded object means "stale immediately".
            extra_args["CacheControl"] = cache_control

        def _upload():
            client.upload_fileobj(BytesIO(data), R2_BUCKET, key, ExtraArgs=extra_args)

        retry_r2_call(_upload, operation=f"upload_bytes_global {key}", **TIER_1)
        logger.debug(f"Uploaded bytes to R2 (global): {key} ({len(data)} bytes)")
        return True
    except Exception as e:
        logger.error(
            f"Failed to upload bytes to R2 (global): {key} ({len(data)} bytes, "
            f"fast={fast}) - {type(e).__name__}: {e}", exc_info=True,
        )
        return False


def delete_from_r2(user_id: str, relative_path: str) -> bool:
    """
    Delete a file from R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/

    Returns:
        True if delete succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        from .utils.retry import TIER_3, retry_r2_call
        retry_r2_call(
            client.delete_object, Bucket=R2_BUCKET, Key=key,
            operation=f"delete {key}", **TIER_3,
        )
        logger.debug(f"Deleted from R2: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete from R2: {key} - {e}")
        return False


async def copy_file_in_r2(user_id: str, source_path: str, dest_path: str) -> bool:
    """
    Copy a file within R2 (server-side copy, no download/upload).

    Args:
        user_id: User namespace
        source_path: Source path relative to user_data/<user_id>/
        dest_path: Destination path relative to user_data/<user_id>/

    Returns:
        True if copy succeeded, False otherwise
    """
    import asyncio

    client = get_r2_client()
    if not client:
        logger.error("R2 client not available for copy")
        return False

    source_key = r2_key(user_id, source_path)
    dest_key = r2_key(user_id, dest_path)

    try:
        from .utils.retry import TIER_3, retry_r2_call

        def do_copy():
            retry_r2_call(
                client.copy_object,
                Bucket=R2_BUCKET,
                CopySource={'Bucket': R2_BUCKET, 'Key': source_key},
                Key=dest_key,
                operation=f"copy {source_key}", **TIER_3,
            )

        await asyncio.to_thread(do_copy)
        logger.info(f"Copied in R2: {source_key} -> {dest_key}")
        return True
    except Exception as e:
        logger.error(f"Failed to copy in R2: {source_key} -> {dest_key} - {e}")
        return False


def profile_r2_key(user_id: str, profile_id: str, path: str) -> str:
    """Build an R2 object key for a SPECIFIC profile, bypassing the ContextVar.

    Same format as r2_key(): {env}/users/{user_id}/profiles/{profile_id}/{path}.
    Use for CROSS-PROFILE operations (e.g. T4850 reel move) where the object lives
    under a profile that is NOT the current request profile. R2 media artifacts are
    PER-PROFILE (r2_key embeds profile_id), so a same-user move must relocate the
    object between the two profile prefixes — the sqlite row alone is not enough.
    """
    path = path.replace("\\", "/")
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}"


def copy_profile_object(user_id: str, source_profile_id: str,
                        target_profile_id: str, relative_path: str) -> bool:
    """Server-side copy a per-profile R2 object from one profile prefix to another
    (same user, same bucket — no download/upload). Returns True on success, or True
    if R2 is disabled (nothing to relocate). False on any failure (caller aborts)."""
    if not R2_ENABLED:
        return True
    client = get_r2_client()
    if not client:
        logger.error("[copy_profile_object] R2 client not available")
        return False

    source_key = profile_r2_key(user_id, source_profile_id, relative_path)
    dest_key = profile_r2_key(user_id, target_profile_id, relative_path)
    try:
        from .utils.retry import TIER_3, retry_r2_call
        retry_r2_call(
            client.copy_object,
            Bucket=R2_BUCKET,
            CopySource={'Bucket': R2_BUCKET, 'Key': source_key},
            Key=dest_key,
            operation=f"copy_profile {source_key} -> {dest_key}", **TIER_3,
        )
        logger.info(f"[copy_profile_object] {source_key} -> {dest_key}")
        return True
    except Exception as e:
        logger.error(f"[copy_profile_object] FAILED {source_key} -> {dest_key} - {e}")
        return False


def delete_profile_object(user_id: str, profile_id: str, relative_path: str) -> bool:
    """Delete a per-profile R2 object under a SPECIFIC profile prefix (bypasses the
    ContextVar). Returns True on success or if R2 disabled; False on failure."""
    if not R2_ENABLED:
        return True
    key = profile_r2_key(user_id, profile_id, relative_path)
    return r2_delete_object_global(key)


def profile_object_exists(user_id: str, profile_id: str, relative_path: str) -> bool:
    """HEAD a per-profile R2 object under a SPECIFIC profile prefix. False if R2
    disabled. Used to verify a moved reel's media resolves under the target prefix."""
    if not R2_ENABLED:
        return False
    key = profile_r2_key(user_id, profile_id, relative_path)
    return r2_head_object_global(key) is not None


def file_exists_in_r2(user_id: str, relative_path: str) -> bool:
    """Check if a file exists in R2."""
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        from .utils.retry import TIER_2, retry_r2_call
        retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"exists {key}", **TIER_2,
        )
        return True
    except Exception:
        return False


def r2_head_object(user_id: str, relative_path: str) -> dict | None:
    """HEAD a per-profile R2 object (current profile context) and return its
    ETag/size/metadata, or None if absent/R2-disabled (T5682).

    Used for conditional-request (If-None-Match) support: the caller can HEAD
    to get R2's own ETag (a body-free round trip) and compare against the
    client's cached ETag before deciding whether a full GET is needed."""
    client = get_r2_client()
    if not client:
        return None
    key = r2_key(user_id, relative_path)
    try:
        from .utils.retry import TIER_2, retry_r2_call
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"head {key}", **TIER_2,
        )
        return {
            'ETag': response.get('ETag'),
            'ContentLength': response.get('ContentLength'),
            'Metadata': response.get('Metadata', {}),
        }
    except Exception:
        return None


# T5682: shared pooled httpx client for poster-serving proxies (games/downloads/
# projects routers all fetch a presigned R2 URL to proxy poster bytes to the
# client). A fresh `httpx.AsyncClient()` per request pays a full TLS handshake to
# R2 every time (~300-600ms observed) -- the same landmine T4773 fixed for
# `working_video/stream` (export-pipeline.md). Module-level + keepalive avoids
# that tax on repeat requests.
_poster_r2_client = None


def get_poster_r2_client():
    """Pooled httpx.AsyncClient for proxying poster JPEGs from a presigned R2
    URL (T5682). Reused across requests -- TLS handshake happens once, not per
    request. Timeouts sized for a small (~25-80KB) JPEG fetch."""
    import httpx
    global _poster_r2_client
    if _poster_r2_client is None or _poster_r2_client.is_closed:
        _poster_r2_client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            limits=httpx.Limits(max_keepalive_connections=24, keepalive_expiry=30.0),
        )
    return _poster_r2_client


# Thread-local storage for tracking database version and writes per request
_request_context = threading.local()


def get_db_version_from_r2(user_id: str, client=None,
                           profile_id: str | None = None,
                           return_metadata: bool = False):
    """
    Get the version number of the database in R2.

    Version is stored as custom metadata 'x-amz-meta-db-version'.
    Returns:
        int: version number (0 for legacy uploads without metadata)
        R2VersionResult.NOT_FOUND: file doesn't exist (genuinely new user)
        R2VersionResult.ERROR: R2 disabled, unreachable, or other transient failure

    Args:
        user_id: User namespace
        client: Optional boto3 client override (e.g. fast-timeout sync client)
        profile_id: If given, HEAD the object under THIS profile (arg, not the
            ContextVar) — see download_from_r2 (T5340). When None, uses r2_key().
        return_metadata: T6390 — when True, return a (result, metadata) tuple so a
            conflict path can read the WINNER's writer identity (db-writer /
            db-written-at) from the SAME HEAD that decided the conflict, at zero
            extra R2 calls. `metadata` is `{}` on any error/not-found. Default False
            keeps the existing int|R2VersionResult return for every other caller.
    """
    def _ret(result, metadata):
        return (result, metadata) if return_metadata else result

    if client is None:
        client = get_r2_client()
    if not client:
        return _ret(R2VersionResult.ERROR, {})  # No client = can't check

    key = profile_r2_key(user_id, profile_id, "profile.sqlite") if profile_id else r2_key(user_id, "profile.sqlite")
    t0 = time.perf_counter() if PROFILING_ENABLED else 0
    try:
        from .utils.retry import TIER_2, retry_r2_call
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"db_version {user_id}", **TIER_2,
        )
        metadata = response.get("Metadata", {})
        version_str = metadata.get("db-version")
        result = int(version_str) if version_str else 0
        if PROFILING_ENABLED:
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"[PROFILE] get_db_version_from_r2: {elapsed:.0f}ms")
        return _ret(result, metadata)
    except client.exceptions.ClientError as e:
        if PROFILING_ENABLED:
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"[PROFILE] get_db_version_from_r2: {elapsed:.0f}ms (error)")
        if e.response['Error']['Code'] == '404':
            return _ret(R2VersionResult.NOT_FOUND, {})
        logger.error(f"Failed to get DB version from R2: {e}")
        return _ret(R2VersionResult.ERROR, {})
    except Exception as e:
        if PROFILING_ENABLED:
            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(f"[PROFILE] get_db_version_from_r2: {elapsed:.0f}ms (error)")
        logger.error(f"Failed to get DB version from R2: {e}")
        return _ret(R2VersionResult.ERROR, {})


def sync_database_from_r2_if_newer(
    user_id: str,
    local_db_path: Path,
    local_version: int | None,
    before_download=None,
) -> tuple[bool, int | None, bool]:
    """
    Download the user's database from R2 only if R2 version is newer.

    Args:
        user_id: User namespace
        local_db_path: Local path for the database file
        local_version: Current local version (None if no local DB)
        before_download: Optional zero-arg callable consulted ONLY once a
            download has actually been decided (R2 is confirmed newer) --
            NOT on every call. Return True to proceed, False to abort (the
            call reports as an error/refusal, same as a download failure).
            T4315 round 3 (BLOCKING NEW-B): callers that need a WAL-in-use
            guard must gate the DOWNLOAD, not the version check itself --
            gating the check refuses even when nothing needed downloading
            (the overwhelmingly common "already current" case).

    Returns:
        Tuple of (was_downloaded, new_version, was_error)
        - (True, version, False) if downloaded newer version
        - (False, local_version, False) if local is current or newer
        - (False, None, False) if NOT_FOUND (genuinely new user)
        - (False, None, True) if ERROR (transient failure, should retry)
        - (False, local_version, True) if before_download refused
    """
    if not R2_ENABLED:
        return False, local_version, False

    r2_result = get_db_version_from_r2(user_id)

    if r2_result == R2VersionResult.NOT_FOUND:
        logger.debug(f"No database in R2 for user: {user_id}")
        return False, None, False

    if r2_result == R2VersionResult.ERROR:
        logger.debug(f"R2 error checking database version for user: {user_id}")
        return False, None, True

    r2_version = r2_result  # It's an int

    # If local version is same or newer, no need to download
    if local_version is not None and local_version >= r2_version:
        logger.debug(f"Local DB version {local_version} >= R2 version {r2_version}, skipping download")
        return False, local_version, False

    if before_download is not None and not before_download():
        logger.warning(f"[T4315] before_download refused the swap for user: {user_id}")
        return False, local_version, True

    # Download the newer version
    if download_from_r2(user_id, "profile.sqlite", local_db_path):
        logger.info(f"Downloaded DB from R2: version {r2_version} (was {local_version})")
        return True, r2_version, False

    return False, local_version, True  # Download failed


def _checkpoint_wal_or_refuse(local_db_path: Path, user_id: str) -> bool:
    """Flush the -wal sidecar into the main SQLite file before it is uploaded to
    R2. Returns True if the main file is now current (safe to upload), False if
    the WAL could NOT be checkpointed because another connection holds the DB
    open with an active read snapshot / transaction (busy), OR because the local
    DB could not be opened as SQLite at all — in either case the caller MUST
    refuse the upload (T5920).

    Why this is the whole fix, not a formality: every R2 sync uploads the MAIN
    FILE ONLY (`client.upload_file` on `local_db_path`). In WAL mode a committed
    transaction lives in `<db>-wal` until a checkpoint, and SQLite auto-
    checkpoints only on last-connection-close. If any other connection is open
    when the sync runs, the upload ships pre-commit bytes — and the version
    metadata is bumped anyway. That is worse than not syncing: every downstream
    guard (T4315 restore-if-newer, T4310 CAS, Postgres "materialized" marks) then
    trusts the stale-content-newer-version copy and the write is silently lost.

    The landmine: `PRAGMA wal_checkpoint(TRUNCATE)` does NOT raise on contention.
    It returns (busy, log, checkpointed); busy=1 means it did nothing and left
    the frames in the WAL. So we READ the busy flag and refuse on it — an
    unchecked checkpoint is a silent no-op (reproduced end-to-end in the T4315
    round-4 review: an uploaded object with 0 games at a bumped db-version).

    A short, own busy_timeout (2000ms) is set explicitly so we never inherit the
    30000ms default of `_open_profile_db`/`get_db_connection` and stall a request
    or worker for 30s per attempt (T4315 measured ~150s for a 5-recipient share).
    Generalized from the `materialize_game_share` reference (T4315).

    T5920 round 2 — design decision (b): if `local_db_path` cannot be OPENED as a
    SQLite database (absent-but-exists()-races, a corrupt/non-DB blob, a bad
    path), we do NOT let `sqlite3.OperationalError` propagate out of the sync
    primitive. Doing so would be a NEW failure mode: request-thread callers
    (middleware `_background_sync`, the export/reels paths) that previously got a
    clean `(bool, version)` tuple would instead take an exception and turn a
    handled failure into a 500. Instead we map it onto the SAME 3-state contract a
    busy checkpoint uses — refuse (retryable `SyncResult.FAILED`), no new sync
    state. Per CLAUDE.md "No silent fallbacks for internal data", an unopenable
    local DB during a sync is an INTERNAL bug, so it is logged LOUDLY (ERROR with
    path + user id) under a DISTINCT marker from the busy case: an absent/corrupt
    DB and a contended checkpoint are different problems and must read differently
    in the logs.
    """
    try:
        conn = sqlite3.connect(str(local_db_path))
    except sqlite3.Error as e:
        logger.error(
            f"[SYNC_CHECKPOINT_OPEN_FAILED] user={user_id} {local_db_path} — cannot open "
            f"local DB as SQLite, REFUSING upload (retryable): {e} machine={FLY_MACHINE_ID}"
        )
        return False
    try:
        # Fail fast: refuse after ≤2s of contention, not the inherited 30s.
        conn.execute("PRAGMA busy_timeout=2000")
        busy, _log, _ckpt = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            logger.critical(
                f"[SYNC_CHECKPOINT_BUSY] user={user_id} {local_db_path} — WAL in use, REFUSING upload "
                f"(would ship under-checkpointed bytes at a bumped version) "
                f"machine={FLY_MACHINE_ID}"
            )
            return False
        return True
    except Exception as e:
        # Unknown checkpoint state -> refuse (retryable) rather than risk a stale
        # upload. Never a bare fallback that proceeds to upload anyway.
        logger.error(f"[SYNC_CHECKPOINT] user={user_id} error checkpointing {local_db_path}: {e}")
        return False
    finally:
        conn.close()


def sync_database_to_r2_with_version(
    user_id: str,
    local_db_path: Path,
    current_version: int | None,
    skip_version_check: bool = False,
    lock_timeout: float | None = None,
    profile_id: str | None = None,
    with_diag: bool = False,
):
    """
    Upload the user's database to R2 with version metadata.

    Uses optimistic locking - checks that R2 version hasn't changed since we loaded.

    Args:
        user_id: User namespace
        local_db_path: Local path of the database file
        current_version: Version we loaded from (for conflict detection)
        skip_version_check: If True, skip the HEAD call and use current_version directly.
            Safe when version is tracked in-memory and no multi-device writes expected.
        profile_id: If given, the R2 object KEY is derived from THIS profile id (the
            arg), NOT get_current_profile_id() (the ContextVar). Background/cross-profile
            callers (export worker, shutdown sync, move-reels, migrations) MUST pass it —
            the ContextVar is dead or points at a different profile there, and keying off
            it uploads the right DB to the wrong profile's key (T5340). When None, the key
            comes from the request-scoped ContextVar via r2_key() (the request path only).
        with_diag: T6390 — when True, append a third element to the return tuple: a
            diag dict on a non-OK result (`reason` + the R2-side `writer`/`written_at`
            of whoever moved R2 ahead), or None on success. Default False preserves the
            2-tuple (success, new_version) every existing caller/test relies on.

    Returns:
        (success, new_version) — or (success, new_version, diag) when with_diag=True.
        - (True, new_version[, None]) if upload succeeded
        - (False, r2_version[, diag]) on a CAS conflict (reason stale/unconfirmed)
        - (False, None[, diag]) on any other failure (checkpoint_busy / upload_failed)
    """
    def _out(success, new_version, diag=None):
        return (success, new_version, diag) if with_diag else (success, new_version)

    # T4120/T5870: the FORCE_R2_SYNC_FAILURE seam faults the WHOLE process, so it
    # must also cover primitive-direct callers (retry_pending_sync's re-drain,
    # sync_db_to_cloud, the shutdown sync) — not only the *_explicit wrappers, or a
    # forced "R2 is down" test would see those paths quietly succeed against real R2.
    # Inert on prod/staging (gated by _seams_enabled()).
    if _force_r2_sync_failure():
        return _out(False, None, {"reason": "upload_failed"})

    if not R2_ENABLED:
        return _out(False, None, {"reason": "upload_failed"})

    if not local_db_path.exists():
        return _out(False, None, {"reason": "upload_failed"})

    # Use the fast-timeout sync client so network failures are detected
    # quickly (~3s) instead of blocking the HTTP response for 20s+
    client = get_r2_sync_client()
    if not client:
        return _out(False, None, {"reason": "upload_failed"})

    t_total = time.perf_counter() if PROFILING_ENABLED else 0
    head_ms = 0.0

    # T5340: explicit profile_id → key off the arg; else fall back to the ContextVar
    # (request path). Background/cross-profile callers MUST pass profile_id.
    key = profile_r2_key(user_id, profile_id, "profile.sqlite") if profile_id else r2_key(user_id, "profile.sqlite")

    # T6402: the CAS decision (baseline → HEAD → refuse) now runs INSIDE the same
    # per-user lock that serialises the PUT. It used to run entirely OUTSIDE it, so
    # two concurrent syncs of the SAME profile in one process interleaved:
    #     A: read baseline 2734 ......................... HEAD → 2735  REFUSE
    #     B: read baseline 2734 → HEAD 2734 → PUT 2735 → advance baseline
    # Both upload the SAME local file, so A's "stale" copy already contained B's
    # data — a false conflict against ITSELF that raised the "edits aren't saving"
    # banner and, via schedule_profile_db_reheal, forced a full profile.sqlite
    # re-download on the next request (staging 2026-08-03: machine == writer
    # machine, on a single-machine app). Holding the lock across the decision also
    # closes the other interleave, where both syncs HEAD the same version and PUT
    # the same new_version — a version collision other machines' CAS relies on.
    # T1539's per-key serialisation is unchanged: same lock, held a little longer.
    upload_lock = get_upload_lock(user_id, "profile")
    lock_wait_start = time.perf_counter()
    # T2720: optional timeout so middleware can bail out instead of blocking ~14s
    # behind the export worker's upload. Deliberately still ordered BEFORE the
    # HEAD, so a deferred sync costs zero R2 calls.
    if lock_timeout is not None:
        acquired = upload_lock.acquire(timeout=lock_timeout)
        if not acquired:
            logger.info(
                f"[SYNC] Upload lock busy >{lock_timeout}s, deferring "
                f"user={user_id} db=profile"
            )
            return _out(False, None, {"reason": "upload_failed"})
    else:
        upload_lock.acquire()
    try:
        lock_wait_ms = (time.perf_counter() - lock_wait_start) * 1000
        if lock_wait_ms >= UPLOAD_LOCK_WAIT_LOG_MS:
            logger.info(
                f"[UPLOAD_LOCK_WAIT] user={user_id} db=profile "
                f"waited_ms={int(lock_wait_ms)}"
            )
        return _sync_profile_db_locked(
            user_id, local_db_path, current_version, skip_version_check,
            profile_id, key, client, t_total, head_ms, _out,
        )
    finally:
        upload_lock.release()


def _sync_profile_db_locked(
    user_id, local_db_path, current_version, skip_version_check,
    profile_id, key, client, t_total, head_ms, _out,
):
    """The version decision + checkpoint + PUT, run while holding the upload lock.

    Split out only so the locked region reads as one unit (T6402); every branch
    below is byte-for-byte the pre-T6402 logic apart from the self-upload
    exemption in the conflict condition.
    """
    r2_metadata: dict = {}
    if skip_version_check:
        # Skip HEAD call — use in-memory version as base
        new_version = (current_version or 0) + 1
    else:
        # Check for conflicts (another request may have written)
        t_head = time.perf_counter() if PROFILING_ENABLED else 0
        # T6390: read the object's Metadata from the SAME HEAD so a conflict below can
        # name the writer that moved R2 ahead — no extra R2 call.
        r2_result, r2_metadata = get_db_version_from_r2(
            user_id, client=client, profile_id=profile_id, return_metadata=True)
        if PROFILING_ENABLED:
            head_ms = (time.perf_counter() - t_head) * 1000

        # Extract int version, treating NOT_FOUND/ERROR as 0
        if isinstance(r2_result, R2VersionResult):
            r2_version = 0
        else:
            r2_version = r2_result

        # If R2 has a newer version than what we loaded, we have a conflict.
        # T950: refuse instead of overwriting. T4310 reviewer round 2 (MAJOR-2):
        # this branch used to re-download the newer copy over local_db_path, but
        # every prod call site previously passed skip_version_check=True so it was
        # DEAD CODE — this task makes it live on the normal write path, where
        # profile.sqlite is journal_mode=WAL and _background_sync runs OUTSIDE the
        # per-user write lock (readers are lock-free too). Swapping the main DB
        # file here while a stale -wal from the OLD file sits beside it lets the
        # next connection recover unrelated frames onto the fresh file —
        # cross-DB page mixing. Refusing alone (no download) is safe and
        # sufficient: the baseline stays frozen at current_version (never
        # advanced on a refusal — see database.py/db_sync.py), so this same
        # conflict is detected and refused again on every subsequent attempt
        # until a real restore path (T4315) heals the local copy under the
        # write lock. r2_version is still returned so callers can mark the
        # conflict distinctly, but it must NEVER be used to advance the baseline.
        # T4315 (round 2, BLOCKING-2): current_version is None means this writer
        # never confirmed a baseline (e.g. a fresh-machine restore errored and
        # ensure_database still created an empty schema'd DB) -- if R2 already
        # holds real content (r2_version > 0), that is NOT "no conflict", it is
        # "unconfirmed": uploading here would be an empty/stale local DB force-
        # pushed over the user's real data with zero conflict signal (the
        # catastrophic variant CAS exists to prevent). Treat an unconfirmed
        # baseline against real R2 content the same as a stale one: refuse.
        # T6402: ...unless R2 sits at the exact version THIS PROCESS put there. Then
        # the writer that "moved R2 ahead" is us: those bytes came from this same
        # local file, so our copy cannot be behind them. Refusing here was a false
        # conflict against ourselves (staging 2026-08-03, machine == writer machine)
        # and cost a full profile.sqlite re-download via schedule_profile_db_reheal.
        # Bounded to equality, so a foreign writer — always strictly above our own
        # version — still refuses. An unconfirmed (None) baseline is never rescued.
        if (r2_version > 0 and (current_version is None or r2_version > current_version)
                and not (current_version is not None and _is_own_upload_version(key, r2_version))):
            # T6390: unconfirmed baseline (loaded=None, the T6340/T4315 class) vs a
            # genuinely stale one (loaded=vN, the T6160 class) are DIFFERENT bugs with
            # the same banner — discriminate here so the diag + log name which.
            reason = "unconfirmed_baseline" if current_version is None else "stale_baseline"
            from .user_context import get_current_method, get_current_path, get_current_req_id
            logger.critical(
                f"[SYNC_CONFLICT] user={user_id} profile={profile_id} "
                f"loaded=v{current_version} r2=v{r2_version} reason={reason} "
                f"writer={r2_metadata.get('db-writer') or 'unknown'} "
                f"machine={FLY_MACHINE_ID} req_id={get_current_req_id() or '-'} "
                f"method={get_current_method() or '-'} path={get_current_path() or '-'} "
                f"— NOT uploading, NOT re-downloading (WAL-unsafe swap off the write lock)"
            )
            return _out(False, r2_version, _conflict_diag(reason, r2_metadata))

        # Calculate new version
        new_version = (max(r2_version, current_version or 0)) + 1

    # T5920: checkpoint the WAL into the main file BEFORE uploading it. This
    # primitive uploads the main file only; without a confirmed checkpoint a
    # concurrent open connection leaves the recent commits in the -wal and we
    # would ship stale bytes at the bumped `new_version`. A busy checkpoint is a
    # loud, retryable FAILURE — return (False, None) so the caller maps it to
    # SyncResult.FAILED (NOT CONFLICT): the baseline is NOT advanced (we return
    # before the upload) and the .sync_pending marker survives, so the next write
    # retries via the existing failed-sync/Retry UX. Placed after new_version so
    # it also covers the skip_version_check=True request-thread callers.
    if not _checkpoint_wal_or_refuse(local_db_path, user_id):
        return _out(False, None, {"reason": "checkpoint_busy"})

    # T1539: the PutObject is serialized per user+key by the upload lock the
    # caller already holds around this whole region (T6402).
    t_upload = time.perf_counter() if PROFILING_ENABLED else 0
    try:
        from .utils.retry import TIER_1, retry_r2_call
        retry_r2_call(
            client.upload_file,
            str(local_db_path), R2_BUCKET, key,
            # T6390: stamp the writer identity next to db-version so a future
            # conflict can name who moved R2 ahead (read from the conflict HEAD).
            ExtraArgs={"Metadata": {"db-version": str(new_version), **_db_writer_metadata()}},
            operation=f"db_sync_upload {user_id}", **TIER_1,
        )
    except Exception as e:
        logger.error(f"Failed to upload DB to R2: {e}")
        return _out(False, None, {"reason": "upload_failed"})
    # T6402: record BEFORE releasing the lock, so a sync that waited on it sees
    # this version and does not mistake our own write for a foreign one.
    _record_own_upload(key, new_version)
    if PROFILING_ENABLED:
        upload_ms = (time.perf_counter() - t_upload) * 1000
        total_ms = (time.perf_counter() - t_total) * 1000
        logger.info(
            f"[PROFILE] sync_database_to_r2_with_version: {total_ms:.0f}ms "
            f"(head: {'skipped' if skip_version_check else f'{head_ms:.0f}ms'}, upload: {upload_ms:.0f}ms)"
        )
    logger.debug(f"Uploaded DB to R2: {user_id} version {new_version}")
    return _out(True, new_version, None)


# Legacy functions for backward compatibility
def sync_database_from_r2(user_id: str, local_db_path: Path) -> bool:
    """
    Download the user's database from R2 if it exists.
    DEPRECATED: Use sync_database_from_r2_if_newer for version-aware sync.

    Args:
        user_id: User namespace
        local_db_path: Local path for the database file

    Returns:
        True if database was synced from R2, False if using local
    """
    if not R2_ENABLED:
        return False

    return download_from_r2(user_id, "profile.sqlite", local_db_path)


def sync_database_to_r2(user_id: str, local_db_path: Path) -> bool:
    """
    Upload the user's database to R2.
    DEPRECATED: Use sync_database_to_r2_with_version for version-aware sync.

    Args:
        user_id: User namespace
        local_db_path: Local path of the database file

    Returns:
        True if upload succeeded, False otherwise
    """
    if not R2_ENABLED:
        return False

    if not local_db_path.exists():
        return False

    return upload_to_r2(user_id, "profile.sqlite", local_db_path)


# ---------------------------------------------------------------------------
# User.sqlite R2 sync (T920)
# ---------------------------------------------------------------------------

def _user_db_r2_key(user_id: str) -> str:
    """R2 object key for a user's user.sqlite."""
    return f"{APP_ENV}/users/{user_id}/user.sqlite"


def get_user_db_version_from_r2(user_id: str, client=None,
                                return_metadata: bool = False):
    """Get version number of user.sqlite in R2. Same pattern as get_db_version_from_r2.

    Returns:
        int: version number (0 for legacy uploads without metadata)
        R2VersionResult.NOT_FOUND: file doesn't exist (genuinely new user)
        R2VersionResult.ERROR: R2 disabled, unreachable, or other transient failure

    return_metadata: T6390 — when True, return (result, metadata); see
        get_db_version_from_r2. Default False keeps the plain return.
    """
    def _ret(result, metadata):
        return (result, metadata) if return_metadata else result

    if client is None:
        client = get_r2_client()
    if not client:
        return _ret(R2VersionResult.ERROR, {})

    key = _user_db_r2_key(user_id)
    try:
        from .utils.retry import TIER_2, retry_r2_call
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"user_db_version {user_id}", **TIER_2,
        )
        metadata = response.get("Metadata", {})
        version_str = metadata.get("db-version")
        return _ret(int(version_str) if version_str else 0, metadata)
    except client.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            return _ret(R2VersionResult.NOT_FOUND, {})
        logger.error(f"Failed to get user.sqlite version from R2: {e}")
        return _ret(R2VersionResult.ERROR, {})
    except Exception as e:
        logger.error(f"Failed to get user.sqlite version from R2: {e}")
        return _ret(R2VersionResult.ERROR, {})


def sync_user_db_from_r2_if_newer(
    user_id: str,
    local_db_path: Path,
    local_version: int | None,
    before_download=None,
) -> tuple[bool, int | None, bool]:
    """Download user.sqlite from R2 only if R2 version is newer.

    Args:
        before_download: see sync_database_from_r2_if_newer's docstring --
            same contract (consulted only once a download is decided, not
            on every call; False aborts and reports as a refusal).

    Returns:
        Tuple of (was_downloaded, new_version, was_error)
        - (True, version, False) if downloaded newer version
        - (False, local_version, False) if local is current or newer
        - (False, None, False) if NOT_FOUND (genuinely new user)
        - (False, None, True) if ERROR (transient failure, should retry)
        - (False, local_version, True) if before_download refused
    """
    if not R2_ENABLED:
        return False, local_version, False

    r2_result = get_user_db_version_from_r2(user_id)

    if r2_result == R2VersionResult.NOT_FOUND:
        return False, None, False

    if r2_result == R2VersionResult.ERROR:
        return False, None, True

    r2_version = r2_result  # It's an int

    if local_version is not None and local_version >= r2_version:
        return False, local_version, False

    if before_download is not None and not before_download():
        logger.warning(f"[T4315] before_download refused the swap for user.sqlite: {user_id}")
        return False, local_version, True

    # Download directly (not profile-scoped)
    client = get_r2_client()
    if not client:
        return False, None, True

    key = _user_db_r2_key(user_id)
    try:
        from .utils.retry import TIER_1, retry_r2_call
        local_db_path.parent.mkdir(parents=True, exist_ok=True)
        retry_r2_call(
            client.download_file, R2_BUCKET, key, str(local_db_path),
            operation=f"user_db_download {user_id}", **TIER_1,
        )
        logger.info(f"Downloaded user.sqlite from R2: {user_id} version {r2_version}")
        return True, r2_version, False
    except Exception as e:
        logger.error(f"Failed to download user.sqlite from R2: {e}")
        return False, local_version, True  # Download failed


def sync_user_db_to_r2_with_version(
    user_id: str,
    local_db_path: Path,
    current_version: int | None,
    skip_version_check: bool = False,
    lock_timeout: float | None = None,
    with_diag: bool = False,
):
    """Upload user.sqlite to R2 with version metadata. Same pattern as profile DB.

    Args:
        skip_version_check: If True, skip the HEAD call and use current_version directly.
        with_diag: T6390 — see sync_database_to_r2_with_version. Default False keeps
            the 2-tuple return.
    """
    def _out(success, new_version, diag=None):
        return (success, new_version, diag) if with_diag else (success, new_version)

    # T4120/T5870: see sync_database_to_r2_with_version — the force-failure seam
    # must cover this primitive too (inert on prod/staging).
    if _force_r2_sync_failure():
        return _out(False, None, {"reason": "upload_failed"})

    if not R2_ENABLED:
        return _out(False, None, {"reason": "upload_failed"})

    if not local_db_path.exists():
        return _out(False, None, {"reason": "upload_failed"})

    client = get_r2_sync_client()
    if not client:
        return _out(False, None, {"reason": "upload_failed"})

    t_total = time.perf_counter() if PROFILING_ENABLED else 0
    head_ms = 0.0

    key = _user_db_r2_key(user_id)

    # T6402: same restructure as sync_database_to_r2_with_version — the version
    # decision runs INSIDE the upload lock and the lock_timeout bail-out stays
    # ahead of the HEAD. See that function for the race this closes.
    upload_lock = get_upload_lock(user_id, "user")
    lock_wait_start = time.perf_counter()
    # T2720: optional timeout (same pattern as profile DB above)
    if lock_timeout is not None:
        acquired = upload_lock.acquire(timeout=lock_timeout)
        if not acquired:
            logger.info(
                f"[SYNC] Upload lock busy >{lock_timeout}s, deferring "
                f"user={user_id} db=user"
            )
            return _out(False, None, {"reason": "upload_failed"})
    else:
        upload_lock.acquire()
    try:
        lock_wait_ms = (time.perf_counter() - lock_wait_start) * 1000
        if lock_wait_ms >= UPLOAD_LOCK_WAIT_LOG_MS:
            logger.info(
                f"[UPLOAD_LOCK_WAIT] user={user_id} db=user "
                f"waited_ms={int(lock_wait_ms)}"
            )
        return _sync_user_db_locked(
            user_id, local_db_path, current_version, skip_version_check,
            key, client, t_total, head_ms, _out,
        )
    finally:
        upload_lock.release()


def _sync_user_db_locked(
    user_id, local_db_path, current_version, skip_version_check,
    key, client, t_total, head_ms, _out,
):
    """user.sqlite twin of _sync_profile_db_locked (T6402)."""
    r2_metadata: dict = {}
    if skip_version_check:
        # Skip HEAD call — use in-memory version as base
        new_version = (current_version or 0) + 1
    else:
        t_head = time.perf_counter() if PROFILING_ENABLED else 0
        # T6390: read Metadata from the SAME HEAD (writer identity for a conflict).
        r2_result, r2_metadata = get_user_db_version_from_r2(
            user_id, client=client, return_metadata=True)
        if PROFILING_ENABLED:
            head_ms = (time.perf_counter() - t_head) * 1000

        # Extract int version, treating NOT_FOUND/ERROR as 0
        if isinstance(r2_result, R2VersionResult):
            r2_version = 0
        else:
            r2_version = r2_result

        # T950: Fail on conflict instead of overwriting. T4310 reviewer round 2
        # (MAJOR-2): no re-download — see the profile branch above for why the
        # swap is WAL-unsafe now that this path is live outside the write lock.
        # Refusing alone is safe: the baseline stays frozen at current_version.
        # T4315 (round 2, BLOCKING-2): see the profile branch above -- an
        # unconfirmed baseline (current_version is None) against real R2
        # content is treated the same as a stale one, or a first-access R2
        # ERROR (empty schema'd user.sqlite created, no version learned) would
        # force-push over the user's real credits/profiles/quests with zero
        # conflict signal.
        # T6402: same self-conflict exemption as the profile twin — see there.
        if (r2_version > 0 and (current_version is None or r2_version > current_version)
                and not (current_version is not None and _is_own_upload_version(key, r2_version))):
            reason = "unconfirmed_baseline" if current_version is None else "stale_baseline"
            from .user_context import get_current_method, get_current_path, get_current_req_id
            logger.critical(
                f"[SYNC_CONFLICT] user={user_id} db=user.sqlite loaded=v{current_version} "
                f"r2=v{r2_version} reason={reason} "
                f"writer={r2_metadata.get('db-writer') or 'unknown'} "
                f"machine={FLY_MACHINE_ID} req_id={get_current_req_id() or '-'} "
                f"method={get_current_method() or '-'} path={get_current_path() or '-'} "
                f"— NOT uploading, NOT re-downloading (WAL-unsafe swap off the write lock)"
            )
            return _out(False, r2_version, _conflict_diag(reason, r2_metadata))

        new_version = (max(r2_version, current_version or 0)) + 1

    # T5920: checkpoint the WAL into the main file BEFORE uploading — see
    # sync_database_to_r2_with_version above. A busy checkpoint refuses loudly
    # (retryable FAILED, no upload, no version bump).
    if not _checkpoint_wal_or_refuse(local_db_path, user_id):
        return _out(False, None, {"reason": "checkpoint_busy"})

    # T1539: serialized per user+key by the upload lock held around this region (T6402).
    t_upload = time.perf_counter() if PROFILING_ENABLED else 0
    try:
        from .utils.retry import TIER_1, retry_r2_call
        retry_r2_call(
            client.upload_file,
            str(local_db_path), R2_BUCKET, key,
            # T6390: stamp writer identity next to db-version (see profile primitive).
            ExtraArgs={"Metadata": {"db-version": str(new_version), **_db_writer_metadata()}},
            operation=f"user_db_sync_upload {user_id}", **TIER_1,
        )
    except Exception as e:
        logger.error(f"Failed to upload user.sqlite to R2: {e}")
        return _out(False, None, {"reason": "upload_failed"})
    _record_own_upload(key, new_version)  # T6402: before the lock releases
    if PROFILING_ENABLED:
        upload_ms = (time.perf_counter() - t_upload) * 1000
        total_ms = (time.perf_counter() - t_total) * 1000
        logger.info(
            f"[PROFILE] sync_user_db_to_r2_with_version: {total_ms:.0f}ms "
            f"(head: {'skipped' if skip_version_check else f'{head_ms:.0f}ms'}, upload: {upload_ms:.0f}ms)"
        )
    logger.debug(f"Uploaded user.sqlite to R2: {user_id} version {new_version}")
    return _out(True, new_version, None)


def ensure_file_from_r2(user_id: str, relative_path: str, local_path: Path) -> bool:
    """
    Ensure a file exists locally, downloading from R2 if needed.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Expected local path

    Returns:
        True if file exists locally (either already or after download)
    """
    if local_path.exists():
        return True

    if R2_ENABLED:
        return download_from_r2(user_id, relative_path, local_path)

    return False


def sync_file_to_r2_after_create(user_id: str, relative_path: str, local_path: Path):
    """
    Upload a newly created file to R2.
    Call this after creating new video files, clips, etc.
    """
    if R2_ENABLED and local_path.exists():
        upload_to_r2(user_id, relative_path, local_path)


def ensure_local_file(local_path: Path, user_data_base: Path) -> bool:
    """
    Ensure a file exists locally, downloading from R2 if needed.
    Automatically extracts user_id and relative_path from the local_path.

    This is a convenience wrapper around ensure_file_from_r2 for use in routers.

    Args:
        local_path: Full local path to the file
        user_data_base: Base path for user data (typically USER_DATA_BASE from database.py)

    Returns:
        True if file exists locally (either already or after download)
    """
    if local_path.exists():
        return True

    if not R2_ENABLED:
        return False

    # Extract user_id and relative_path from local_path
    # local_path should be like: user_data_base/<user_id>/<relative_path>
    try:
        rel_to_base = local_path.relative_to(user_data_base)
        parts = rel_to_base.parts
        if len(parts) < 2:
            return False
        user_id = parts[0]
        relative_path = "/".join(parts[1:])
        return download_from_r2(user_id, relative_path, local_path)
    except ValueError:
        # local_path is not under user_data_base
        return False


def generate_presigned_url(
    user_id: str,
    relative_path: str,
    expires_in: int = 3600,
    content_type: str | None = None
) -> str | None:
    """
    Generate a presigned URL for direct browser access to R2 object.

    This allows the frontend to stream videos/images directly from R2
    without proxying through the backend.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        expires_in: URL expiration time in seconds (default 1 hour)
        content_type: Optional content type (ignored - R2 doesn't support ResponseContentType)

    Returns:
        Presigned URL string, or None if R2 is disabled or error occurs
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        params = {
            "Bucket": R2_BUCKET,
            "Key": key,
        }

        # Note: R2 doesn't support ResponseContentType parameter in presigned URLs.
        # The browser will use the Content-Type from the object metadata instead.

        from .utils.retry import TIER_3, retry_r2_call
        url = retry_r2_call(
            client.generate_presigned_url,
            "get_object", Params=params, ExpiresIn=expires_in,
            operation=f"presign_get {key}", **TIER_3,
        )
        logger.debug(f"Generated presigned URL for: {key}")
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        return None


def generate_presigned_upload_url(
    user_id: str,
    relative_path: str,
    expires_in: int = 3600,
    content_type: str | None = None
) -> str | None:
    """
    Generate a presigned URL for direct browser upload to R2.

    This allows the frontend to upload files directly to R2
    without proxying through the backend.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        expires_in: URL expiration time in seconds (default 1 hour)
        content_type: Content type for the upload

    Returns:
        Presigned URL string, or None if R2 is disabled or error occurs
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        params = {
            "Bucket": R2_BUCKET,
            "Key": key,
        }

        if content_type:
            params["ContentType"] = content_type

        from .utils.retry import TIER_3, retry_r2_call
        url = retry_r2_call(
            client.generate_presigned_url,
            "put_object", Params=params, ExpiresIn=expires_in,
            operation=f"presign_put {key}", **TIER_3,
        )
        logger.debug(f"Generated presigned upload URL for: {key}")
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned upload URL for {key}: {e}")
        return None


def get_file_url(user_id: str, relative_path: str, local_fallback_url: str) -> str:
    """
    Get the best URL for accessing a file.

    If R2 is enabled, returns a presigned URL for direct R2 access.
    Otherwise, returns the local fallback URL.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_fallback_url: URL to use if R2 is disabled

    Returns:
        URL string (either presigned R2 URL or local fallback)
    """
    if R2_ENABLED:
        presigned = generate_presigned_url(user_id, relative_path)
        if presigned:
            return presigned
    return local_fallback_url


# List files in R2 (for debugging/admin)
def list_r2_files(user_id: str, prefix: str = "") -> list:
    """List files in R2 for a user."""
    client = get_r2_client()
    if not client:
        return []

    full_prefix = r2_key(user_id, prefix)
    try:
        from .utils.retry import TIER_3, retry_r2_call
        response = retry_r2_call(
            client.list_objects_v2, Bucket=R2_BUCKET, Prefix=full_prefix,
            operation=f"list {full_prefix}", **TIER_3,
        )
        return [obj["Key"] for obj in response.get("Contents", [])]
    except Exception as e:
        logger.error(f"Failed to list R2 files: {e}")
        return []


# ==============================================================================
# Global Storage Functions (for deduplicated games)
# ==============================================================================

def r2_global_key(path: str) -> str:
    """
    Generate R2 object key for global storage (not user-scoped).
    Used for deduplicated game storage: {env}/games/{blake3_hash}.mp4
    """
    # Normalize path separators for R2
    path = path.replace("\\", "/")
    return f"{APP_ENV}/{path}"


# ============================================================================
# Video-serving failure diagnostics (T6330)
# ============================================================================
# A video that won't load used to take three manual steps to triage (read the
# game's blake3_hash out of the profile DB, probe R2 across candidate prefixes,
# re-request with a fresh session) because the backend NEVER recorded the key it
# resolved. `log_video_resolution` emits ONE structured line on every
# video/poster serving FAILURE so "missing" vs "denied" vs "expired" is one
# glance in the logs -- no R2 archaeology. See export-pipeline.md § Video-failure
# diagnostics.


class VideoServeOutcome(str, Enum):
    """Resolved outcome of a video/poster serving attempt (T6330).

    The three FAILURE outcomes must be distinguishable from logs alone:
    - MISSING: the object is absent from R2 (a failure-path HEAD/GET saw 404).
    - DENIED: an auth/session check rejected the request (401/403) -- no key
      probe needed; the object's presence is irrelevant.
    - EXPIRED: the source was reclaimed/swept (an expiry state caused refusal),
      which must NOT be reported as a bare 404.
    REDIRECT_302 is the SUCCESS outcome (presign issued / object served) and is
    logged at DEBUG only -- never INFO on a hot path.
    """

    REDIRECT_302 = "redirect_302"
    MISSING = "missing"
    DENIED = "denied"
    EXPIRED = "expired"


def video_outcome_for_status(status: int) -> "VideoServeOutcome":
    """Map an upstream R2/HTTP status observed on a serving FAILURE to a triage
    outcome (T6330). 401/403 -> denied; 410 Gone -> expired; everything else
    non-2xx (incl. 404) -> missing.
    """
    if status in (401, 403):
        return VideoServeOutcome.DENIED
    if status == 410:
        return VideoServeOutcome.EXPIRED
    return VideoServeOutcome.MISSING


def _redact_if_credential_bearing(key: str | None) -> str | None:
    """Guard: never let a presigned URL (which embeds short-lived credentials)
    reach a log line. A legitimate R2 KEY never contains a scheme, an AWS
    signature parameter, or a query string, so any of those markers means a
    caller mistakenly passed a URL -- redact it rather than leak it.
    """
    if key is None:
        return None
    k = str(key)
    low = k.lower()
    if "://" in k or "x-amz-" in low or "?" in k:
        return "<redacted_url>"
    return k


def log_video_resolution(
    log: logging.Logger,
    *,
    kind: str,
    outcome: "VideoServeOutcome | str",
    key: str | None = None,
    entity_id=None,
    user_id: str | None = None,
    profile_id: str | None = None,
    blake3_hash: str | None = None,
    head_found: bool | None = None,
    reason: str | None = None,
    bucket: str | None = None,
) -> str:
    """Emit ONE line describing where a video/poster request looked and why it
    failed, so a future incident is triaged from logs alone (T6330).

    Level: DEBUG for the success outcome (REDIRECT_302) -- success on a hot path
    must never be per-request INFO noise -- and WARNING for every FAILURE
    outcome (missing/denied/expired).

    NEVER pass a presigned URL: this logs the fully-qualified R2 KEY only (a URL
    embeds credentials and is short-lived, so it is worthless AND unsafe in a
    log). A credential-bearing value slipped into `key` is redacted.

    Returns the formatted line (for the caller / tests).

    Args:
        kind: which surface (e.g. "game_video", "reel_video", "working_video",
            "game_poster", "reel_poster").
        outcome: a VideoServeOutcome.
        key: the fully-qualified R2 key that was probed/resolved (env-prefix-FREE
            `games/{blake3}.mp4` for game sources; env-prefixed
            `{env}/users/{uid}/profiles/{pid}/...` for per-user media). Pass the
            REAL key, not a template -- that asymmetry is exactly what makes
            "where did the code look?" non-obvious to a reader.
        head_found: whether a failure-path HEAD found the object (missing vs not).
        reason: which check rejected the request (e.g. "no_blake3_hash",
            "r2_status_403").
    """
    outcome_val = (
        outcome.value if isinstance(outcome, VideoServeOutcome) else str(outcome)
    )

    parts = [
        "[VIDEO_RESOLVE]",
        f"kind={kind}",
        f"outcome={outcome_val}",
    ]
    if entity_id is not None:
        parts.append(f"entity_id={entity_id}")
    if user_id is not None:
        parts.append(f"user_id={user_id}")
    if profile_id is not None:
        parts.append(f"profile_id={profile_id}")
    if blake3_hash is not None:
        parts.append(f"blake3_hash={blake3_hash}")
    parts.append(f"bucket={bucket if bucket is not None else R2_BUCKET}")
    parts.append(f"key={_redact_if_credential_bearing(key) or '-'}")
    if head_found is not None:
        parts.append(f"head_found={'true' if head_found else 'false'}")
    if reason:
        parts.append(f"reason={reason}")

    line = " ".join(parts)
    if outcome_val == VideoServeOutcome.REDIRECT_302.value:
        log.debug(line)
    else:
        log.warning(line)
    return line


def r2_user_key(user_id: str, path: str) -> str:
    """
    Generate R2 object key for user-level files (outside profiles).
    Format: {env}/users/{user_id}/{path}
    """
    path = path.replace("\\", "/")
    return f"{APP_ENV}/users/{user_id}/{path}"


def r2_head_object_global(key: str) -> dict | None:
    """
    Check if a global object exists in R2 and return its metadata.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        Dict with ContentLength, Metadata, etc. if exists, None otherwise
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        from .utils.retry import TIER_2, retry_r2_call
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"head_global {key}", **TIER_2,
        )
        return {
            'ContentLength': response.get('ContentLength'),
            'Metadata': response.get('Metadata', {}),
            'ContentType': response.get('ContentType'),
            'LastModified': response.get('LastModified'),
            'ETag': response.get('ETag'),  # T5682: conditional-request (If-None-Match) support
        }
    except Exception:
        return None


def r2_delete_object_global(key: str) -> bool:
    """
    Delete a global object from R2.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        True if deleted successfully, False otherwise
    """
    # HARD GUARD: game videos (games/{hash}.mp4) are a SHARED, env-prefix-free
    # resource across dev/staging/prod. A non-production environment cannot see
    # prod's refs, so it must NEVER delete a game object — doing so 404s the video
    # for prod users (the incident that lost imankh's game videos). Only production
    # may delete the shared game namespace. Env-prefixed keys ("{env}/users/...",
    # bug assets, etc.) are env-local and unaffected.
    if key.startswith("games/") and APP_ENV != "production":
        logger.error(
            f"[R2] BLOCKED delete of shared game object in non-production "
            f"(APP_ENV={APP_ENV}): {key}"
        )
        return False

    client = get_r2_client()
    if not client:
        return False

    try:
        from .utils.retry import TIER_3, retry_r2_call
        retry_r2_call(
            client.delete_object, Bucket=R2_BUCKET, Key=key,
            operation=f"delete_global {key}", **TIER_3,
        )
        logger.info(f"Deleted global object from R2: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete global object from R2: {key} - {e}")
        return False


# ==============================================================================
# Profile Data Cleanup Functions
# ==============================================================================


def delete_user_r2_data(user_id: str) -> int:
    """Delete every R2 object under {env}/users/{user_id}/ for a user.

    Covers user.sqlite, all profile.sqlite files, and all per-profile media. Paginated
    so it removes >1000 objects. Returns the number of objects deleted. Raises on R2
    error so callers can fail visibly (a partial delete must never be reported as a
    complete deletion — it would leave a resurrectable zombie account).
    """
    client = get_r2_client()
    if not client:
        return 0

    from .utils.retry import TIER_3, retry_r2_call

    prefix = f"{APP_ENV}/users/{user_id}/"
    paginator = client.get_paginator("list_objects_v2")
    deleted = 0
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
        objects = page.get("Contents", [])
        if not objects:
            continue
        delete_keys = [{"Key": obj["Key"]} for obj in objects]
        resp = retry_r2_call(
            client.delete_objects,
            Bucket=R2_BUCKET, Delete={"Objects": delete_keys},
            operation=f"delete_user {user_id}", **TIER_3,
        )
        # delete_objects returns HTTP 200 with a per-key `Errors` array on partial failure
        # (throttle / per-object denial) WITHOUT raising — surface it so a surviving object
        # (e.g. user.sqlite) is never silently counted as deleted.
        errors = resp.get("Errors") if isinstance(resp, dict) else None
        if errors:
            raise RuntimeError(
                f"R2 delete_objects reported {len(errors)} error(s) for user {user_id}: {errors[:3]}"
            )
        deleted += len(delete_keys)
    logger.info(f"Deleted {deleted} R2 objects under {prefix}")
    return deleted


def delete_profile_r2_data(user_id: str, profile_id: str) -> bool:
    """Delete all R2 objects under profiles/{profile_id}/ for a user.

    Used when deleting a profile — removes database, clips, videos, etc.
    """
    client = get_r2_client()
    if not client:
        return False

    prefix = r2_user_key(user_id, f"profiles/{profile_id}/")
    try:
        from .utils.retry import TIER_3, retry_r2_call
        # List all objects with the prefix
        response = retry_r2_call(
            client.list_objects_v2, Bucket=R2_BUCKET, Prefix=prefix,
            operation=f"list_profile {profile_id}", **TIER_3,
        )
        objects = response.get("Contents", [])

        if not objects:
            logger.info(f"No R2 objects to delete for profile {profile_id}")
            return True

        # Batch delete (S3/R2 supports up to 1000 per request)
        delete_keys = [{"Key": obj["Key"]} for obj in objects]
        retry_r2_call(
            client.delete_objects,
            Bucket=R2_BUCKET, Delete={"Objects": delete_keys},
            operation=f"delete_profile {profile_id}", **TIER_3,
        )
        logger.info(f"Deleted {len(delete_keys)} R2 objects for profile {profile_id} of user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete R2 data for profile {profile_id}: {e}")
        return False


def delete_local_profile_data(user_id: str, profile_id: str) -> bool:
    """Delete local data directory for a profile.

    Removes user_data/{user_id}/profiles/{profile_id}/ entirely.
    """
    import shutil

    from .database import USER_DATA_BASE, clear_scope_markers

    profile_path = USER_DATA_BASE / user_id / "profiles" / profile_id
    if not profile_path.exists():
        # T5081 (INV-P clear reason c): an already-gone dir can still have a
        # live .sync_pending/.sync_conflict/.sync_failed marker (e.g. a delete
        # that ran before this cleanup existed) — that marker can never be
        # discharged (no db left to upload or restore) and wedges
        # has_sync_pending/has_sync_conflict true forever with no gesture able
        # to clear it. Clear here too, not only on the rmtree path below.
        clear_scope_markers(user_id, profile_id)
        return True

    try:
        shutil.rmtree(profile_path)
        # T5081 (INV-P clear reason c): clear AFTER the delete succeeds, never
        # before — clearing first and then failing the rmtree would lose the
        # pending record for data that is still sitting on disk.
        clear_scope_markers(user_id, profile_id)
        logger.info(f"Deleted local data for profile {profile_id} of user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete local data for profile {profile_id}: {e}")
        return False


# ==============================================================================
# R2 Multipart Upload Functions
# ==============================================================================

def r2_create_multipart_upload(key: str, content_type: str = "video/mp4") -> str | None:
    """
    Initiate a multipart upload to R2.

    Args:
        key: R2 object key
        content_type: Content type for the object

    Returns:
        Upload ID string if successful, None otherwise

    T7950 — CreateMultipartUpload is NOT idempotent, so it must NOT be retried.
    A blind retry after a lost ack (the old `retry_r2_call(**TIER_3)` wrap) mints a
    SECOND live multipart when the first attempt actually EXECUTED at R2 but its ack
    arrived slower than the client read_timeout — leaving an orphan whose UploadId the
    server never learns (the double-UploadId leak: stored id ≠ the id open in R2).

    Instead we call create ONCE and classify any exception with retry.py's EXISTING
    transient/non-transient split (do NOT invent a new classification):

      | Exception class (from is_transient_error)            | Meaning                       | Action                    |
      |------------------------------------------------------|-------------------------------|---------------------------|
      | ReadTimeoutError / ConnectTimeoutError /             | request MAY have reached R2   | list open multiparts +    |
      | EndpointConnectionError / ConnectionClosedError /    | and minted a multipart whose  | adopt the newest by       |
      | BotoCoreError / ConnectionError / 5xx/429 ClientError| ack we lost (ambiguous)       | Initiated, abort extras   |
      | ClientError 403/404 / AccessDenied / NoSuchKey /     | rejected BEFORE anything was  | fail fast, return None,    |
      | validation 4xx (definitive rejection)                | created — nothing to adopt    | do NOT call list          |

    On a transient failure the adopt path recovers the executed-but-unacked multipart
    (returns None only if nothing materialized); on a definitive rejection we never
    touch list_multipart_uploads because R2 could not have created anything.
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        # ONE create attempt — no retry wrap (non-idempotent; see docstring).
        response = client.create_multipart_upload(
            Bucket=R2_BUCKET, Key=key, ContentType=content_type,
        )
        upload_id = response.get('UploadId')
        logger.info(f"Created multipart upload: {key}, upload_id: {upload_id}")
        return upload_id
    except Exception as e:
        from .utils.retry import is_transient_error
        if not is_transient_error(e):
            # Definitive rejection — the request was refused before R2 created
            # anything, so there is nothing to adopt. Fail fast without listing.
            logger.error(
                f"Failed to create multipart upload (non-transient rejection, "
                f"nothing created): {key} - {type(e).__name__}: {e}"
            )
            return None
        # Ambiguous ack loss — R2 may have created the multipart. Recover it by
        # listing + adopting rather than blind-retrying the non-idempotent create.
        logger.warning(
            f"create_multipart_upload ack lost (transient {type(e).__name__}); "
            f"listing to adopt any live multipart on {key} - {e}"
        )
        return _adopt_live_multipart_after_ack_loss(key)


def _adopt_live_multipart_after_ack_loss(key: str) -> str | None:
    """
    T7950 — recover from a lost CreateMultipartUpload ack.

    A create attempt raised a transient/ambiguous error, so R2 may or may not have
    minted a multipart. List the open multiparts on `key`: if none materialized the
    create truly failed (return None → caller surfaces a clean 500 and the client
    re-prepares); otherwise ADOPT the newest by `Initiated` (founder decision: the most
    recently initiated is the one this request just tried to create) and abort any
    extras so exactly one live multipart remains — the one we return and store.
    """
    uploads = r2_list_multipart_uploads(key)
    if not uploads:
        logger.error(
            f"create_multipart_upload ack lost and no live multipart materialized "
            f"on {key} — treating as create failure"
        )
        return None

    # Adopt the newest by Initiated (tz-aware; tolerate a missing timestamp).
    from datetime import UTC, datetime
    _epoch = datetime.min.replace(tzinfo=UTC)
    adopted = max(uploads, key=lambda u: u.get('Initiated') or _epoch)
    adopted_id = adopted['UploadId']

    aborted = 0
    for u in uploads:
        if u['UploadId'] != adopted_id and r2_abort_multipart_upload(key, u['UploadId']):
            aborted += 1
    logger.warning(
        f"Adopted live multipart {adopted_id} on {key} after create ack loss "
        f"(had {len(uploads)} open, aborted {aborted} extra)"
    )
    return adopted_id


def r2_complete_multipart_upload(
    key: str,
    upload_id: str,
    parts: list,
    metadata: dict | None = None
) -> bool:
    """
    Complete a multipart upload to R2.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        parts: List of dicts with 'PartNumber' and 'ETag' for each part
        metadata: Optional metadata to set on the completed object

    Returns:
        True if successful, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        from .utils.retry import TIER_3, retry_r2_call
        # Sort parts by part number
        sorted_parts = sorted(parts, key=lambda p: p['PartNumber'])

        retry_r2_call(
            client.complete_multipart_upload,
            Bucket=R2_BUCKET, Key=key, UploadId=upload_id,
            MultipartUpload={'Parts': sorted_parts},
            operation=f"complete_multipart {key}", **TIER_3,
        )
        logger.info(f"Completed multipart upload: {key}")

        # Set metadata if provided (R2 requires copy-in-place for metadata)
        if metadata:
            r2_set_object_metadata_global(key, metadata)

        return True
    except Exception as e:
        logger.error(f"Failed to complete multipart upload: {key} - {e}")
        return False


def r2_abort_multipart_upload(key: str, upload_id: str) -> bool:
    """
    Abort a multipart upload (cleanup incomplete uploads).

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload

    Returns:
        True if aborted successfully, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        from .utils.retry import TIER_3, retry_r2_call
        retry_r2_call(
            client.abort_multipart_upload,
            Bucket=R2_BUCKET, Key=key, UploadId=upload_id,
            operation=f"abort_multipart {key}", **TIER_3,
        )
        logger.info(f"Aborted multipart upload: {key}, upload_id: {upload_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to abort multipart upload: {key} - {e}")
        return False


def r2_is_multipart_upload_valid(key: str, upload_id: str) -> bool:
    """
    Check if a multipart upload session is still valid.

    Uses list_parts to verify the upload exists. R2/S3 will return
    an error if the upload has expired or been aborted.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload

    Returns:
        True if upload is valid and can be resumed, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        from .utils.retry import TIER_3, retry_r2_call
        # list_parts will fail if the upload doesn't exist
        retry_r2_call(
            client.list_parts,
            Bucket=R2_BUCKET, Key=key, UploadId=upload_id, MaxParts=1,
            operation=f"list_parts {key}", **TIER_3,
        )
        return True
    except client.exceptions.NoSuchUpload:
        logger.info(f"Multipart upload no longer exists: {key}, upload_id: {upload_id}")
        return False
    except Exception as e:
        # Any other error (network, etc.) - assume invalid to be safe
        logger.warning(f"Error checking multipart upload validity: {key} - {e}")
        return False


def r2_list_multipart_parts(key: str, upload_id: str) -> list | None:
    """
    List the parts already uploaded for a multipart upload.

    Returns a list of {'PartNumber': int, 'Size': int, 'ETag': str} (paginated
    through all parts), or None if the upload is gone/unreadable. Used to verify
    resume compatibility (T7480: after PART_SIZE changed 25MB -> 5MB, an old
    upload's completed parts must not be spliced with new-size parts).
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        from .utils.retry import TIER_3, retry_r2_call
        parts: list = []
        marker = 0
        while True:
            response = retry_r2_call(
                client.list_parts,
                Bucket=R2_BUCKET, Key=key, UploadId=upload_id,
                PartNumberMarker=marker,
                operation=f"list_parts_full {key}", **TIER_3,
            )
            for p in response.get('Parts', []):
                parts.append({
                    'PartNumber': p['PartNumber'],
                    'Size': p.get('Size', 0),
                    'ETag': p.get('ETag'),
                })
            if response.get('IsTruncated'):
                marker = response.get('NextPartNumberMarker', 0)
            else:
                break
        return parts
    except client.exceptions.NoSuchUpload:
        logger.info(f"Multipart upload no longer exists (list_parts): {key}, upload_id: {upload_id}")
        return None
    except Exception as e:
        logger.warning(f"Error listing multipart parts: {key} - {e}")
        return None


def r2_multipart_parts_match_size(
    key: str, upload_id: str, file_size: int, part_size: int
) -> bool:
    """
    Verify every already-uploaded part of a multipart upload was chunked at the
    CURRENT part_size, so a resume can safely reuse the session.

    R2 requires all non-final parts of one upload to be the same size. When
    part_size changes between deploys (T7480: 25MB -> 5MB), an old session's
    completed parts no longer tile the file at the new size; resuming it would
    finalize a corrupt object. Every completed part except the file's true last
    part (which is the short tail) must equal part_size; the last part must equal
    its expected tail length. An empty/unreadable part list is treated as
    incompatible (caller restarts fresh) — the safe default.
    """
    if file_size <= 0 or part_size <= 0:
        return False

    parts = r2_list_multipart_parts(key, upload_id)
    if not parts:
        return False

    last_part_number = (file_size + part_size - 1) // part_size
    tail_size = file_size - (last_part_number - 1) * part_size

    for p in parts:
        n = p['PartNumber']
        size = p['Size']
        if n < 1 or n > last_part_number:
            return False
        expected = tail_size if n == last_part_number else part_size
        if size != expected:
            logger.warning(
                f"Resume part-size mismatch: {key} part {n} size={size} "
                f"expected={expected} (part_size={part_size}); restarting fresh"
            )
            return False
    return True


def r2_list_multipart_uploads(key: str) -> list:
    """
    List all open multipart uploads whose object key exactly matches `key`.

    Returns a list of {'Key': str, 'UploadId': str, 'Initiated': datetime}.
    R2/S3 filters by Prefix, so an exact-key match is applied client-side.
    """
    client = get_r2_client()
    if not client:
        return []

    try:
        from .utils.retry import TIER_3, retry_r2_call
        uploads: list = []
        key_marker = None
        id_marker = None
        while True:
            kwargs = {"Bucket": R2_BUCKET, "Prefix": key}
            if key_marker is not None:
                kwargs["KeyMarker"] = key_marker
            if id_marker is not None:
                kwargs["UploadIdMarker"] = id_marker
            response = retry_r2_call(
                client.list_multipart_uploads,
                operation=f"list_multipart_uploads {key}", **TIER_3, **kwargs,
            )
            for u in response.get('Uploads', []):
                if u.get('Key') == key:
                    uploads.append({
                        'Key': u['Key'],
                        'UploadId': u['UploadId'],
                        'Initiated': u.get('Initiated'),
                    })
            if response.get('IsTruncated'):
                key_marker = response.get('NextKeyMarker')
                id_marker = response.get('NextUploadIdMarker')
            else:
                break
        return uploads
    except Exception as e:
        logger.warning(f"Error listing multipart uploads: {key} - {e}")
        return []


def r2_list_multipart_uploads_by_prefix(prefix: str) -> list:
    """
    List every open multipart upload whose key starts with `prefix` (e.g. "games/").

    Unlike r2_list_multipart_uploads (exact-key match, for one known object), this
    is a broad admin-sweep primitive (T7880): it surfaces multiparts for hashes we
    don't already have a local record for, and lets a sweep catch the double-UploadId
    anomaly (an object with 2+ open multiparts, one matching a stored pending_uploads
    row and one not).

    Returns a list of {'Key': str, 'UploadId': str, 'Initiated': datetime}.
    """
    client = get_r2_client()
    if not client:
        return []

    try:
        from .utils.retry import TIER_3, retry_r2_call
        uploads: list = []
        key_marker = None
        id_marker = None
        while True:
            kwargs = {"Bucket": R2_BUCKET, "Prefix": prefix}
            if key_marker is not None:
                kwargs["KeyMarker"] = key_marker
            if id_marker is not None:
                kwargs["UploadIdMarker"] = id_marker
            response = retry_r2_call(
                client.list_multipart_uploads,
                operation=f"list_multipart_uploads_by_prefix {prefix}", **TIER_3, **kwargs,
            )
            for u in response.get('Uploads', []):
                uploads.append({
                    'Key': u['Key'],
                    'UploadId': u['UploadId'],
                    'Initiated': u.get('Initiated'),
                })
            if response.get('IsTruncated'):
                key_marker = response.get('NextKeyMarker')
                id_marker = response.get('NextUploadIdMarker')
            else:
                break
        return uploads
    except Exception as e:
        logger.warning(f"Error listing multipart uploads by prefix: {prefix} - {e}")
        return []


def r2_abort_orphan_multipart_uploads(key: str, keep_upload_id: str | None = None) -> int:
    """
    Abort every open multipart upload on `key`, optionally sparing one.

    T7480 UploadId hygiene: `create_multipart_upload` can leak a duplicate
    multipart when the app-level retry_r2_call fires a second CreateMultipartUpload
    after R2 answered the first slower than read_timeout (boto3 itself does NOT
    retry — Config(retries={"max_attempts": 0})). Called on the fresh-create path
    (after any valid resume was already declined), so aborting open multiparts here
    only reclaims genuine orphans. Returns the number aborted.
    """
    aborted = 0
    for u in r2_list_multipart_uploads(key):
        if keep_upload_id is not None and u['UploadId'] == keep_upload_id:
            continue
        if r2_abort_multipart_upload(key, u['UploadId']):
            aborted += 1
    if aborted:
        logger.info(f"Aborted {aborted} orphan multipart upload(s) on {key}")
    return aborted


def generate_presigned_part_url(
    key: str,
    upload_id: str,
    part_number: int,
    expires_in: int = 14400  # 4 hours default
) -> str | None:
    """
    Generate a presigned URL for uploading a specific part.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        part_number: Part number (1-indexed)
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        Presigned URL string, or None if failed
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        from .utils.retry import TIER_3, retry_r2_call
        url = retry_r2_call(
            client.generate_presigned_url,
            'upload_part',
            Params={'Bucket': R2_BUCKET, 'Key': key, 'UploadId': upload_id, 'PartNumber': part_number},
            ExpiresIn=expires_in,
            operation=f"presign_part {key}#{part_number}", **TIER_3,
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned part URL: {key} part {part_number} - {e}")
        return None


def generate_multipart_urls(
    key: str,
    upload_id: str,
    file_size: int,
    part_size: int = 100 * 1024 * 1024,  # 100MB default
    expires_in: int = 14400  # 4 hours default
) -> list:
    """
    Generate presigned URLs for all parts of a multipart upload.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        file_size: Total file size in bytes
        part_size: Size of each part in bytes (default 100MB)
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        List of dicts with part_number, presigned_url, start_byte, end_byte
    """
    parts = []
    part_number = 1
    offset = 0

    while offset < file_size:
        end_byte = min(offset + part_size - 1, file_size - 1)

        presigned_url = generate_presigned_part_url(
            key, upload_id, part_number, expires_in
        )

        if presigned_url:
            parts.append({
                'part_number': part_number,
                'presigned_url': presigned_url,
                'start_byte': offset,
                'end_byte': end_byte
            })

        offset += part_size
        part_number += 1

    logger.info(f"Generated {len(parts)} presigned URLs for multipart upload: {key}")
    return parts


# ==============================================================================
# R2 Object Metadata Functions (for ref_count tracking)
# ==============================================================================

def r2_get_object_metadata_global(key: str) -> dict | None:
    """
    Get metadata for a global R2 object.

    Args:
        key: Global R2 key

    Returns:
        Metadata dict if object exists, None otherwise
    """
    head_result = r2_head_object_global(key)
    if head_result:
        return head_result.get('Metadata', {})
    return None


def r2_set_object_metadata_global(key: str, metadata: dict) -> bool:
    """
    Set metadata on a global R2 object (using copy-in-place).

    R2/S3 doesn't support updating metadata directly - you must copy the object
    to itself with new metadata.

    Args:
        key: Global R2 key
        metadata: Dict of metadata to set (keys will be lowercased by S3)

    Returns:
        True if successful, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        from .utils.retry import TIER_3, retry_r2_call
        # Copy object to itself with new metadata
        retry_r2_call(
            client.copy_object,
            Bucket=R2_BUCKET,
            CopySource={'Bucket': R2_BUCKET, 'Key': key},
            Key=key, Metadata=metadata, MetadataDirective='REPLACE',
            operation=f"set_metadata {key}", **TIER_3,
        )
        logger.debug(f"Set metadata on global object: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to set metadata on global object: {key} - {e}")
        return False


def increment_ref_count(key: str) -> int:
    """
    Increment the ref_count metadata on a global R2 object.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        New ref_count value, or -1 if failed
    """
    metadata = r2_get_object_metadata_global(key)
    if metadata is None:
        logger.error(f"Cannot increment ref_count: object not found: {key}")
        return -1

    try:
        current_count = int(metadata.get('ref_count', '0'))
    except (ValueError, TypeError):
        current_count = 0

    new_count = current_count + 1

    # Copy all existing metadata and update ref_count
    new_metadata = dict(metadata)
    new_metadata['ref_count'] = str(new_count)

    if r2_set_object_metadata_global(key, new_metadata):
        logger.info(f"Incremented ref_count: {key} -> {new_count}")
        return new_count
    return -1


def decrement_ref_count(key: str) -> int:
    """
    Decrement the ref_count metadata on a global R2 object.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        New ref_count value (0 means object should be deleted), or -1 if failed
    """
    metadata = r2_get_object_metadata_global(key)
    if metadata is None:
        logger.warning(f"Cannot decrement ref_count: object not found: {key}")
        return 0  # Treat as 0 so caller can clean up

    try:
        current_count = int(metadata.get('ref_count', '1'))
    except (ValueError, TypeError):
        current_count = 1

    new_count = max(0, current_count - 1)

    # Copy all existing metadata and update ref_count
    new_metadata = dict(metadata)
    new_metadata['ref_count'] = str(new_count)

    if r2_set_object_metadata_global(key, new_metadata):
        logger.info(f"Decremented ref_count: {key} -> {new_count}")
        return new_count

    logger.error(f"Failed to decrement ref_count: {key}")
    return -1


def generate_presigned_url_global(
    key: str,
    expires_in: int = 14400  # 4 hours default
) -> str | None:
    """
    Generate a presigned URL for a global R2 object (no user prefix).

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        Presigned URL string, or None if failed
    """
    cache_key = (key, expires_in)
    now = time.time()
    with _PRESIGNED_URL_CACHE_LOCK:
        cached = _PRESIGNED_URL_CACHE.get(cache_key)
        # T7380: validate the URL's OWN expiry, not just the outer cache's TTL --
        # an entry can still be present in the outer TTLCache after its actual
        # R2 signature window has elapsed (see cache comment above).
        if cached is not None and cached[1] - _PRESIGNED_URL_EXPIRY_SAFETY_MARGIN_SEC > now:
            return cached[0]

    client = get_r2_client()
    if not client:
        return None

    try:
        from .utils.retry import TIER_3, retry_r2_call
        url = retry_r2_call(
            client.generate_presigned_url,
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=expires_in,
            operation=f"presign_global {key}", **TIER_3,
        )
        logger.debug(f"Generated presigned URL for global object: {key}")
        if url:
            with _PRESIGNED_URL_CACHE_LOCK:
                _PRESIGNED_URL_CACHE[cache_key] = (url, now + expires_in)
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        return None


def get_r2_file_size_global(key: str) -> int | None:
    """Get the size of a global R2 object (no user prefix)."""
    from .utils.retry import TIER_2, retry_r2_call

    client = get_r2_client()
    if not client:
        return None
    try:
        response = retry_r2_call(
            client.head_object, Bucket=R2_BUCKET, Key=key,
            operation=f"head_global {key}", **TIER_2,
        )
        return response.get('ContentLength')
    except Exception as e:
        logger.debug(f"Could not get global file size from R2: {key} - {e}")
        return None


def download_from_r2_global(key: str, local_path: Path, progress_callback=None) -> bool:
    """
    Download a global R2 object (no user prefix) to local filesystem.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")
        local_path: Local path to save the file
        progress_callback: Optional callback(bytes_transferred) for download progress

    Returns:
        True if download succeeded, False otherwise

    T6860: uses the DEFAULT sync client (`get_r2_client`), not the transfer client.
    The sole live caller is the intro-card burn egress (`intro_egress._download_card_image`,
    ~1-2 MB PNGs). The transfer client's `download_file` was exercised by NOTHING else on
    the Fly web servers -- and it failed non-transiently there, so the whole burn/download
    egress silently degraded to no-intro (attached card missing from every downloaded reel)
    while in-app playback -- which only presigns the image -- stayed fine. The default sync
    client's `download_file` is the SAME path `download_from_r2` (per-user) uses on every
    session-init to pull profile.sqlite, so it is proven-good on Fly; card images are far
    too small to need the transfer client's GB-scale multipart tuning.
    """
    from .utils.retry import TIER_1, retry_r2_call

    client = get_r2_client()
    if not client:
        return False

    try:
        # Ensure parent directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)
        if progress_callback:
            retry_r2_call(
                client.download_file, R2_BUCKET, key, str(local_path),
                Callback=progress_callback, operation=f"download_global {key}", **TIER_1,
            )
        else:
            retry_r2_call(
                client.download_file, R2_BUCKET, key, str(local_path),
                operation=f"download_global {key}", **TIER_1,
            )
        logger.debug(f"Downloaded global object from R2: {key} -> {local_path}")
        return True
    except client.exceptions.NoSuchKey:
        logger.debug(f"Global file not found in R2: {key}")
        return False
    except Exception as e:
        logger.error(f"Failed to download global object from R2: {key} - {e}")
        return False


def upload_file_to_r2_global(
    key: str, local_path: Path, *, content_type: str | None = None,
) -> bool:
    """Upload a LOCAL FILE to a FULL (env-prefixed) R2 key, streaming from disk.

    The local-file counterpart of `upload_bytes_to_r2_global` (same global key
    space as `r2_head_object_global` / `download_from_r2_global`), for artifacts
    too large to hold in memory as bytes (e.g. the T4947 stitched-collection
    download cache). `client.upload_file` transfers from disk (multipart under
    the hood) and the object only becomes visible on completion -- an S3/R2
    object PUT is atomic, so a concurrent HEAD/GET never observes a partial
    write. Returns True on success, False otherwise (never raises)."""
    from .utils.retry import TIER_1, retry_r2_call

    client = get_r2_client()
    if not client:
        return False

    try:
        extra_args = {"ContentType": content_type} if content_type else None
        retry_r2_call(
            client.upload_file, str(local_path), R2_BUCKET, key,
            ExtraArgs=extra_args, operation=f"upload_file_global {key}", **TIER_1,
        )
        logger.debug(f"Uploaded file to R2 (global): {local_path} -> {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload file to R2 (global): {key} - {e}")
        return False
