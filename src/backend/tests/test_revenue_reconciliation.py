"""Tests for Stripe revenue reconciliation (T5760).

Two layers:
1. Pure classifier over MOCKED Stripe data (no env, no network) — refund, lost
   dispute, won-dispute-not-subtracted, test_mode_era, unknown, multi-PI summation,
   open-dispute pending.
2. Admin endpoints + charge.refunded webhook branch (Postgres via pg_conn, Stripe
   patched) — auth gating, report shape, heal sets local to Stripe net, refund
   decrements at refund time, and the main user-table path makes zero Stripe calls.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.services.revenue_reconciliation import (
    DriftCause,
    build_stripe_net_by_user,
    classify_users,
)

# ---------------------------------------------------------------------------
# Fixture builders (plain dicts — StripeObject subclasses dict, so the pure
# functions read them identically to live responses)
# ---------------------------------------------------------------------------

def make_pi(user_id, captured, refunded=0, dispute=None, *, status="succeeded",
            created=1690000000, pi_id="pi_test"):
    charge = {
        "amount_captured": captured,
        "amount_refunded": refunded,
        "disputed": bool(dispute),
        "dispute": dispute,
    }
    return {
        "id": pi_id,
        "status": status,
        "metadata": {"user_id": user_id},
        "amount_received": captured,
        "created": created,
        "latest_charge": charge,
    }


def _row_for(rows, user_id):
    return next(r for r in rows if r["user_id"] == user_id)


# ---------------------------------------------------------------------------
# Pure classifier
# ---------------------------------------------------------------------------

class TestStripeNetBuilder:
    def test_refund_reduces_net(self):
        agg = build_stripe_net_by_user([make_pi("u1", 699, refunded=300)])
        assert agg["u1"]["gross_cents"] == 699
        assert agg["u1"]["refunded_cents"] == 300
        assert agg["u1"]["net_cents"] == 399

    def test_lost_dispute_subtracted(self):
        dispute = {"status": "lost", "amount": 399}
        agg = build_stripe_net_by_user([make_pi("u1", 399, dispute=dispute)])
        assert agg["u1"]["disputed_lost_cents"] == 399
        assert agg["u1"]["net_cents"] == 0

    def test_won_dispute_not_subtracted(self):
        dispute = {"status": "won", "amount": 399}
        agg = build_stripe_net_by_user([make_pi("u1", 399, dispute=dispute)])
        assert agg["u1"]["disputed_lost_cents"] == 0
        assert agg["u1"]["net_cents"] == 399
        assert agg["u1"]["has_pending_dispute"] is False

    def test_charge_refunded_dispute_not_double_subtracted(self):
        # A dispute resolved by refunding the charge sets BOTH amount_refunded and
        # the dispute amount for the same money. Must subtract it once, not twice.
        dispute = {"status": "charge_refunded", "amount": 699}
        agg = build_stripe_net_by_user([make_pi("u1", 699, refunded=699, dispute=dispute)])
        assert agg["u1"]["refunded_cents"] == 699
        assert agg["u1"]["disputed_lost_cents"] == 0  # netted against the refund
        assert agg["u1"]["net_cents"] == 0            # not -699

    def test_open_dispute_pending_not_subtracted(self):
        dispute = {"status": "warning_needs_response", "amount": 399}
        agg = build_stripe_net_by_user([make_pi("u1", 399, dispute=dispute)])
        assert agg["u1"]["disputed_lost_cents"] == 0
        assert agg["u1"]["net_cents"] == 399
        assert agg["u1"]["has_pending_dispute"] is True

    def test_multi_pi_summation(self):
        agg = build_stripe_net_by_user([
            make_pi("u1", 399, pi_id="pi_a", created=1),
            make_pi("u1", 699, pi_id="pi_b", created=2),
        ])
        assert agg["u1"]["pi_count"] == 2
        assert agg["u1"]["gross_cents"] == 1098
        assert agg["u1"]["net_cents"] == 1098
        assert agg["u1"]["latest_created"] == 2

    def test_non_succeeded_ignored(self):
        agg = build_stripe_net_by_user([make_pi("u1", 399, status="requires_payment_method")])
        assert "u1" not in agg

    def test_missing_user_id_skipped(self):
        pi = make_pi("u1", 399)
        pi["metadata"] = {}
        assert build_stripe_net_by_user([pi]) == {}


class TestClassifier:
    def test_aligned(self):
        agg = build_stripe_net_by_user([make_pi("u1", 399)])
        rows = classify_users({"u1": {"email": "a@x.com", "local_cents": 399}}, agg)
        r = _row_for(rows, "u1")
        assert r["cause"] == DriftCause.ALIGNED.value
        assert r["drifted"] is False
        assert r["delta_cents"] == 0

    def test_refund_cause(self):
        agg = build_stripe_net_by_user([make_pi("u1", 699, refunded=300)])
        rows = classify_users({"u1": {"email": None, "local_cents": 699}}, agg)
        r = _row_for(rows, "u1")
        assert r["cause"] == DriftCause.REFUND.value
        assert r["delta_cents"] == 300
        assert r["stripe_net_cents"] == 399

    def test_dispute_cause(self):
        agg = build_stripe_net_by_user([make_pi("u1", 399, dispute={"status": "lost", "amount": 399})])
        rows = classify_users({"u1": {"email": None, "local_cents": 399}}, agg)
        assert _row_for(rows, "u1")["cause"] == DriftCause.DISPUTE.value

    def test_test_mode_era_cause(self):
        # Local > 0 but zero live history -> pre-go-live test-mode noise.
        rows = classify_users({"u1": {"email": None, "local_cents": 999}}, {})
        r = _row_for(rows, "u1")
        assert r["cause"] == DriftCause.TEST_MODE_ERA.value
        assert r["stripe_net_cents"] == 0
        assert r["pi_count"] == 0

    def test_unknown_cause(self):
        # Drift with live history but no refund/dispute to explain it.
        agg = build_stripe_net_by_user([make_pi("u1", 399)])
        rows = classify_users({"u1": {"email": None, "local_cents": 699}}, agg)
        assert _row_for(rows, "u1")["cause"] == DriftCause.UNKNOWN.value

    def test_test_mode_era_wins_over_refund(self):
        # Zero live history dominates even if some refund figure exists elsewhere.
        rows = classify_users({"u1": {"email": None, "local_cents": 500}}, {})
        assert _row_for(rows, "u1")["cause"] == DriftCause.TEST_MODE_ERA.value

    def test_stripe_only_user_negative_delta(self):
        # Stripe has money but local is 0 (partial-fulfillment gap) -> unknown drift.
        agg = build_stripe_net_by_user([make_pi("u1", 399)])
        rows = classify_users({}, agg)
        r = _row_for(rows, "u1")
        assert r["local_cents"] == 0
        assert r["delta_cents"] == -399
        assert r["cause"] == DriftCause.UNKNOWN.value

    def test_drifted_sorted_first(self):
        agg = build_stripe_net_by_user([
            make_pi("aligned", 399, pi_id="pi_a"),
            make_pi("drift", 399, refunded=399, pi_id="pi_b"),
        ])
        local = {
            "aligned": {"email": None, "local_cents": 399},
            "drift": {"email": None, "local_cents": 399},
        }
        rows = classify_users(local, agg)
        assert rows[0]["user_id"] == "drift"


# ---------------------------------------------------------------------------
# Endpoint + webhook integration (Postgres + patched Stripe)
# ---------------------------------------------------------------------------

@pytest.fixture()
def admin_env(pg_conn):
    """Admin + three payer users with local total_spent_cents seeded."""
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("user-a", email="a@test.local")
    create_user("user-b", email="b@test.local")
    create_user("user-c", email="c@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
        cur.execute("""
            INSERT INTO user_segments (user_id, total_spent_cents) VALUES
                ('admin-user', 0), ('user-a', 699), ('user-b', 399), ('user-c', 999)
            ON CONFLICT (user_id) DO UPDATE SET total_spent_cents = EXCLUDED.total_spent_cents
        """)
    yield


@pytest.fixture()
def client(admin_env, tmp_path, monkeypatch):
    monkeypatch.setattr("stripe.api_key", "sk_test_dummy")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _admin(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _total_spent(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT total_spent_cents FROM user_segments WHERE user_id = %s", (user_id,))
        return cur.fetchone()["total_spent_cents"]


# user-a: refund (local 699, net 399). user-b: aligned (local 399, net 399).
# user-c: test_mode_era (local 999, no live history).
STRIPE_FIXTURE = [
    make_pi("user-a", 699, refunded=300, pi_id="pi_a"),
    make_pi("user-b", 399, pi_id="pi_b"),
]


class TestReconciliationEndpoint:
    def test_non_admin_rejected(self, client):
        resp = client.get("/api/admin/revenue-reconciliation", headers=_admin("user-a"))
        assert resp.status_code == 403

    def test_admin_gets_report(self, client):
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=STRIPE_FIXTURE):
            resp = client.get("/api/admin/revenue-reconciliation", headers=_admin())
        assert resp.status_code == 200
        data = resp.json()
        rows = {r["user_id"]: r for r in data["rows"]}

        assert rows["user-a"]["cause"] == "refund"
        assert rows["user-a"]["delta_cents"] == 300
        assert rows["user-a"]["stripe_net_cents"] == 399

        assert rows["user-b"]["cause"] == "aligned"
        assert rows["user-b"]["drifted"] is False

        assert rows["user-c"]["cause"] == "test_mode_era"
        assert rows["user-c"]["stripe_net_cents"] == 0

        assert data["summary"]["drifted_users"] == 2  # user-a + user-c
        assert data["go_live_date"] == "2026-07-22"

    def test_heal_single_user_sets_local_to_stripe_net(self, client):
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=STRIPE_FIXTURE):
            resp = client.post(
                "/api/admin/revenue-reconciliation/heal",
                json={"user_ids": ["user-a"]}, headers=_admin(),
            )
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["old_cents"] == 699
        assert result["new_cents"] == 399
        assert _total_spent("user-a") == 399
        # untouched
        assert _total_spent("user-b") == 399
        assert _total_spent("user-c") == 999

    def test_heal_all_drifted(self, client):
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=STRIPE_FIXTURE):
            resp = client.post(
                "/api/admin/revenue-reconciliation/heal",
                json={"all_drifted": True}, headers=_admin(),
            )
        assert resp.status_code == 200
        assert resp.json()["healed"] == 2
        assert _total_spent("user-a") == 399   # refund -> net
        assert _total_spent("user-c") == 0     # test_mode_era -> zero
        assert _total_spent("user-b") == 399   # aligned, unchanged

    def test_heal_requires_target(self, client):
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=STRIPE_FIXTURE):
            resp = client.post("/api/admin/revenue-reconciliation/heal", json={}, headers=_admin())
        assert resp.status_code == 400

    def test_heal_non_admin_rejected(self, client):
        resp = client.post(
            "/api/admin/revenue-reconciliation/heal",
            json={"user_ids": ["user-a"]}, headers=_admin("user-a"),
        )
        assert resp.status_code == 403


class TestUserTablePerfIsolation:
    def test_list_users_makes_zero_stripe_calls(self, client, query_counter):
        """Main admin user-table path must not touch Stripe (latency isolation)."""
        stripe_list = MagicMock(side_effect=AssertionError("Stripe called on list_users path"))
        with patch("stripe.PaymentIntent.list", stripe_list):
            resp = client.get("/api/admin/users", headers=_admin())
        assert resp.status_code == 200
        stripe_list.assert_not_called()
        # DB path unchanged: list_users stays well under any N+1 threshold.
        assert len(query_counter.selects) < 50


class _FakeRefundList:
    """Mimics stripe.Refund.list's return: an object with .auto_paging_iter()."""
    def __init__(self, items):
        self._items = items

    def auto_paging_iter(self):
        return iter(self._items)


