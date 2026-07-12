"""
T4900 / prod bug 31p — error responses must carry CORS headers.

Root cause of 31p: CORSMiddleware used to be the INNERMOST HTTP middleware, so
error/control responses produced by the middlewares outside it (the auth
401/503 in RequestContextMiddleware, and the Fly machine-pinning replay Response)
were emitted with NO Access-Control-Allow-* headers. A cross-origin browser then
blocked those responses and surfaced them as opaque "TypeError: Failed to fetch"
instead of a real status — which is exactly what the reporter saw (188x) while
same-origin video streaming kept working.

Fix: CORSMiddleware is now the OUTERMOST HTTP middleware, so every response —
including the middleware-generated 401 and the CORS preflight — carries CORS
headers. These tests pin that. (Verified counterfactual: with the old inner
ordering the 401 carried no access-control-allow-origin header.)
"""

import asyncio

import httpx
import pytest

from app.main import app

ALLOWED_ORIGIN = "http://localhost:5173"


def _request(method, url, **kwargs):
    async def _run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            return await c.request(method, url, **kwargs)
    return asyncio.run(_run())


def test_unauthed_error_response_carries_cors_header():
    # No auth (no X-User-ID / cookie) -> RequestContextMiddleware rejects it. The
    # point is the ERROR still carries CORS headers now that CORS is outermost.
    resp = _request(
        "GET",
        "/api/export/projects/999999/overlay-data",
        headers={"Origin": ALLOWED_ORIGIN},
    )
    assert resp.status_code in (401, 403), resp.text
    assert resp.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN, (
        "error responses from the auth middleware must carry CORS headers "
        "(else a cross-origin browser reads them as 'Failed to fetch')"
    )


def test_preflight_for_overlay_actions_is_allowed():
    resp = _request(
        "OPTIONS",
        "/api/export/projects/1/overlay/actions",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status_code in (200, 204), resp.text
    assert resp.headers.get("access-control-allow-origin") == ALLOWED_ORIGIN
    assert "POST" in resp.headers.get("access-control-allow-methods", "")
