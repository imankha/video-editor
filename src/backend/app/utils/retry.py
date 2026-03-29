"""
Retry utilities for R2/network operations with exponential backoff + jitter.

Provides `retry_r2_call` (sync) and `retry_async_call` (async) wrappers that
retry only on transient network errors. Non-transient errors (404, 403) are
raised immediately.

Usage:
    # Sync (storage.py, auth_db.py)
    result = retry_r2_call(client.download_file, bucket, key, path, max_attempts=4)

    # Async (auth.py httpx calls)
    resp = await retry_async_call(client.get, url, max_attempts=3)
"""

import time
import asyncio
import random
import logging
import socket

logger = logging.getLogger(__name__)

# Tier presets: (max_attempts, initial_delay)
# Tier 1 — critical path: 3 retries (4 total attempts), 1s initial
TIER_1 = {"max_attempts": 4, "initial_delay": 1.0}
# Tier 2 — important: 2 retries (3 total attempts), 0.5s initial
TIER_2 = {"max_attempts": 3, "initial_delay": 0.5}
# Tier 3 — best-effort: 1 retry (2 total attempts), 0.5s initial
TIER_3 = {"max_attempts": 2, "initial_delay": 0.5}


def is_transient_error(exc: Exception) -> bool:
    """Check if an error is transient and should be retried.

    Retries: ConnectTimeoutError, ReadTimeoutError, EndpointConnectionError,
             ConnectionError, HTTP 429/500/502/503.
    Does NOT retry: NoSuchKey (404), AccessDenied (403), client errors (4xx).
    """
    error_type = type(exc).__name__
    error_msg = str(exc).lower()

    # botocore-specific transient errors
    transient_types = {
        "ConnectTimeoutError",
        "ReadTimeoutError",
        "EndpointConnectionError",
        "ConnectionClosedError",
        "BotoCoreError",
    }
    if error_type in transient_types:
        return True

    # Python built-in connection errors
    if isinstance(exc, (ConnectionError, ConnectionResetError, ConnectionRefusedError)):
        return True

    # DNS failures
    if isinstance(exc, socket.gaierror):
        return True

    # httpx transient errors
    httpx_transient_types = {"TimeoutException", "ConnectTimeout", "ReadTimeout", "ConnectError"}
    if error_type in httpx_transient_types:
        return True

    # Check for HTTP status-based transient errors from botocore ClientError
    if error_type == "ClientError":
        try:
            status_code = int(exc.response.get("Error", {}).get("Code", "0"))
        except (ValueError, TypeError, AttributeError):
            status_code = 0
        if status_code in (429, 500, 502, 503):
            return True
        # Explicit non-transient codes
        if status_code in (403, 404):
            return False

    # Check for NoSuchKey / AccessDenied (never retry)
    if error_type in ("NoSuchKey", "AccessDenied"):
        return False
    # Also catch via error message
    if "nosuchkey" in error_msg or "access denied" in error_msg:
        return False

    # Network keyword heuristics (catch-all for edge cases)
    network_keywords = [
        "timed out",
        "timeout",
        "connection reset",
        "connection refused",
        "connection aborted",
        "broken pipe",
        "network unreachable",
        "could not connect to the endpoint url",
        "temporary failure in name resolution",
    ]
    for keyword in network_keywords:
        if keyword in error_msg:
            return True

    return False


def retry_r2_call(func, *args, max_attempts=4, initial_delay=1.0, backoff=2.0,
                  max_delay=30.0, operation="R2", **kwargs):
    """Execute a sync R2/boto3 operation with retry on transient errors.

    Non-transient errors are raised immediately. Transient errors are retried
    with exponential backoff + jitter. If all attempts fail, the last exception
    is raised.

    Args:
        func: The boto3 method to call (e.g. client.download_file)
        *args: Positional args for func
        max_attempts: Total attempts (including initial). Default 4 (3 retries).
        initial_delay: Base delay in seconds before first retry
        backoff: Exponential backoff multiplier
        max_delay: Maximum delay between retries
        operation: Label for log messages
        **kwargs: Keyword args for func

    Returns:
        Whatever func returns

    Raises:
        The original exception if non-transient or all retries exhausted
    """
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            last_exc = e
            if not is_transient_error(e) or attempt >= max_attempts - 1:
                if attempt > 0:
                    logger.warning(
                        f"[{operation}] Failed after {attempt + 1} attempts: "
                        f"{type(e).__name__}: {e}"
                    )
                raise
            delay = min(initial_delay * (backoff ** attempt), max_delay)
            delay *= 0.5 + random.random()  # jitter: 50-150% of calculated delay
            logger.warning(
                f"[{operation}] Attempt {attempt + 1}/{max_attempts} failed: "
                f"{type(e).__name__}: {e} — retrying in {delay:.1f}s"
            )
            time.sleep(delay)

    raise last_exc  # Should not reach here, but safety net


async def retry_async_call(coro_func, *args, max_attempts=4, initial_delay=1.0,
                           backoff=2.0, max_delay=30.0, operation="async",
                           **kwargs):
    """Execute an async operation with retry on transient errors.

    Same semantics as retry_r2_call but for async/await coroutines.

    Args:
        coro_func: Async function to call (e.g. client.get)
        *args: Positional args for coro_func
        max_attempts: Total attempts (including initial)
        initial_delay: Base delay in seconds before first retry
        backoff: Exponential backoff multiplier
        max_delay: Maximum delay between retries
        operation: Label for log messages
        **kwargs: Keyword args for coro_func

    Returns:
        Whatever coro_func returns

    Raises:
        The original exception if non-transient or all retries exhausted
    """
    last_exc = None
    for attempt in range(max_attempts):
        try:
            return await coro_func(*args, **kwargs)
        except Exception as e:
            last_exc = e
            if not is_transient_error(e) or attempt >= max_attempts - 1:
                if attempt > 0:
                    logger.warning(
                        f"[{operation}] Failed after {attempt + 1} attempts: "
                        f"{type(e).__name__}: {e}"
                    )
                raise
            delay = min(initial_delay * (backoff ** attempt), max_delay)
            delay *= 0.5 + random.random()
            logger.warning(
                f"[{operation}] Attempt {attempt + 1}/{max_attempts} failed: "
                f"{type(e).__name__}: {e} — retrying in {delay:.1f}s"
            )
            await asyncio.sleep(delay)

    raise last_exc
