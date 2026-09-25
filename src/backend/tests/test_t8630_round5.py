"""T8630 round 5 -- FAILING-first tests for the blocking bug the proof verifier
reproduced at cffafbaa:

The default admin view (exclude_test unset/true) DROPPED a deleted payer's
revenue into Unattributed instead of keeping it attributed to their real
channel/cohort. Root cause: the test-exclusion join
(`JOIN users u ON u.user_id = s.user_id` + `NOT u.is_test_account`) was an INNER
join, so a deleted account -- whose de-identified `user_segments` row is KEPT
(round 4) but whose `users` row is gone -- fell out of every exclude_test view.

The fix snapshots `is_test_account` onto `user_segments.was_test_account` at
deletion time (v033) and changes every exclude_test site to
`LEFT JOIN users u ... WHERE NOT COALESCE(u.is_test_account, s.was_test_account,
false)`, so a deleted payer keeps the exact exclusion status it had while live.

These tests go through the REAL admin FastAPI endpoints (TestClient) and drive
the REAL deletion path (privacy.delete_account) for the write -- NOT a private
re-implementation of the aggregate (that is exactly what let round 4 miss this).
The deletion path snapshots was_test_account; the endpoints read it back.

RED against the merge base 5bdc1dbf (pre-fix): the deleted REAL payer's revenue
shows as Unattributed (INNER join drops the segment) and the deleted TEST payer's
revenue LEAKS into the grand total (the users-anti-join no longer recognises it
once the users row is gone). GREEN after the fix.

TEST DATABASE: pg-backed via the shared `pg_conn` fixture, which TRUNCATEs. Run
only against the throwaway DSN (round 5 used `t8630_test5`), never the host dev
DB. Stripe env stays unset.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services.auth_db import create_user

# Origins the tests fully control, so a payer's money can be isolated to one
# bucket regardless of any other rows the environment might carry.
_ORIGIN_REAL = "rb_r5_real_channel"
_ORIGIN_TEST = "rb_r5_test_channel"
_ORIGIN_LIVE = "rb_r5_live_channel"


# --------------------------------------------------------------------------- #
# Seeding helpers (direct ledger/segment inserts, mirroring test_t8650)
# --------------------------------------------------------------------------- #

def _make_admin():
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )


def _seed_payment(user_id, amount_cents, *, obj_id, kind="purchase"):
    from datetime import UTC, datetime

    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            """
            INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                                  occurred_at, source)
            VALUES (%s,%s,%s,'usd',%s,%s,'backfill')
            """,
            (user_id, kind, amount_cents, obj_id, datetime.now(UTC)),
        )


def _mark_test_account(user_id, is_test=True):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE users SET is_test_account = %s WHERE user_id = %s", (is_test, user_id)
        )


def _seg(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
        return cur.fetchone()


def _seed_payer(user_id, origin, amount_cents, *, obj_id, is_test=False):
    """A payer with a segment (real channel) and a ledger row."""
    create_user(user_id, email=f"{user_id}@test.local")
    create_user_segment(user_id, origin, None, "otp")
    if is_test:
        _mark_test_account(user_id, True)
    _seed_payment(user_id, amount_cents, obj_id=obj_id)


def _delete_via_privacy(user_id, monkeypatch):
    """Drive the REAL account-deletion path so the production code -- not the test
    -- de-identifies the segment and snapshots was_test_account, then removes the
    users row. Storage purge is stubbed (no R2 in tests), exactly as round 4."""
    from app.routers import privacy as privacy_mod
    monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
    monkeypatch.setattr(
        "app.routers.auth._purge_user_data",
        lambda uid: {"local_deleted": False, "r2_objects_deleted": 0},
    )

    class _FakeRequest:
        pass

    asyncio.run(privacy_mod.delete_account(_FakeRequest()))


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture(autouse=True)
def _isolate_users(pg_conn):
    """Snapshot the user set and drop anything the test created afterward, so
    seed ids can't collide across tests (pg_conn keeps the `users` table)."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users")
        before = {r["user_id"] for r in cur.fetchall()}
    yield
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users")
        new = list({r["user_id"] for r in cur.fetchall()} - before)
        # user_segments outlives the users row now, so clean by the test origins
        # regardless of whether the users row still exists.
        cur.execute(
            "DELETE FROM user_segments WHERE origin IN (%s,%s,%s)",
            (_ORIGIN_REAL, _ORIGIN_TEST, _ORIGIN_LIVE),
        )
        if new:
            cur.execute("DELETE FROM user_actions WHERE user_id = ANY(%s)", (new,))
            cur.execute("DELETE FROM users WHERE user_id = ANY(%s)", (new,))


@pytest.fixture()
def client(pg_conn, tmp_path):
    _make_admin()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth():
    return {"X-User-ID": "admin-user"}


