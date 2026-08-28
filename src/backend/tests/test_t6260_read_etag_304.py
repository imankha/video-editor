"""T6260 — boot-set read endpoints emit a content-hash ETag and answer 304.

Background: every JSON read endpoint responded `Cache-Control: private, no-cache,
stale-while-revalidate` with NO ETag/Last-Modified. `no-cache` means "revalidate
before reuse", but with no validator there is nothing to revalidate WITH — the
browser can never send `If-None-Match` and the server can never answer 304, so
every repeat load re-sends the whole body.

Fix (middleware chokepoint, `_apply_read_etag` in db_sync.py): the boot-set reads
(`/api/profiles|projects|games|settings|downloads|downloads/count`) now carry a
strong content-hash ETag. An unchanged repeat request revalidates to a bodiless
304; a request whose data changed gets a fresh 200 with a NEW ETag (never a stale
304). They stay `private, no-cache` — the ETag is a validator, NOT a stale-serving
`max-age`/SWR window, so a user never sees their own just-saved edit revert.

These drive the REAL RequestContextMiddleware with R2 disabled at the network
level (no writes on a GET ⇒ no sync) but `R2_ENABLED` patched True so reads route
through `_sync_aware_flow` where the header logic lives, exactly as in prod.
"""
import asyncio
from unittest.mock import patch

import httpx
from fastapi import FastAPI

import app.session_init as _session_init
from app.middleware import RequestContextMiddleware

PROFILE_ID = "abcdef01"  # 8 hex chars: passes the middleware format guard
DEFAULT_JSON_CACHE = "private, no-cache, stale-while-revalidate=5"
ETAG_CACHE = "private, no-cache"

# Mutable payload the boot-set route serves, so a test can change it and prove the
# ETag moves (no stale 304 after a mutation).
_SETTINGS_STATE = {"theme": "dark"}


def _make_app():
    """Minimal app carrying the REAL middleware. One boot-set path (`/api/settings`)
    and one ordinary JSON read (`/api/other`, NOT in the ETag allowlist)."""
    probe = FastAPI()

    @probe.get("/api/settings")
    async def _settings():
        return dict(_SETTINGS_STATE)

    @probe.get("/api/other")
    async def _other():
        return {"ok": True}

    probe.add_middleware(RequestContextMiddleware)
    return probe


def _client():
    transport = httpx.ASGITransport(app=_make_app())
    # X-User-ID sets user context without a session (APP_ENV != production in tests);
    # a valid X-Profile-ID skips session_init. peek_registered_profile_ids is patched
    # per-test so the ownership guard passes without touching user.sqlite/R2.
    return httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
        headers={"X-User-ID": "t6260-user", "X-Profile-ID": PROFILE_ID},
    )


def _run(coro):
    with patch("app.middleware.db_sync.R2_ENABLED", True), \
         patch.object(_session_init, "peek_registered_profile_ids",
                      return_value={PROFILE_ID}):
        return asyncio.run(coro)


def test_boot_set_read_emits_strong_etag():
    async def scenario():
        async with _client() as c:
            r = await c.get("/api/settings")
        return r

    r = _run(scenario())
    assert r.status_code == 200
    etag = r.headers.get("etag")
    assert etag and etag.startswith('"') and etag.endswith('"'), f"no strong ETag: {etag!r}"
    # Validator, not a stale window: private, no-cache (no max-age / SWR).
    assert r.headers["cache-control"] == ETAG_CACHE
    # Body survived the middleware's buffer-and-re-emit intact.
    assert r.json() == {"theme": "dark"}


def test_matching_if_none_match_returns_bodiless_304():
    async def scenario():
        async with _client() as c:
            first = await c.get("/api/settings")
            etag = first.headers["etag"]
            second = await c.get("/api/settings", headers={"If-None-Match": etag})
        return etag, second

    etag, r = _run(scenario())
    assert r.status_code == 304
    assert r.content == b"", "304 must have an empty body"
    assert r.headers.get("etag") == etag
    assert r.headers["cache-control"] == ETAG_CACHE
    assert "content-length" not in r.headers or r.headers["content-length"] == "0"


def test_wildcard_if_none_match_returns_304():
    async def scenario():
        async with _client() as c:
            r = await c.get("/api/settings", headers={"If-None-Match": "*"})
        return r

    r = _run(scenario())
    assert r.status_code == 304
    assert r.content == b""


def test_mutation_moves_etag_no_stale_304():
    """The critical negative check: after the data changes, a request carrying the
    OLD ETag must get a FRESH 200 with the NEW value — never a stale 304."""
    async def scenario():
        async with _client() as c:
            first = await c.get("/api/settings")
            old_etag = first.headers["etag"]
            _SETTINGS_STATE["theme"] = "light"  # user edits their setting
            revalidated = await c.get("/api/settings",
                                      headers={"If-None-Match": old_etag})
        return old_etag, revalidated

    try:
        old_etag, r = _run(scenario())
        assert r.status_code == 200, "stale 304 served after a mutation!"
        assert r.json() == {"theme": "light"}
        assert r.headers["etag"] != old_etag, "ETag did not move after the body changed"
    finally:
        _SETTINGS_STATE["theme"] = "dark"


def test_stable_etag_across_repeat_reads():
    """Same unchanged body ⇒ same ETag (content hash is deterministic)."""
    async def scenario():
        async with _client() as c:
            a = await c.get("/api/settings")
            b = await c.get("/api/settings")
        return a, b

    a, b = _run(scenario())
    assert a.headers["etag"] == b.headers["etag"]


def test_non_boot_set_json_keeps_default_and_no_etag():
    """A JSON read outside the allowlist is untouched: default SWR Cache-Control,
    no ETag, no 304 — scope is boot-set-only per the task sequencing."""
    async def scenario():
        async with _client() as c:
            first = await c.get("/api/other")
            # Even if a client fabricates an If-None-Match, a non-allowlisted path
            # never 304s (it has no server-side validator).
            second = await c.get("/api/other", headers={"If-None-Match": '"whatever"'})
        return first, second

    first, second = _run(scenario())
    assert first.status_code == 200
    assert "etag" not in first.headers
    assert first.headers["cache-control"] == DEFAULT_JSON_CACHE
    assert second.status_code == 200