class TestChargeRefundedWebhook:
    def _post_refund(self, client, event, refunds=None):
        # T8620 G3: the refund webhook branch no longer reads charge["refunds"]
        # from the payload (current Stripe API versions omit it); it fetches the
        # authoritative list via stripe.Refund.list. Mirror that here -- derive the
        # succeeded refunds to return from the event's legacy `refunds.data` unless
        # the caller passes an explicit list.
        charge = event["data"]["object"]
        if refunds is None:
            data = (charge.get("refunds") or {}).get("data") or []
            refunds = [
                {"id": r["id"], "amount": r["amount"], "status": "succeeded",
                 "created": 1690000000, "currency": "usd"}
                for r in data
            ]
        with patch("app.routers.payments.STRIPE_WEBHOOK_SECRET", "whsec_dummy"), \
             patch("stripe.Webhook.construct_event", return_value=event), \
             patch("stripe.Refund.list", return_value=_FakeRefundList(refunds)):
            return client.post(
                "/api/payments/webhook",
                content=b"{}",
                headers={"stripe-signature": "t=1,v1=dummy"},
            )

    def test_refund_decrements_total_spent(self, client):
        # user-a starts at 699; a $3.00 refund should drop it to 399.
        event = {
            "type": "charge.refunded",
            "data": {"object": {
                "id": "ch_1",
                "payment_intent": "pi_a",
                "metadata": {"user_id": "user-a"},
                "amount_refunded": 300,
                "refunds": {"data": [{"id": "re_1", "amount": 300}]},
            }},
        }
        resp = self._post_refund(client, event)
        assert resp.status_code == 200
        assert resp.json()["status"] == "refund_recorded"
        assert resp.json()["cents"] == 300
        assert _total_spent("user-a") == 399

    def test_refund_resolves_user_via_payment_intent(self, client):
        # Charge carries no metadata.user_id -> resolve from the PaymentIntent.
        event = {
            "type": "charge.refunded",
            "data": {"object": {
                "id": "ch_2",
                "payment_intent": "pi_b",
                "metadata": {},
                "amount_refunded": 399,
                "refunds": {"data": [{"id": "re_2", "amount": 399}]},
            }},
        }
        pi = {"metadata": {"user_id": "user-b"}}
        with patch("stripe.PaymentIntent.retrieve", return_value=pi):
            resp = self._post_refund(client, event)
        assert resp.status_code == 200
        assert resp.json()["user_id"] == "user-b"
        assert _total_spent("user-b") == 0

    def test_refund_floors_at_zero(self, client):
        # Refund larger than recorded local spend floors at 0 (never negative).
        event = {
            "type": "charge.refunded",
            "data": {"object": {
                "id": "ch_3",
                "payment_intent": "pi_b",
                "metadata": {"user_id": "user-b"},
                "amount_refunded": 5000,
                "refunds": {"data": [{"id": "re_3", "amount": 5000}]},
            }},
        }
        resp = self._post_refund(client, event)
        assert resp.status_code == 200
        assert _total_spent("user-b") == 0


