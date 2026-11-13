"""T15790: the resume-point Postgres calls must not block the event loop.

A cold reopen of `/` restores the Frame editor from the server-held resume point. On
staging every request the restore fired (GET /api/projects/{id}, quests, warmup, ...)
logged [SLOW FETCH] 3.6-6 s and finished within ~30 ms of each other: the T6200
fingerprint of a blocked loop. POST/DELETE /api/me/resume-point and GET /api/auth/me ran
their psycopg2 calls (with get_pg's stale-connection ping/reconnect) directly inside
`async def` handlers, so one slow Postgres round trip stalled the whole process and
pushed the Frame editor past the 10 s budget.

Each test drives the REAL route through FastAPI, replaces the Postgres call with a
blocking one, and checks an unrelated request still completes while it blocks. No
Postgres needed (T15300: the pg_conn fixture can damage the shared dev DB).
"""

import asyncio
import threading
import time

import httpx
import pytest
from fastapi import FastAPI, Request

from app.routers import auth as auth_router_module
from app.routers import users as users_router_module
from app.services import resume_points
from app.user_context import set_current_impersonator_id, set_current_user_id

USER_ID = "user-t15790"
BLOCK_S = 1.0


def _app() -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _session(request: Request, call_next):
        # Stand-in for db_sync's auth: the session /me reads, plus the user context.
        request.state.session = {"user_id": USER_ID, "email": "t15790@test.local", "terms_accepted_at": "x"}
        set_current_user_id(USER_ID)
        set_current_impersonator_id(None)
        return await call_next(request)

    @app.get("/ping")
    async def _ping():
        return {"ok": True}

    app.include_router(users_router_module.router)
    app.include_router(auth_router_module.router)
    return app


def _blocking(entered: threading.Event, result=None):
    def fn(*_args, **_kwargs):
        entered.set()
        time.sleep(BLOCK_S)  # a slow psycopg2 round trip (stale-socket ping + reconnect)
        return result
    return fn


async def _ping_during(method: str, path: str, entered: threading.Event, **kwargs) -> tuple[float, float]:
    """Fire the slow request, then /ping once its Postgres call has started.
    Returns (ping latency, how long the slow request kept running after the ping finished)."""
    transport = httpx.ASGITransport(app=_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        slow = asyncio.create_task(client.request(method, path, **kwargs))
        while not entered.is_set():
            await asyncio.sleep(0.005)
        t0 = time.perf_counter()
        ping = await client.get("/ping")
        ping_done = time.perf_counter()
        resp = await slow
        slow_done = time.perf_counter()
    assert ping.status_code == 200
    assert resp.status_code in (200, 204), resp.text
    return ping_done - t0, slow_done - ping_done


@pytest.fixture(autouse=True)
def _no_background_pg(monkeypatch):
    # /me defers last-seen/session/upload-reap writes to a background task; keep them off Postgres.
    monkeypatch.setattr(auth_router_module, "update_last_seen", lambda *_a, **_k: None)
    monkeypatch.setattr(auth_router_module, "update_session", lambda *_a, **_k: None)
    monkeypatch.setattr("app.routers.games_upload.reap_abandoned_pending_uploads", lambda *_a, **_k: None)


def _assert_loop_free(ping_s: float, slow_left_s: float):
    assert ping_s < 0.3, f"/ping took {ping_s:.2f}s while the resume-point call blocked: event loop stalled"
    assert slow_left_s > 0.3, "the slow request had already finished: /ping waited behind it"


def test_post_resume_point_does_not_block_event_loop(monkeypatch):
    entered = threading.Event()
    monkeypatch.setattr(users_router_module, "upsert_resume_point", _blocking(entered, True))
    _assert_loop_free(*asyncio.run(_ping_during(
        "POST", "/api/me/resume-point", entered, json={"path": "/focus/p/1", "screen": "framing"},
    )))


def test_delete_resume_point_does_not_block_event_loop(monkeypatch):
    entered = threading.Event()
    monkeypatch.setattr(users_router_module, "delete_resume_point", _blocking(entered))
    _assert_loop_free(*asyncio.run(_ping_during("DELETE", "/api/me/resume-point", entered)))


def test_auth_me_resume_point_read_does_not_block_event_loop(monkeypatch):
    entered = threading.Event()
    point = {"path": "/focus/p/1", "screen": "framing"}
    monkeypatch.setattr(resume_points, "get_resume_point", _blocking(entered, point))
    ping_s, slow_left_s = asyncio.run(_ping_during("GET", "/api/auth/me", entered))
    _assert_loop_free(ping_s, slow_left_s)


def test_offloaded_write_still_sees_the_request_user(monkeypatch):
    seen = []
    monkeypatch.setattr(
        users_router_module, "upsert_resume_point",
        lambda user_id, point: seen.append((user_id, point["path"])) or True,
    )
    transport = httpx.ASGITransport(app=_app())

    async def go():
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/api/me/resume-point", json={"path": "/focus/p/7"})

    assert asyncio.run(go()).status_code == 204
    assert seen == [(USER_ID, "/focus/p/7")]
