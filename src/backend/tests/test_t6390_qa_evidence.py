"""T6390 QA evidence — the diagnostics are end-to-end observable.

R2 is disabled in the container and a true CAS conflict needs real R2 content on
staging, so this drives the REAL ASGI app + storage.py against the in-memory
FakeR2 (exactly the code the deployed app runs) to prove, in one place, every
acceptance criterion that does not require a browser:

  * the SERVER [SYNC_CONFLICT] CRITICAL names req_id + method + path + writer + reason;
  * loaded=None (unconfirmed) and loaded=vN (stale) produce DIFFERENT reasons;
  * the X-Sync-Diag response header is present on a conflict response AND is listed
    in access-control-expose-headers, so a CROSS-ORIGIN browser can read it
    (same-origin dev hides this — the exact landmine the task calls out).

The browser-console half (checkSyncStatus logging, no-spam, retry outcomes) is
covered by src/frontend/src/stores/syncStore.test.js.
"""

import logging

from unittest.mock import patch

import httpx
import pytest

from app.database import mark_sync_conflict, set_local_db_version, sync_db_to_r2_explicit
from app.storage import profile_r2_key
from app.user_context import set_current_method, set_current_path, set_current_req_id
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "t6390qa"
PROFILE = "abcd6390"
HEADERS = {"X-User-ID": USER, "X-Profile-ID": PROFILE, "X-Request-ID": "reqQA001"}


def _make_profile_db(base):
    import sqlite3

    from tests.conftest import stamp_schema_head
    d = base / USER / "profiles" / PROFILE
    d.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(d / "profile.sqlite"))
    conn.execute("CREATE TABLE marker (who TEXT)")
    # T5083: stamp head so the JIT load-seam (now firing on every
    # ensure_database first access) treats this marker-only fixture as
    # already-migrated and no-ops — see stamp_schema_head's docstring.
    stamp_schema_head(conn, "profile_db")
    conn.commit()
    conn.close()


def test_server_log_names_reqid_method_path_writer(tmp_path, caplog):
    """ACCEPTANCE: the server line for a CAS refusal carries req_id + method + path
    and identifies the writer that moved R2 ahead."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
        _make_profile_db(tmp_path)
        # R2 moved ahead to v9, stamped by another machine's request.
        fake._objects[profile_r2_key(USER, PROFILE, "profile.sqlite")] = {
            "data": b"NEWER",
            "metadata": {"db-version": "9", "db-writer": "misty-snow-4472/req0042",
                         "db-written-at": "2026-08-03T01:15:00Z"},
        }
        set_local_db_version(USER, PROFILE, 3)
        # Simulate the request context the middleware would have set.
        set_current_req_id("reqABCD")
        set_current_method("POST")
        set_current_path("/api/clips/raw/save")

        with caplog.at_level(logging.CRITICAL):
            sync_db_to_r2_explicit(USER, PROFILE)

    line = next(r.message for r in caplog.records if "[SYNC_CONFLICT]" in r.message)
    print("\n[EVIDENCE server log]\n" + line)
    for token in ("req_id=reqABCD", "method=POST", "path=/api/clips/raw/save",
                  "writer=misty-snow-4472/req0042", "reason=stale_baseline",
                  "loaded=v3", "r2=v9"):
        assert token in line, f"missing {token!r} in the server line"


def test_unconfirmed_vs_stale_produce_different_reasons(tmp_path, caplog):
    """ACCEPTANCE: loaded=None (unconfirmed) and loaded=vN (stale) render as
    DIFFERENT reasons — server side (the client side is pinned in syncStore.test.js)."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
        _make_profile_db(tmp_path)
        fake._objects[profile_r2_key(USER, PROFILE, "profile.sqlite")] = {
            "data": b"NEWER", "metadata": {"db-version": "9"}}

        set_local_db_version(USER, PROFILE, None)  # unconfirmed
        set_current_req_id("reqU"); set_current_method("POST"); set_current_path("/p")
        with caplog.at_level(logging.CRITICAL):
            sync_db_to_r2_explicit(USER, PROFILE)
        unconfirmed = next(r.message for r in caplog.records if "[SYNC_CONFLICT]" in r.message)
        caplog.clear()

        set_local_db_version(USER, PROFILE, 3)  # stale
        with caplog.at_level(logging.CRITICAL):
            sync_db_to_r2_explicit(USER, PROFILE)
        stale = next(r.message for r in caplog.records if "[SYNC_CONFLICT]" in r.message)

    print(f"\n[EVIDENCE unconfirmed] {unconfirmed}\n[EVIDENCE stale] {stale}")
    assert "reason=unconfirmed_baseline" in unconfirmed and "loaded=vNone" in unconfirmed
    assert "reason=stale_baseline" in stale and "loaded=v3" in stale


@pytest.mark.asyncio
async def test_x_sync_diag_header_present_and_cross_origin_readable(tmp_path):
    """ACCEPTANCE: X-Sync-Diag is present on a conflict response AND is exposed
    cross-origin (listed in access-control-expose-headers) so the deployed
    (different-origin) frontend can actually read it from JS."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _r2_patched(fake):
        from app.main import app

        _make_profile_db(tmp_path)
        # A live conflict marker with a full diag payload (as the sync path writes it).
        mark_sync_conflict(USER, scope=PROFILE, diag={
            "reason": "stale_baseline", "db": "profile", "profile_id": PROFILE,
            "loaded": 3, "r2": 9, "machine": "misty-snow-4472",
            "req_id": "reqABCD", "method": "POST", "path": "/api/clips/raw/save",
            "writer": "misty-snow-4472/req0042", "written_at": "2026-08-03T01:15:00Z",
        })

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # A CROSS-ORIGIN request: Origin differs from the API host.
            resp = await client.get(
                "/api/health/sync-status" if False else "/api/version",
                headers={**HEADERS, "Origin": "https://app.reelballers.com"},
            )
            # /api/version skips sync; use a per-user route that runs the sync middleware.
            resp = await client.get(
                "/api/quests/progress",
                headers={**HEADERS, "Origin": "https://app.reelballers.com"},
            )

    print("\n[EVIDENCE headers]", dict(resp.headers))
    assert resp.headers.get("X-Sync-Status") == "conflict"
    diag = resp.headers.get("X-Sync-Diag")
    assert diag, "X-Sync-Diag header must be present on a conflict response"
    assert "reason=stale_baseline" in diag
    assert "req_id=reqABCD" in diag
    assert "writer=misty-snow-4472/req0042" in diag
    # Cross-origin readability: the browser only exposes headers listed here.
    exposed = resp.headers.get("access-control-expose-headers", "")
    assert "X-Sync-Diag" in exposed, \
        "X-Sync-Diag MUST be in expose_headers or the cross-origin client can't read it"