# ===========================================================================
# T8640: deleted-account cause + filter symmetry + honest heals.
#
# Pure classifier cases use string literals ("account_deleted") rather than the
# enum member so a pre-change run fails BEHAVIORALLY (got "unknown", expected
# "account_deleted"), not with an AttributeError on a missing enum member.
# ===========================================================================

class TestAccountDeletedClassifier:
    """Pure classifier: a payer with no local account + live Stripe history."""

    def test_deleted_account_with_drift_classifies_account_deleted(self):
        # Ledger truth 399 (local), Stripe net 199 after a refund not mirrored to
        # the ledger -> genuine residual drift on a DELETED account.
        agg = build_stripe_net_by_user([make_pi("gone", 399, refunded=200)])
        rows = classify_users(
            {"gone": {"email": None, "local_cents": 399, "account_exists": False}}, agg)
        r = _row_for(rows, "gone")
        assert r["cause"] == "account_deleted"        # NOT "refund", NOT "unknown"
        assert r["drifted"] is True

    def test_account_deleted_wins_over_refund(self):
        agg = build_stripe_net_by_user([make_pi("gone", 699, refunded=300)])
        rows = classify_users(
            {"gone": {"email": None, "local_cents": 699, "account_exists": False}}, agg)
        assert _row_for(rows, "gone")["cause"] == "account_deleted"

    def test_account_deleted_wins_over_dispute(self):
        # Deleted payer that ALSO has a lost dispute -> account_deleted wins.
        agg = build_stripe_net_by_user(
            [make_pi("gone", 399, dispute={"status": "lost", "amount": 399})])
        rows = classify_users(
            {"gone": {"email": None, "local_cents": 399, "account_exists": False}}, agg)
        assert _row_for(rows, "gone")["cause"] == "account_deleted"

    def test_existing_account_stays_unknown_not_account_deleted(self):
        # account_exists True -> live drift stays "unknown" (regression).
        agg = build_stripe_net_by_user([make_pi("live", 399)])
        rows = classify_users(
            {"live": {"email": None, "local_cents": 699, "account_exists": True}}, agg)
        assert _row_for(rows, "live")["cause"] == "unknown"

    def test_account_exists_defaults_true_backcompat(self):
        # A local entry WITHOUT the account_exists key must behave as before
        # (exists) so the pre-T8640 pure tests and call sites stay valid.
        agg = build_stripe_net_by_user([make_pi("live", 399)])
        rows = classify_users({"live": {"email": None, "local_cents": 699}}, agg)
        assert _row_for(rows, "live")["cause"] == "unknown"

    def test_row_carries_account_exists(self):
        agg = build_stripe_net_by_user([make_pi("gone", 399, refunded=200)])
        rows = classify_users(
            {"gone": {"email": None, "local_cents": 399, "account_exists": False}}, agg)
        assert _row_for(rows, "gone")["account_exists"] is False


