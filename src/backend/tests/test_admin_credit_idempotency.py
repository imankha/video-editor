"""HTTP-layer idempotency for admin credit grants (T5840 AC).

Real Postgres via `pg_conn` + a real TestClient -- these prove the idempotency
guarantee end-to-end through the router, not just at the credit_ledger unit
level (test_credit_ledger.py covers that layer).
"""

from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture()
def admin_env(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("target-user", email="target@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    yield


@pytest.fixture()
def client(admin_env):
    from app.main import app
    yield TestClient(app, raise_server_exceptions=True)


def _admin():
    return {"X-User-ID": "admin-user"}


class TestSingleGrantIdempotency:
    def test_same_request_id_twice_grants_once(self, client):
        r1 = client.post(
            "/api/admin/users/target-user/grant-credits",
            json={"amount": 500, "request_id": "req-abc"},
            headers=_admin(),
        )
        assert r1.status_code == 200
        assert r1.json()["balance"] == 500
        assert r1.json()["applied"] is True

        r2 = client.post(
            "/api/admin/users/target-user/grant-credits",
            json={"amount": 500, "request_id": "req-abc"},
            headers=_admin(),
        )
        assert r2.status_code == 200
        assert r2.json()["balance"] == 500, "retry must not double-grant"
        assert r2.json()["applied"] is False, "M3: retry must report applied=False, not read as a fresh grant"

        balance = client.get("/api/admin/users?page_size=50", headers=_admin())
        row = next(u for u in balance.json()["users"] if u["user_id"] == "target-user")
        assert row["credits"] == 500

    def test_different_request_id_grants_again(self, client):
        client.post(
            "/api/admin/users/target-user/grant-credits",
            json={"amount": 500, "request_id": "req-1"},
            headers=_admin(),
        )
        r2 = client.post(
            "/api/admin/users/target-user/grant-credits",
            json={"amount": 500, "request_id": "req-2"},
            headers=_admin(),
        )
        assert r2.json()["balance"] == 1000, "a genuinely new request_id is a real second grant"

    def test_failure_after_commit_then_retry_does_not_double_grant(self, client):
        """Simulates a durability failure AFTER the ledger write has already
        committed (e.g. the connection drops before the response is sent).
        This is the AC that was structurally impossible before T5840: admin_grant
        can now safely 503 because the retry is idempotent on request_id."""
        from app.routers import admin as admin_router
        from app.services import credit_ledger

        real_grant = credit_ledger.grant

        def _grant_then_fail(*args, **kwargs):
            real_grant(*args, **kwargs)  # the write DOES commit
            raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True})

        with patch.object(admin_router.credit_ledger, "grant", side_effect=_grant_then_fail):
            r1 = client.post(
                "/api/admin/users/target-user/grant-credits",
                json={"amount": 777, "request_id": "req-flaky"},
                headers=_admin(),
            )
        assert r1.status_code == 503

        # Retry with the SAME request_id, now against the real (unpatched) grant.
        r2 = client.post(
            "/api/admin/users/target-user/grant-credits",
            json={"amount": 777, "request_id": "req-flaky"},
            headers=_admin(),
        )
        assert r2.status_code == 200
        assert r2.json()["balance"] == 777, "the committed grant from the failed response must not double-apply"


class TestSetCreditsIdempotency:
    def test_same_request_id_twice_sets_once(self, client):
        r1 = client.post(
            "/api/admin/users/target-user/set-credits",
            json={"amount": 42, "request_id": "set-req-1"},
            headers=_admin(),
        )
        assert r1.json()["balance"] == 42
        assert r1.json()["applied"] is True

        r2 = client.post(
            "/api/admin/users/target-user/set-credits",
            json={"amount": 42, "request_id": "set-req-1"},
            headers=_admin(),
        )
        assert r2.json()["balance"] == 42
        assert r2.json()["applied"] is False, (
            "M3: the retry must report applied=False -- a 200 with applied "
            "unset/True would read as a fresh change that didn't happen"
        )

    def test_same_request_id_differing_amount_is_refused_not_reinterpreted(self, client):
        """M3 gap the reviewer called out: a reused key with a DIFFERENT
        target amount must not silently apply the new amount OR silently
        report the old one as if it just succeeded -- applied must be False
        and the balance must stay at whatever the first call set."""
        r1 = client.post(
            "/api/admin/users/target-user/set-credits",
            json={"amount": 42, "request_id": "set-req-reused"},
            headers=_admin(),
        )
        assert r1.json() == {"balance": 42, "applied": True}

        r2 = client.post(
            "/api/admin/users/target-user/set-credits",
            json={"amount": 999, "request_id": "set-req-reused"},
            headers=_admin(),
        )
        assert r2.json()["applied"] is False
        assert r2.json()["balance"] == 42, "must NOT silently jump to 999 under a reused key"
