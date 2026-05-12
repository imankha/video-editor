"""
Hourly cleanup of expired sessions and OTP codes from Postgres.
"""

import asyncio
import logging

logger = logging.getLogger(__name__)

_cleanup_task: asyncio.Task | None = None


async def start_cleanup_loop():
    global _cleanup_task
    _cleanup_task = asyncio.create_task(_run_cleanup_loop())
    logger.info("[Cleanup] Hourly cleanup loop started")


async def stop_cleanup_loop():
    global _cleanup_task
    if _cleanup_task:
        _cleanup_task.cancel()
        try:
            await _cleanup_task
        except asyncio.CancelledError:
            pass
        _cleanup_task = None
        logger.info("[Cleanup] Hourly cleanup loop stopped")


async def _run_cleanup_loop():
    while True:
        try:
            await asyncio.sleep(3600)
            await asyncio.to_thread(_do_cleanup)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("[Cleanup] Error in periodic cleanup")


def _do_cleanup():
    from .auth_db import cleanup_expired_sessions
    from .pg import get_pg

    sessions_deleted = cleanup_expired_sessions()

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM otp_codes WHERE expires_at < now()")
        otp_deleted = cur.rowcount

    if otp_deleted > 0:
        logger.info(f"[Cleanup] Deleted {otp_deleted} expired OTP codes")