# --------------------------------------------------------------------------- #
# Endpoint-level (real TestClient) seeding helpers for the T8640 cases.
# --------------------------------------------------------------------------- #

def _seed_segment(user_id, cents):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_segments (user_id, total_spent_cents) VALUES (%s, %s) "
            "ON CONFLICT (user_id) DO UPDATE SET total_spent_cents = EXCLUDED.total_spent_cents",
            (user_id, cents),
        )


def _mark_test_account(user_id, is_test=True):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE users SET is_test_account = %s WHERE user_id = %s", (is_test, user_id)
        )


def _seed_ledger_purchase(user_id, cents, *, obj_id):
    from datetime import UTC, datetime

    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            """INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                                     occurred_at, source)
               VALUES (%s, 'purchase', %s, 'usd', %s, %s, 'backfill')""",
            (user_id, cents, obj_id, datetime.now(UTC)),
        )


def _seed_deletion(user_id, *, net_cents):
    """One account_deletions row (cleaned by the recon_client fixture teardown)."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            """INSERT INTO account_deletions (user_id, actor, path, had_payments, net_cents)
               VALUES (%s, 'self', 'privacy_endpoint', true, %s)""",
            (user_id, net_cents),
        )


@pytest.fixture()
def recon_client(pg_conn, tmp_path, monkeypatch):
    """Admin-only client for T8640 endpoint tests; each test seeds its own data.

    Cleans up the account_deletions rows it creates (that table is intentionally
    NOT truncated by pg_conn -- it outlives account deletion)."""
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    monkeypatch.setattr("stripe.api_key", "sk_test_dummy")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
    with get_pg() as conn:
        conn.cursor().execute(
            "DELETE FROM account_deletions WHERE user_id IN "
            "('deleted-aligned', 'deleted-drift', 'user-a')")


def _rows_by_uid(resp):
    return {r["user_id"]: r for r in resp.json()["rows"]}


class TestDeletedPayerEndpoint:
    def test_deleted_payer_aligned_by_ledger_not_drifted(self, recon_client):
        # bigajosue shape: a backfilled ledger row, NO users/user_segments row.
        # Ledger 399 == Stripe net 399 -> aligned by construction (option 1),
        # so it drops off the drift view instead of showing "unknown".
        _seed_ledger_purchase("deleted-aligned", 399, obj_id="pi_del_aligned")
        _seed_deletion("deleted-aligned", net_cents=399)
        fixture = [make_pi("deleted-aligned", 399, pi_id="pi_del_aligned")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.get("/api/admin/revenue-reconciliation", headers=_admin())
        assert resp.status_code == 200
        row = _rows_by_uid(resp)["deleted-aligned"]
        assert row["drifted"] is False
        assert row["local_cents"] == 399   # from the ledger, not 0

    def test_deleted_payer_residual_drift_is_account_deleted_with_deletion_info(self, recon_client):
        # Ledger 399 but Stripe net 199 (a refund reached Stripe, not the ledger)
        # -> residual drift, classified account_deleted, with deletion metadata.
        _seed_ledger_purchase("deleted-drift", 399, obj_id="pi_del_drift")
        _seed_deletion("deleted-drift", net_cents=399)
        fixture = [make_pi("deleted-drift", 399, refunded=200, pi_id="pi_del_drift")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.get("/api/admin/revenue-reconciliation", headers=_admin())
        assert resp.status_code == 200
        row = _rows_by_uid(resp)["deleted-drift"]
        assert row["cause"] == "account_deleted"
        assert row["drifted"] is True
        assert row["account_exists"] is False
        assert row["deleted_at"] is not None   # Decision D: id-only row explained

    def test_heal_account_deleted_row_does_not_lie(self, recon_client):
        # Healing a deleted-payer row must NOT report healed:true; there is no
        # cache to write (set_total_spent must never be attempted).
        _seed_ledger_purchase("deleted-drift", 399, obj_id="pi_del_drift")
        _seed_deletion("deleted-drift", net_cents=399)
        fixture = [make_pi("deleted-drift", 399, refunded=200, pi_id="pi_del_drift")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.post(
                "/api/admin/revenue-reconciliation/heal",
                json={"user_ids": ["deleted-drift"]}, headers=_admin())
        assert resp.status_code == 200
        result = resp.json()["results"][0]
        assert result["healed"] is False
        assert resp.json()["healed"] == 0


class TestFilterSymmetryImankhRegression:
    """The imankh incident: a flagged account with live Stripe history must be
    absent from BOTH sides when the filter is on, and ALIGNED (never drifted)
    when it is off -- never dropped from one side while surviving on the other."""

    def _seed_imankh(self):
        # "user-a" plays imankh: real account, flagged test, correct local cache,
        # matching live Stripe history (399).
        from app.services.auth_db import create_user
        create_user("user-a", email="imankh@test.local")
        _seed_segment("user-a", 399)
        _mark_test_account("user-a", True)

    def test_filter_on_absent_from_both_sides(self, recon_client):
        self._seed_imankh()
        fixture = [make_pi("user-a", 399, pi_id="pi_imankh")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.get(
                "/api/admin/revenue-reconciliation?exclude_test=true", headers=_admin())
        assert resp.status_code == 200
        assert "user-a" not in _rows_by_uid(resp)   # gone from BOTH sides

    def test_filter_off_aligned_not_drifted(self, recon_client):
        self._seed_imankh()
        fixture = [make_pi("user-a", 399, pi_id="pi_imankh")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.get(
                "/api/admin/revenue-reconciliation?exclude_test=false", headers=_admin())
        assert resp.status_code == 200
        row = _rows_by_uid(resp)["user-a"]
        assert row["local_cents"] == 399
        assert row["stripe_net_cents"] == 399
        assert row["delta_cents"] == 0
        assert row["drifted"] is False              # aligned, NOT a phantom drift

    def test_default_hides_test_account(self, recon_client):
        # Default (no param) hides test accounts, matching list_users.
        self._seed_imankh()
        fixture = [make_pi("user-a", 399, pi_id="pi_imankh")]
        with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=fixture):
            resp = recon_client.get("/api/admin/revenue-reconciliation", headers=_admin())
        assert resp.status_code == 200
        assert "user-a" not in _rows_by_uid(resp)
