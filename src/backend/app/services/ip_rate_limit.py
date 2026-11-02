"""T14180: per-IP rate limits backed by Postgres.

Each allowed event is one `ip_rate_events` row; a check counts the key's rows
inside the window. State lives in Postgres, so a limit survives a restart and
holds across machines. A refused attempt records nothing.
"""

import logging
from datetime import timedelta
from enum import Enum

from fastapi import Request

from app.services.pg import get_pg

logger = logging.getLogger(__name__)


class IpRateAction(str, Enum):
    OTP_SEND = "otp_send"
    SIGNUP = "signup"


def client_ip(request: Request) -> str:
    """The caller's IP. Browsers call *.fly.dev directly and Fly's edge sets
    `Fly-Client-IP` (overwriting any client-supplied value). Off Fly (local dev,
    tests without the header) the socket peer is the client."""
    ip = request.headers.get("fly-client-ip")
    if ip:
        return ip
    return request.client.host if request.client else "unknown"


def try_consume(action: IpRateAction, ip: str, limit: int, window: timedelta) -> bool:
    """Record one `action` event for `ip` if fewer than `limit` fall inside
    `window`; return False (recording nothing) when the limit is reached.

    A transaction-scoped advisory lock on (action, ip) serializes concurrent
    checks for the same key, so a burst cannot overshoot the limit.
    """
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{action.value}:{ip}",))
        cur.execute(
            "DELETE FROM ip_rate_events WHERE action = %s AND ip = %s AND created_at <= now() - %s",
            (action.value, ip, window),
        )
        cur.execute(
            "SELECT COUNT(*) AS n FROM ip_rate_events WHERE action = %s AND ip = %s",
            (action.value, ip),
        )
        if cur.fetchone()["n"] >= limit:
            logger.warning(f"[RateLimit] {action.value} refused for ip={ip} (limit {limit} per {window})")
            return False
        cur.execute(
            "INSERT INTO ip_rate_events (action, ip) VALUES (%s, %s)",
            (action.value, ip),
        )
        return True
