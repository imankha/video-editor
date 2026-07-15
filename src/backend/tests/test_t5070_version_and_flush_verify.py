"""
T5070 — X-App-Version handshake (header + GET /api/version) and the
POST /api/sync/flush-verify barrier the update gate's step-3 flush awaits.

Version handshake: closes the "backend-only deploy raises no update prompt" gap
(no new service worker is produced by a backend deploy). X-App-Version must
survive every response, including auth rejections (mirrors the T4900 CORS
lesson: control/error responses must not silently drop guarantees other
responses carry).

Flush-verify: a POST (WRITE method) is deliberately used with NO writes of its
own, so RequestContextMiddleware's existing pending-sync retry (T930/T1150,
db_sync.py `_sync_aware_flow`) runs BEFORE the handler and is the thing that
actually confirms/clears a previously-deferred fire-and-forget sync (the 0.5s
upload-lock defer window, T3250). These tests drive the REAL middleware via
httpx.ASGITransport against an in-memory boto3-shaped R2 (reusing T4050's
FakeR2), so the retry + version-bump logic under test is production code.
"""

import asyncio
from contextlib import contextmanager
from unittest.mock import patch

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER_ID = "t5070flush"
PROFILE_ID = "abcd5070"
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}

VERSION_URL = "/api/version"
FLUSH_VERIFY_URL = "/api/sync/flush-verify"


def _request(app, method, url, **kwargs):
    async def _run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            return await c.request(method, url, **kwargs)
    return asyncio.run(_run())


# ===========================================================================
# X-App-Version header + GET /api/version
# ===========================================================================

def test_app_version_header_present_on_success_response():
    from app.main import app
    resp = _request(app, "GET", VERSION_URL)
    assert resp.status_code == 200
    assert resp.headers.get("x-app-version"), "X-App-Version missing from a normal 200"


def test_app_version_header_survives_auth_rejection():
    """Mirrors T4900: control/error responses (here, the 401 from
    RequestContextMiddleware) must carry the SAME guarantees as success
    responses — a stale client hitting a protected route while logged out
    must still be able to detect a version mismatch."""
    from app.main import app
    resp = _request(app, "GET", "/api/export/projects/999999/overlay-data")
    assert resp.status_code in (401, 403), resp.text
    assert resp.headers.get("x-app-version"), "X-App-Version must survive auth rejections"


def test_get_version_works_unauthenticated():
    """No cookie, no X-User-ID — the handshake must work before login so a
    stale client sitting on the login screen still detects a mismatch."""
    from app.main import app
    resp = _request(app, "GET", VERSION_URL)
    assert resp.status_code == 200
    body = resp.json()
    assert "version" in body and body["version"]
    assert resp.headers.get("cache-control") == "no-store"


def test_app_version_reads_commit_sha_env_at_import(monkeypatch):
    monkeypatch.setenv("COMMIT_SHA", "abc123deadbeef")
    import importlib

    from app import version as version_module
    importlib.reload(version_module)
    try:
        assert version_module.APP_VERSION == "abc123deadbeef"
    finally:
        monkeypatch.delenv("COMMIT_SHA", raising=False)
        importlib.reload(version_module)


def test_app_version_falls_back_to_dev_without_commit_sha(monkeypatch):
    monkeypatch.delenv("COMMIT_SHA", raising=False)
    import importlib

    from app import version as version_module
    importlib.reload(version_module)
    assert version_module.APP_VERSION == "dev"


# ===========================================================================
# POST /api/sync/flush-verify — the update-gate step-3 barrier
# ===========================================================================

@contextmanager
def _request_context(user_id, profile_id):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    yield


@pytest.fixture()
def flush_env(tmp_path):
    """Real per-user profile.sqlite under tmp_path + in-memory R2, mirroring
    T4050's dur_env fixture."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.database import ensure_database, get_database_path, set_local_db_version
        from app.main import app

        with _request_context(USER_ID, PROFILE_ID):
            ensure_database()
            db_path = get_database_path()
            set_local_db_version(USER_ID, PROFILE_ID, 0)

        yield app, fake, db_path


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


@pytest.mark.asyncio
async def test_flush_verify_ok_when_nothing_pending(flush_env):
    """Clean session, nothing dirty: the barrier degrades to a cheap verify and
    returns 200 immediately — the ideal outcome per the design doc, since
    every committed edit is already surgically persisted."""
    app, fake, db_path = flush_env
    async with _client(app) as c:
        resp = await c.post(FLUSH_VERIFY_URL)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_flush_verify_confirms_and_clears_a_previously_deferred_sync(flush_env):
    """A prior fire-and-forget sync left the .sync_pending marker (the 0.5s
    defer window, T3250) and never actually uploaded. flush-verify's POST
    triggers the middleware's pending-sync retry BEFORE the handler runs; R2
    is healthy, so the retry lands the upload and the handler sees no pending
    sync -> 200."""
    app, fake, db_path = flush_env
    from app.database import has_sync_pending, mark_sync_pending
    from app.storage import r2_key

    mark_sync_pending(USER_ID)
    assert has_sync_pending(USER_ID)

    async with _client(app) as c:
        resp = await c.post(FLUSH_VERIFY_URL)

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}
    assert not has_sync_pending(USER_ID), "marker should be cleared once the retry lands"
    with _request_context(USER_ID, PROFILE_ID):
        key = r2_key(USER_ID, "profile.sqlite")
    assert fake.has(key), "flush-verify's retry never actually uploaded to R2"


@pytest.mark.asyncio
async def test_flush_verify_503_when_sync_genuinely_failing(flush_env):
    """R2 is down: the retry-before-handler attempt fails, the marker stays,
    and flush-verify must return 503 sync_failed/retryable — never a lying
    200 that would let the update gate proceed to the destructive cache
    flush with unsynced state."""
    app, fake, db_path = flush_env
    from app.database import has_sync_pending, mark_sync_pending

    mark_sync_pending(USER_ID)
    fake.fail_profile_upload = True

    async with _client(app) as c:
        resp = await c.post(FLUSH_VERIFY_URL)

    assert resp.status_code == 503, resp.text
    body = resp.json()["detail"]
    assert body["code"] == "sync_failed"
    assert body["retryable"] is True
    assert has_sync_pending(USER_ID), "marker must remain set — the failure is real"


@pytest.mark.asyncio
async def test_flush_verify_requires_auth():
    from app.main import app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as c:
        resp = await c.post(FLUSH_VERIFY_URL)
    assert resp.status_code == 401
