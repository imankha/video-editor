"""T8657: the admin "paying" filter selects users from the `payments` ledger,
not the per-user `total_spent_cents` cache.

Why this matters (epic Revenue Record Integrity, follow-up to T8650): after T8650
every admin revenue TOTAL reads the ledger, but the `filter=paying` SELECTOR still
picked its users with `s.total_spent_cents > 0` and then summed their ledger
revenue. That mixes two sources: a payer whose cache disagrees with the ledger
(reconciliation "adopt Stripe" heal, or a backfill-only history that never touched
the cache) is either wrongly counted or wrongly dropped, so the filtered "paying"
view can report a different revenue than the unfiltered view over the same money.

Proof strategy: seed a DIVERGENCE between cache and ledger and assert the paying
SELECTOR (user-list count and pulse filtered revenue) follows the LEDGER. Against
the pre-change cache-based selector these fail for the intended reason; after the
change they pass.

TEST DATABASE: pg-backed via the shared `pg_conn` fixture, which DROPs/TRUNCATEs.
Run only against a throwaway DSN (T8657 used `t8657_test` on host.docker.internal),
never the host dev DB.
"""

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services.auth_db import create_user

# --------------------------------------------------------------------------- #
# Seeding helpers (mirror test_t8650_revenue_from_ledger.py)
# --------------------------------------------------------------------------- #

def _make_admin():
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )


def _seed_payment(user_id, kind, amount_cents, *, obj_id, occurred_at=None,
                  currency="usd", source="backfill"):
    """Insert one ledger row directly (mirrors what the backfill / live path write)."""
    from app.services.pg import get_pg
    occurred_at = occurred_at or datetime.now(UTC)
    with get_pg() as conn:
        conn.cursor().execute(
            """
            INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                                  occurred_at, source)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (user_id, kind, amount_cents, currency, obj_id, occurred_at, source),
        )


def _set_total_spent(user_id, cents):
    """Force the cache to a chosen value so cache-vs-ledger divergence is explicit."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE user_segments SET total_spent_cents = %s WHERE user_id = %s",
            (cents, user_id),
        )


def _mark_test_account(user_id, is_test=True):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE users SET is_test_account = %s WHERE user_id = %s", (is_test, user_id)
        )