def _channels(client, exclude_test=None):
    q = "" if exclude_test is None else f"?exclude_test={'true' if exclude_test else 'false'}"
    resp = client.get(f"/api/admin/analytics/channels{q}", headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _bucket_revenue(payload, origin):
    for row in payload["channels"]:
        if row["origin"] == origin:
            return row["revenue_cents"]
    return 0


# --------------------------------------------------------------------------- #
# 1. A deleted REAL payer stays attributed to their channel in the DEFAULT view
# --------------------------------------------------------------------------- #

class TestDeletedRealPayerStaysAttributed:
    def test_default_view_keeps_deleted_real_payer_in_their_channel(self, client, monkeypatch):
        _seed_payer("r5-real-payer", _ORIGIN_REAL, 733, obj_id="pi_r5_real")
        _delete_via_privacy("r5-real-payer", monkeypatch)

        # The production deletion path must have snapshotted is_test_account=false.
        seg = _seg("r5-real-payer")
        assert seg is not None, "deleted real payer keeps its de-identified segment row"
        assert seg["was_test_account"] is False, "was_test_account snapshotted at deletion"

        # DEFAULT view (exclude_test unset -> true): the money stays in the real
        # channel bucket and NONE of it lands in Unattributed.
        payload = _channels(client)
        assert _bucket_revenue(payload, _ORIGIN_REAL) == 733, (
            "deleted real payer's revenue must stay attributed to their channel, "
            "not drop out of the default (exclude_test) view"
        )
        assert payload["unattributed_revenue_cents"] == 0, (
            "no part of the deleted real payer's money may leak into Unattributed"
        )


# --------------------------------------------------------------------------- #
# 2. A deleted TEST payer is EXCLUDED from the default view (no leak), visible
#    only with exclude_test=false
# --------------------------------------------------------------------------- #

class TestDeletedTestPayerExcluded:
    def test_default_view_excludes_deleted_test_payer(self, client, monkeypatch):
        _seed_payer("r5-test-payer", _ORIGIN_TEST, 911, obj_id="pi_r5_test", is_test=True)
        _delete_via_privacy("r5-test-payer", monkeypatch)

        seg = _seg("r5-test-payer")
        assert seg is not None and seg["was_test_account"] is True, (
            "deleted test payer's segment keeps was_test_account=true snapshot"
        )

        # DEFAULT view: the test payer's money is excluded EVERYWHERE -- not in a
        # bucket and not in the grand total, so it cannot leak into Unattributed.
        payload = _channels(client)
        assert _bucket_revenue(payload, _ORIGIN_TEST) == 0, (
            "deleted test payer must not appear in a real channel bucket"
        )
        assert payload["unattributed_revenue_cents"] == 0, (
            "deleted test payer's money must not leak into Unattributed real revenue"
        )

    def test_include_test_view_shows_deleted_test_payer(self, client, monkeypatch):
        _seed_payer("r5-test-payer", _ORIGIN_TEST, 911, obj_id="pi_r5_test", is_test=True)
        _delete_via_privacy("r5-test-payer", monkeypatch)

        payload = _channels(client, exclude_test=False)
        assert _bucket_revenue(payload, _ORIGIN_TEST) == 911, (
            "with exclude_test=false the deleted test payer's revenue is visible "
            "in its channel"
        )


# --------------------------------------------------------------------------- #
# 3. attributed + unattributed == grand total, with deleted real + test payers
# --------------------------------------------------------------------------- #

class TestReconciliationInvariant:
    def _seed_mixed(self, monkeypatch):
        # A live real payer, a deleted real payer, and a deleted test payer.
        _seed_payer("r5-live", _ORIGIN_LIVE, 500, obj_id="pi_r5_live")
        _seed_payer("r5-real2", _ORIGIN_REAL, 250, obj_id="pi_r5_real2")
        _seed_payer("r5-test2", _ORIGIN_TEST, 999, obj_id="pi_r5_test2", is_test=True)
        _delete_via_privacy("r5-real2", monkeypatch)
        _delete_via_privacy("r5-test2", monkeypatch)

    def test_invariant_default_view(self, client, monkeypatch):
        self._seed_mixed(monkeypatch)
        payload = _channels(client)  # default: exclude_test true
        attributed = sum(c["revenue_cents"] for c in payload["channels"])
        unattributed = payload["unattributed_revenue_cents"]
        # Grand total in the default view = real payers only (live 500 + deleted
        # real 250); the deleted test payer (999) is excluded entirely.
        assert attributed + unattributed == 500 + 250, (
            "attributed + unattributed must equal the exclude_test grand total"
        )
        # And specifically the deleted real payer is attributed, not stranded.
        assert _bucket_revenue(payload, _ORIGIN_REAL) == 250
        assert unattributed == 0

    def test_invariant_include_test_view(self, client, monkeypatch):
        self._seed_mixed(monkeypatch)
        payload = _channels(client, exclude_test=False)
        attributed = sum(c["revenue_cents"] for c in payload["channels"])
        unattributed = payload["unattributed_revenue_cents"]
        assert attributed + unattributed == 500 + 250 + 999, (
            "with test accounts included the grand total counts every payer"
        )
        assert unattributed == 0


# --------------------------------------------------------------------------- #
# 4. Regression guard: a deleted user never appears in the admin user list
# --------------------------------------------------------------------------- #

class TestUserListExcludesDeleted:
    def test_deleted_user_absent_from_admin_user_list(self, client, monkeypatch):
        _seed_payer("r5-listed", _ORIGIN_REAL, 100, obj_id="pi_r5_listed")
        _delete_via_privacy("r5-listed", monkeypatch)

        resp = client.get("/api/admin/users?exclude_test=true", headers=_auth())
        assert resp.status_code == 200, resp.text
        emails = {u["email"] for u in resp.json()["users"]}
        assert "r5-listed@test.local" not in emails, (
            "a deleted user must never resurface in the users-anchored admin list, "
            "even though its de-identified segment row survives"
        )
        assert _seg("r5-listed") is not None
