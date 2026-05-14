"""T1190: ASGI middleware for WebSocket fly-replay routing.

BaseHTTPMiddleware (used by RequestContextMiddleware) only processes HTTP
scopes. WebSocket upgrade requests bypass it entirely. This raw ASGI
middleware intercepts WebSocket scopes and returns fly-replay headers when
the fly_machine_id cookie doesn't match the current machine.

HTTP scopes pass through untouched -- RequestContextMiddleware handles
their replay in _dispatch_impl().
"""

import logging
import os
from http.cookies import SimpleCookie

logger = logging.getLogger(__name__)

FLY_MACHINE_ID = os.getenv("FLY_MACHINE_ID", "")


class FlyReplayMiddleware:

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if not FLY_MACHINE_ID or scope["type"] != "websocket":
            return await self.app(scope, receive, send)

        pinned = self._get_cookie(scope, "fly_machine_id")
        if not pinned or pinned == FLY_MACHINE_ID:
            return await self.app(scope, receive, send)

        from .db_sync import _LIVE_MACHINES
        replay_src = self._get_header(scope, b"fly-replay-src")
        if replay_src or pinned not in _LIVE_MACHINES:
            if pinned not in _LIVE_MACHINES:
                logger.warning(f"[Replay/WS] Stale cookie: machine {pinned} not live, accepting on {FLY_MACHINE_ID}")
            else:
                logger.warning(f"[Replay/WS] Circuit-breaker: {pinned} unavailable, accepting WS on {FLY_MACHINE_ID}")
            return await self.app(scope, receive, send)

        logger.info(f"[Replay/WS] Replaying WS to {pinned}")
        await send({
            "type": "websocket.http.response.start",
            "status": 400,
            "headers": [
                (b"fly-replay", f"instance={pinned}".encode()),
            ],
        })
        await send({"type": "websocket.http.response.body", "body": b""})

    @staticmethod
    def _get_cookie(scope, name):
        for key, val in scope.get("headers", []):
            if key == b"cookie":
                cookies = SimpleCookie(val.decode())
                morsel = cookies.get(name)
                return morsel.value if morsel else None
        return None

    @staticmethod
    def _get_header(scope, name):
        for key, val in scope.get("headers", []):
            if key == name:
                return val.decode()
        return None