def _delete_account(user_id):
    """Simulate what both delete paths do to the revenue-bearing rows today: drop
    the users + user_segments rows. Ledger rows are intentionally left behind."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
        cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))


@pytest.fixture(autouse=True)
def _isolate_users(pg_conn):
    """`pg_conn` resets `payments` (TRUNCATE) and `user_segments` (DROP) each test
    but leaves the `users` table, so arbitrary seed ids would collide on the PK
    across tests. Snapshot the user set before the test and drop anything new
    afterward so each test starts from the same clean slate."""
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
        if new:
            cur.execute("DELETE FROM user_actions WHERE user_id = ANY(%s)", (new,))
            cur.execute("DELETE FROM user_segments WHERE user_id = ANY(%s)", (new,))
            cur.execute("DELETE FROM users WHERE user_id = ANY(%s)", (new,))


@pytest.fixture()
def client(pg_conn, tmp_path):
    _make_admin()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _paying_user_count(client, exclude_test=None):
    """Count of users the admin user-list reports for filter=paying."""
    params = {"filter": "paying"}
    if exclude_test is not None:
        params["exclude_test"] = "true" if exclude_test else "false"
    resp = client.get("/api/admin/users", params=params, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()["total_users"]


def _pulse_revenue(client, *, filter=None, exclude_test=None):
    params = {}
    if filter is not None:
        params["filter"] = filter
    if exclude_test is not None:
        params["exclude_test"] = "true" if exclude_test else "false"
    resp = client.get("/api/admin/analytics/pulse", params=params, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()["cards"]["revenue"]["today"]


# --------------------------------------------------------------------------- #
# The repro from the task: cache and ledger disagree.
#   A: ledger 1000, cache 1000  (they agree)
#   B: ledger  500, cache    0  (backfill-only history; cache never moved)
# Today the "paying" selector reads the cache, so only A counts (revenue 1000)
# while the unfiltered view sums the ledger (1500). Both must count as paying and
# the paying revenue must be 1500 once the selector reads the ledger.
# --------------------------------------------------------------------------- #

def _seed_repro():
    create_user("u_a", email="a@paying.test")
    create_user_segment("u_a", "organic", None, "otp")
    _seed_payment("u_a", "purchase", 1000, obj_id="pi_a")
    _set_total_spent("u_a", 1000)

    create_user("u_b", email="b@paying.test")
    create_user_segment("u_b", "organic", None, "otp")
    _seed_payment("u_b", "purchase", 500, obj_id="pi_b")
    _set_total_spent("u_b", 0)


def _seed_production_missing_backfill_repro():
    """Mirror the production state observed on 2026-09-29.

    Stripe-backed purchases had already populated the legacy per-user cache, but
    the deploy created an empty ``payments`` ledger without running the one-time
    backfill.  Four real accounts therefore carried $42.96 of durable purchase
    history (three $12.99 purchases and one $3.99 purchase) while the new ledger
    contained no rows.  A fifth $3.99 test-account purchase existed in the cache
    but must remain excluded from the default admin view.

    Deliberately do *not* call ``_seed_payment`` here: the missing ledger rows are
    the production defect this regression fixture preserves.
    """
    cached_purchases = (
        ("prod-real-a", "real-a@missing-backfill.test", 1299, False),
        ("prod-real-b", "real-b@missing-backfill.test", 1299, False),
        ("prod-real-c", "real-c@missing-backfill.test", 1299, False),
        ("prod-real-d", "real-d@missing-backfill.test", 399, False),
        ("prod-test", "test@missing-backfill.test", 399, True),
    )
    for user_id, email, amount_cents, is_test in cached_purchases:
        create_user(user_id, email=email)
        create_user_segment(user_id, "organic", None, "otp")
        _set_total_spent(user_id, amount_cents)
        if is_test:
            _mark_test_account(user_id)


class TestMissingProductionBackfill:
    def test_admin_does_not_report_zero_when_historical_purchases_exist(self, client):
        """Red regression: an omitted ledger backfill must not erase revenue.

        Current behavior is ``revenue == 0`` and ``paying_users == 0``.  The
        production-aligned expected values make this fail loudly until startup,
        deployment verification, or the read path prevents an unbackfilled
        ledger from masquerading as a legitimate zero-revenue business.
        """
        _seed_production_missing_backfill_repro()

        pulse = client.get(
            "/api/admin/analytics/pulse?exclude_test=true", headers=_auth()
        )
        users = client.get(
            "/api/admin/users?filter=paying&exclude_test=true", headers=_auth()
        )
        for response in (pulse, users):
            assert response.status_code == 503
            assert response.json()["detail"]["code"] == "payments_ledger_backfill_required"


class TestDeletedPayerTombstone:
    def test_paying_filter_includes_live_and_deleted_real_payers(self, client):
        # Production shape after backfill: four live real payers ($42.96), one
        # deleted real payer ($3.99), and one excluded test payer ($3.99).
        live = (("real-a", 1299), ("real-b", 1299), ("real-c", 1299), ("real-d", 399))
        for user_id, cents in live:
            create_user(user_id, email=f"{user_id}@paying.test")
            create_user_segment(user_id, "organic", None, "otp")
            _seed_payment(user_id, "purchase", cents, obj_id=f"pi_{user_id}")
            _set_total_spent(user_id, cents)

        _seed_payment("deleted-real", "purchase", 399, obj_id="pi_deleted_real")

        create_user("test-payer", email="test@paying.test")
        create_user_segment("test-payer", "organic", None, "otp")
        _seed_payment("test-payer", "purchase", 399, obj_id="pi_test_payer")
        _set_total_spent("test-payer", 399)
        _mark_test_account("test-payer")

        response = client.get(
            "/api/admin/users",
            params={"filter": "paying", "exclude_test": "true", "page_size": 50},
            headers=_auth(),
        )
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total_users"] == 5
        tombstones = [row for row in data["users"] if row["is_deleted"]]
        assert len(tombstones) == 1
        assert tombstones[0]["user_id"] == "deleted-real"
        assert tombstones[0]["email"] == "Deleted account"
        assert tombstones[0]["total_spent_cents"] == 399
        assert _pulse_revenue(client, filter="paying", exclude_test=True) == 4695


class TestPayingSelectorFromLedger:
    def test_user_list_paying_count_counts_ledger_payer_with_zero_cache(self, client):
        _seed_repro()
        # Cache-based selector counts only A (B's cache is 0). Ledger selector counts both.
        assert _paying_user_count(client, exclude_test=False) == 2

    def test_pulse_paying_revenue_matches_unfiltered(self, client):
        _seed_repro()
        unfiltered = _pulse_revenue(client, exclude_test=False)
        paying = _pulse_revenue(client, filter="paying", exclude_test=False)
        assert unfiltered == 1500
        # Cache-based selector drops B, so paying reads 1000; ledger selector reads 1500.
        assert paying == 1500

    def test_refund_net_zero_is_not_paying(self, client):
        # C bought and was fully refunded: ledger nets to 0. The stale cache still
        # reads 1000. A ledger selector must NOT count C as paying.
        create_user("u_c", email="c@paying.test")
        create_user_segment("u_c", "organic", None, "otp")
        _seed_payment("u_c", "purchase", 1000, obj_id="pi_c")
        _seed_payment("u_c", "refund", -1000, obj_id="re_c")
        _set_total_spent("u_c", 1000)

        assert _paying_user_count(client, exclude_test=False) == 0
        assert _pulse_revenue(client, filter="paying", exclude_test=False) == 0

    def test_deleted_payer_matches_filter_as_tombstone(self, client):
        # A deleted payer keeps ledger rows and remains a paying user even when
        # both the live account and its segment are gone.
        create_user("u_live", email="live@paying.test")
        create_user_segment("u_live", "organic", None, "otp")
        _seed_payment("u_live", "purchase", 700, obj_id="pi_live")

        create_user("u_del", email="del@paying.test")
        create_user_segment("u_del", "organic", None, "otp")
        _seed_payment("u_del", "purchase", 800, obj_id="pi_del")
        _delete_account("u_del")

        # Unfiltered grand total still counts the deleted payer (T8650 behaviour).
        assert _pulse_revenue(client, exclude_test=False) == 1500
        assert _paying_user_count(client, exclude_test=False) == 2
        assert _pulse_revenue(client, filter="paying", exclude_test=False) == 1500

    def test_test_account_exclusion_unchanged(self, client):
        # A test account with ledger revenue is excluded from the paying population
        # by default (exclude_test) and included when exclude_test is off -- the
        # exclusion is orthogonal to which source decides "is a payer".
        create_user("u_real", email="real@paying.test")
        create_user_segment("u_real", "organic", None, "otp")
        _seed_payment("u_real", "purchase", 300, obj_id="pi_real")

        create_user("u_test", email="tester@paying.test")
        create_user_segment("u_test", "organic", None, "otp")
        _seed_payment("u_test", "purchase", 900, obj_id="pi_test")
        _mark_test_account("u_test")

        # Default (exclude_test on): only the real payer.
        assert _paying_user_count(client, exclude_test=True) == 1
        assert _pulse_revenue(client, filter="paying", exclude_test=True) == 300
        # exclude_test off: both payers count.
        assert _paying_user_count(client, exclude_test=False) == 2
        assert _pulse_revenue(client, filter="paying", exclude_test=False) == 1200
