"""Tests for POST /api/admin/credits/open-gate (BLOCKING-2, M7).

`no_user_db` is the expected, permanent state for purged/guest/never-synced
accounts -- with real (unbounded) enumeration it is essentially guaranteed to
appear, so it must never block the gate. Other flags/deltas block unless
explicitly acknowledged or force-opened.

M7: the gate consumes the STORED report (credit_migration_state.last_report)
from the most recent full GET /credits/backfill-report call instead of
recomputing -- these tests patch `credit_backfill.load_last_report`, not
`run_backfill`. Real Postgres via pg_conn.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def admin_env(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
        # Gate starts closed for these tests (pg_conn opens it by default).
        cur.execute("UPDATE credit_migration_state SET ready_at = NULL WHERE id = 1")
    from app.services.credit_ledger import reset_ready_cache_for_tests
    reset_ready_cache_for_tests()
    yield
    reset_ready_cache_for_tests()


@pytest.fixture()
def client(admin_env):
    from app.main import app
    yield TestClient(app, raise_server_exceptions=True)


def _admin():
    return {"X-User-ID": "admin-user"}


def _row(user_id, status="ok", flags=None, delta=0):
    return {"user_id": user_id, "status": status, "flags": flags or [], "delta": delta}


def _stored(rows, age_seconds=0):
    return {
        "report": {"rows": rows, "summary": {"total_users": len(rows)}},
        "generated_at": datetime.now(UTC) - timedelta(seconds=age_seconds),
    }


def _patch_report(rows, age_seconds=0):
    return patch("app.services.credit_backfill.load_last_report", return_value=_stored(rows, age_seconds))


class TestNoStoredReport:
    def test_no_report_on_file_is_refused(self, client):
        """M7: never silently falls back to computing one inline."""
        with patch("app.services.credit_backfill.load_last_report", return_value=None):
            resp = client.post("/api/admin/credits/open-gate", json={}, headers=_admin())

        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "no_report"


class TestStoredReportFreshness:
    def test_stale_report_is_refused(self, client):
        with _patch_report([_row("clean-user")], age_seconds=3600):
            resp = client.post("/api/admin/credits/open-gate", json={}, headers=_admin())

        assert resp.status_code == 409
        assert resp.json()["detail"]["error"] == "stale_report"

    def test_stale_report_opens_with_force(self, client):
        with _patch_report([_row("clean-user")], age_seconds=3600):
            resp = client.post(
                "/api/admin/credits/open-gate", json={"force": True}, headers=_admin(),
            )

        assert resp.status_code == 200, resp.text

    def test_fresh_report_is_accepted(self, client):
        with _patch_report([_row("clean-user")], age_seconds=60):
            resp = client.post("/api/admin/credits/open-gate", json={}, headers=_admin())

        assert resp.status_code == 200, resp.text


class TestNoUserDbNeverBlocks:
    def test_only_no_user_db_rows_open_the_gate(self, client):
        rows = [
            _row("ghost-1", status="no_user_db", flags=["no_user_db"]),
            _row("ghost-2", status="no_user_db", flags=["no_user_db"]),
            _row("clean-user"),
        ]
        with _patch_report(rows):
            resp = client.post("/api/admin/credits/open-gate", json={}, headers=_admin())

        assert resp.status_code == 200, resp.text
        assert resp.json()["opened"] is True


class TestOtherFlagsBlock:
    def test_divergent_flag_blocks_without_acknowledgement(self, client):
        with _patch_report([_row("weird-user", flags=["divergent"])]):
            resp = client.post("/api/admin/credits/open-gate", json={}, headers=_admin())

        assert resp.status_code == 409
        assert resp.json()["detail"]["anomalous_count"] == 1
        assert "weird-user" in resp.json()["detail"]["anomalous_user_ids"]

    def test_acknowledging_the_flag_opens_the_gate(self, client):
        with _patch_report([_row("weird-user", flags=["divergent"])]):
            resp = client.post(
                "/api/admin/credits/open-gate",
                json={"acknowledge_flags": ["divergent"]},
                headers=_admin(),
            )

        assert resp.status_code == 200, resp.text

    def test_acknowledging_a_different_flag_still_blocks(self, client):
        with _patch_report([_row("weird-user", flags=["divergent", "ledger_mismatch"])]):
            resp = client.post(
                "/api/admin/credits/open-gate",
                json={"acknowledge_flags": ["divergent"]},
                headers=_admin(),
            )

        assert resp.status_code == 409, "ledger_mismatch was not acknowledged"

    def test_nonzero_delta_blocks_even_with_flags_acknowledged(self, client):
        """A nonzero delta means real unapplied work -- acknowledging flags
        must not paper over it; only force can."""
        with _patch_report([_row("pending-user", flags=["divergent"], delta=5)]):
            resp = client.post(
                "/api/admin/credits/open-gate",
                json={"acknowledge_flags": ["divergent"]},
                headers=_admin(),
            )

        assert resp.status_code == 409

    def test_force_opens_despite_unresolved_anomalies(self, client, caplog):
        with _patch_report([_row("weird-user", flags=["divergent"], delta=5)]):
            resp = client.post(
                "/api/admin/credits/open-gate", json={"force": True}, headers=_admin(),
            )

        assert resp.status_code == 200, resp.text
        assert any("FORCE-opened" in r.message for r in caplog.records)


class TestNonAdminRejected:
    def test_non_admin_gets_403(self, client):
        from app.services.auth_db import create_user
        create_user("regular-user", email="reg@test.local")
        resp = client.post(
            "/api/admin/credits/open-gate", json={}, headers={"X-User-ID": "regular-user"},
        )
        assert resp.status_code == 403
