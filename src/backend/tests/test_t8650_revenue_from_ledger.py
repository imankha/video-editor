"""T8650: admin revenue aggregates read the append-only `payments` ledger, not
the per-user `total_spent_cents` cache.

Why this matters (epic Revenue Record Integrity 4/6): `total_spent_cents` is a
mutable per-user cache that account deletion zeroes out by dropping the
`user_segments` row. Basing revenue reporting on it means the reported number can
only drift downward from the truth, permanently and invisibly (prod is $3.99 light
right now from the 2026-08-24 orphan). The `payments` ledger has no FK to `users`,
so a deleted payer's money survives; every aggregate revenue figure must come from
it.

Proof strategy: each test seeds a DIVERGENCE between the cache and the ledger (a
ledger row with no segment row, or a `total_spent_cents` value that disagrees with
the ledger sum) and asserts the endpoint reports the LEDGER value. Against the
pre-change cache-based code these fail for the intended reason (endpoint returns
the cache); after the change they pass.

TEST DATABASE: these are pg-backed and use the shared `pg_conn` fixture, which
TRUNCATEs. Run only against a throwaway DSN (T8650 used `t8650_test` on
host.docker.internal), never the host dev DB.
"""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services.auth_db import create_user

# --------------------------------------------------------------------------- #
# Seeding helpers
# --------------------------------------------------------------------------- #

def _make_admin():
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )


def _seed_payment(user_id, kind, amount_cents, *, obj_id, occurred_at=None,
                  currency="usd", source="backfill", account_deleted_at=None,
                  pack=None, credits=None, charge_id=None):
    """Insert one ledger row directly (mirrors what the backfill / live path write)."""
    from app.services.pg import get_pg
    occurred_at = occurred_at or datetime.now(UTC)
    with get_pg() as conn:
        conn.cursor().execute(
            """
            INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                                  stripe_charge_id, pack, credits, occurred_at, source,
                                  account_deleted_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (user_id, kind, amount_cents, currency, obj_id, charge_id, pack, credits,
             occurred_at, source, account_deleted_at),
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


def _set_acquired_at(user_id, dt):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE user_segments SET acquired_at = %s WHERE user_id = %s", (dt, user_id)
        )


def _add_export_action(user_id, count=2, platform="web"):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_actions (user_id, action, platform, count) VALUES (%s,'export_completed',%s,%s)",
            (user_id, platform, count),
        )


def _delete_account(user_id):
    """Simulate what both delete paths do to the revenue-bearing rows today:
    drop the users + user_segments rows. Ledger rows are intentionally left."""
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
    afterward so each test starts from the same clean slate. (t8650_test is a
    throwaway DB; pg_conn already refuses staging/prod.)"""
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
            # Clear every table that FKs users before dropping the users rows, or the
            # DELETE FROM users raises a foreign-key violation and the row leaks (a
            # user_actions export row does exactly this).
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


def _pulse_revenue(client, exclude_test=None):
    q = "" if exclude_test is None else f"?exclude_test={'true' if exclude_test else 'false'}"
    resp = client.get(f"/api/admin/analytics/pulse{q}", headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()["cards"]["revenue"]["today"]


# --------------------------------------------------------------------------- #
# Grand totals (pulse) read the ledger
# --------------------------------------------------------------------------- #

class TestGrandTotalFromLedger:
    def test_unfiltered_total_counts_deleted_payer_with_no_segment(self, client):
        # A normal payer with a segment...
        create_user("payer", email="p@test.com")
        create_user_segment("payer", "organic", None, "otp")
        _seed_payment("payer", "purchase", 1299, obj_id="pi_payer")
        _set_total_spent("payer", 1299)
        # ...and a DELETED payer: a ledger row whose user_id matches no segment row.
        _seed_payment("fb40690a-orphan", "purchase", 399, obj_id="pi_orphan")

        # Unfiltered branch (exclude_test=false, no filter): the true grand total.
        total = _pulse_revenue(client, exclude_test=False)
        # Cache-based code returns 1299 (misses the orphan); ledger returns 1698.
        assert total == 1299 + 399

    def test_default_view_counts_deleted_payer(self, client):
        # exclude_test defaults True -> the filtered branch, which is the DEFAULT
        # admin view. It must still count the segment-less orphan.
        create_user("payer", email="p@test.com")
        create_user_segment("payer", "organic", None, "otp")
        _seed_payment("payer", "purchase", 1299, obj_id="pi_payer")
        _set_total_spent("payer", 1299)
        _seed_payment("orphan", "purchase", 399, obj_id="pi_orphan")

        assert _pulse_revenue(client) == 1299 + 399

    def test_revenue_comes_from_ledger_not_cache(self, client):
        # Cache disagrees with the ledger: cache says 5000, ledger says 1299.
        # The endpoint must report the ledger value.
        create_user("payer", email="p@test.com")
        create_user_segment("payer", "organic", None, "otp")
        _seed_payment("payer", "purchase", 1299, obj_id="pi_payer")
        _set_total_spent("payer", 5000)

        assert _pulse_revenue(client, exclude_test=False) == 1299

    def test_deleting_paying_account_does_not_change_total(self, client):
        create_user("payer", email="p@test.com")
        create_user_segment("payer", "organic", None, "otp")
        _seed_payment("payer", "purchase", 1299, obj_id="pi_payer")
        _set_total_spent("payer", 1299)

        before = _pulse_revenue(client, exclude_test=False)
        assert before == 1299

        _delete_account("payer")  # ledger row remains; segment + users gone

        after = _pulse_revenue(client, exclude_test=False)
        assert after == before  # AC: deleting a paying account changes no total

    def test_refund_and_dispute_net_correctly(self, client):
        create_user("payer", email="p@test.com")
        create_user_segment("payer", "organic", None, "otp")
        _seed_payment("payer", "purchase", 399, obj_id="pi_payer")
        _seed_payment("payer", "refund", -100, obj_id="re_payer")
        _seed_payment("payer", "dispute_lost", -50, obj_id="dp_payer")
        _set_total_spent("payer", 0)  # cache deliberately wrong

        assert _pulse_revenue(client, exclude_test=False) == 399 - 100 - 50

    def test_account_deleted_at_stamped_rows_still_counted(self, client):
        # T8630 will stamp account_deleted_at; it is NEVER a revenue filter.
        _seed_payment("gone", "purchase", 799, obj_id="pi_gone",
                      account_deleted_at=datetime.now(UTC))
        assert _pulse_revenue(client, exclude_test=False) == 799

    def test_test_account_excluded_where_user_row_exists_but_not_after_deletion(self, client):
        # A live internal test purchase is excludable while its users row exists...
        create_user("real", email="r@test.com")
        create_user_segment("real", "organic", None, "otp")
        _seed_payment("real", "purchase", 1299, obj_id="pi_real")
        _set_total_spent("real", 1299)

        create_user("tester", email="t@test.com")
        create_user_segment("tester", "organic", None, "otp")
        _mark_test_account("tester", True)
        _seed_payment("tester", "purchase", 999, obj_id="pi_tester")
        _set_total_spent("tester", 999)

        # Default view excludes test accounts (via the users anti-join).
        assert _pulse_revenue(client, exclude_test=True) == 1299
        # ...but once the test account is deleted, there is no users row left to
        # exclude on, so the money is counted (documented reason not to delete
        # such accounts).
        _delete_account("tester")
        assert _pulse_revenue(client, exclude_test=True) == 1299 + 999


# --------------------------------------------------------------------------- #
# Grouped views expose the unattributed remainder instead of dropping it
# --------------------------------------------------------------------------- #

class TestGroupedViewsUnattributed:
    def _seed_two_origins_plus_orphan(self):
        create_user("u_tiktok", email="tk@test.com")
        create_user_segment("u_tiktok", "tiktok", None, "otp")
        _seed_payment("u_tiktok", "purchase", 1000, obj_id="pi_tk")
        _set_total_spent("u_tiktok", 1000)

        create_user("u_organic", email="og@test.com")
        create_user_segment("u_organic", "organic", None, "otp")
        _seed_payment("u_organic", "purchase", 500, obj_id="pi_og")
        _set_total_spent("u_organic", 500)

        # Deleted payer: money with no segment to attribute it to.
        _seed_payment("orphan", "purchase", 399, obj_id="pi_orphan")

    def test_channels_attributed_plus_unattributed_equals_grand_total(self, client):
        self._seed_two_origins_plus_orphan()
        resp = client.get("/api/admin/analytics/channels?exclude_test=false", headers=_auth())
        assert resp.status_code == 200, resp.text
        data = resp.json()

        by_origin = {c["origin"]: c["revenue_cents"] for c in data["channels"]}
        assert by_origin["tiktok"] == 1000
        assert by_origin["organic"] == 500

        attributed = sum(c["revenue_cents"] for c in data["channels"])
        unattributed = data["unattributed_revenue_cents"]
        assert unattributed == 399  # exactly the orphan's money
        assert attributed + unattributed == 1000 + 500 + 399  # grand total, nothing lost

    def test_cohorts_attributed_plus_unattributed_equals_grand_total(self, client):
        self._seed_two_origins_plus_orphan()
        resp = client.get("/api/admin/analytics/cohorts?exclude_test=false", headers=_auth())
        assert resp.status_code == 200, resp.text
        data = resp.json()

        attributed = sum(c.get("revenue_cents", 0) for c in data["cohorts"])
        unattributed = data["unattributed_revenue_cents"]
        assert attributed == 1500  # both segment users share one cohort period
        assert unattributed == 399
        assert attributed + unattributed == 1500 + 399

    def test_channels_revenue_comes_from_ledger_not_cache(self, client):
        # Cache diverges from the ledger; the per-origin revenue must follow the ledger.
        create_user("u_tiktok", email="tk@test.com")
        create_user_segment("u_tiktok", "tiktok", None, "otp")
        _seed_payment("u_tiktok", "purchase", 1000, obj_id="pi_tk")
        _set_total_spent("u_tiktok", 7777)  # wrong on purpose

        resp = client.get("/api/admin/analytics/channels?exclude_test=false", headers=_auth())
        by_origin = {c["origin"]: c["revenue_cents"] for c in resp.json()["channels"]}
        assert by_origin["tiktok"] == 1000


# --------------------------------------------------------------------------- #
# Performance: aggregate stays flat (no per-user N+1), and the per-user grouping
# can be served by idx_payments_user.
# --------------------------------------------------------------------------- #

class TestPerformance:
    @contextmanager
    def _count_admin_statements(self, monkeypatch):
        from app.routers import admin as admin_mod
        real_get_pg = admin_mod.get_pg
        stmts: list[str] = []

        class CurWrap:
            def __init__(self, cur):
                self._cur = cur

            def execute(self, q, *a, **k):
                stmts.append(q)
                return self._cur.execute(q, *a, **k)

            def __getattr__(self, n):
                return getattr(self._cur, n)

            def __iter__(self):
                return iter(self._cur)

        class ConnWrap:
            def __init__(self, conn):
                self._conn = conn

            def cursor(self, *a, **k):
                return CurWrap(self._conn.cursor(*a, **k))

            def __getattr__(self, n):
                return getattr(self._conn, n)

        @contextmanager
        def wrapped():
            with real_get_pg() as conn:
                yield ConnWrap(conn)

        monkeypatch.setattr(admin_mod, "get_pg", wrapped)
        yield stmts

    def test_channels_statement_count_flat_as_payments_grow(self, client, monkeypatch):
        # One segment user, one payment.
        create_user("u1", email="u1@test.com")
        create_user_segment("u1", "organic", None, "otp")
        _seed_payment("u1", "purchase", 100, obj_id="pi_u1_0")

        with self._count_admin_statements(monkeypatch) as stmts:
            client.get("/api/admin/analytics/channels?exclude_test=false", headers=_auth())
        few = len(stmts)

        # Many more payment rows for many users -> must NOT add statements.
        for i in range(30):
            uid = f"orphan-{i}"
            _seed_payment(uid, "purchase", 10, obj_id=f"pi_orphan_{i}")

        with self._count_admin_statements(monkeypatch) as stmts:
            client.get("/api/admin/analytics/channels?exclude_test=false", headers=_auth())
        many = len(stmts)

        assert few == many, f"channels query count scaled with rows: {few} -> {many}"

    def test_per_user_payments_grouping_can_use_idx_payments_user(self, client):
        from app.services.pg import get_pg
        _seed_payment("u1", "purchase", 100, obj_id="pi_u1")
        with get_pg() as conn:
            cur = conn.cursor()
            # Force the planner to prefer the index so we prove one exists that
            # serves GROUP BY user_id (leading column of idx_payments_user).
            cur.execute("SET LOCAL enable_seqscan = off")
            cur.execute(
                "EXPLAIN SELECT user_id, SUM(amount_cents) FROM payments GROUP BY user_id"
            )
            plan = " ".join(str(r) for r in cur.fetchall())
        assert "idx_payments_user" in plan, plan


# --------------------------------------------------------------------------- #
# Round 2 (user decision 2026-09-24): the pulse Revenue card FOLLOWS the
# dashboard filters. No real filter -> platform grand total (deleted payers in,
# test out). A real filter -> SUM over just the payers matching that filter.
# --------------------------------------------------------------------------- #

class TestPulseFollowsFilters:
    def test_revenue_follows_origin_filter(self, client):
        # Verifier repro: pulse?origin=tiktok returned 8200 including a 7000 organic
        # payer. It must now exclude the other origin's money.
        create_user("u_tk", email="tk@test.com")
        create_user_segment("u_tk", "tiktok", None, "otp")
        _seed_payment("u_tk", "purchase", 1000, obj_id="pi_tk")
        create_user("u_og", email="og@test.com")
        create_user_segment("u_og", "organic", None, "otp")
        _seed_payment("u_og", "purchase", 7000, obj_id="pi_og")

        # Unfiltered (default): platform net over both.
        assert _pulse_revenue(client) == 8000
        # Filtered to tiktok: only tiktok's payer, never the organic 7000.
        resp = client.get("/api/admin/analytics/pulse?origin=tiktok", headers=_auth())
        assert resp.json()["cards"]["revenue"]["today"] == 1000

    def test_unfiltered_headline_still_counts_deleted_payer(self, client):
        create_user("u_tk", email="tk@test.com")
        create_user_segment("u_tk", "tiktok", None, "otp")
        _seed_payment("u_tk", "purchase", 1000, obj_id="pi_tk")
        _seed_payment("orphan", "purchase", 399, obj_id="pi_orphan")  # no segment row

        # No real filter -> platform grand total includes the segment-less orphan.
        assert _pulse_revenue(client) == 1000 + 399
        # A real filter joins user_segments, so the orphan can never match -> excluded.
        resp = client.get("/api/admin/analytics/pulse?origin=tiktok", headers=_auth())
        assert resp.json()["cards"]["revenue"]["today"] == 1000

    def test_filtered_and_unfiltered_are_net_of_refunds(self, client):
        create_user("u_tk", email="tk@test.com")
        create_user_segment("u_tk", "tiktok", None, "otp")
        _seed_payment("u_tk", "purchase", 1000, obj_id="pi_tk")
        _seed_payment("u_tk", "refund", -200, obj_id="re_tk")
        create_user("u_og", email="og@test.com")
        create_user_segment("u_og", "organic", None, "otp")
        _seed_payment("u_og", "purchase", 500, obj_id="pi_og")
        _seed_payment("u_og", "refund", -100, obj_id="re_og")

        # Unfiltered net: (1000-200) + (500-100) = 1200.
        assert _pulse_revenue(client) == 1200
        # Filtered to tiktok net: 1000 - 200 = 800.
        resp = client.get("/api/admin/analytics/pulse?origin=tiktok", headers=_auth())
        assert resp.json()["cards"]["revenue"]["today"] == 800


# --------------------------------------------------------------------------- #
# Gap 1 (no-fan-out pin): ONE user with several ledger rows must count as one
# user with net revenue. The mutant that swaps the per-user pre-aggregation for
# a raw `payments` join fans the user out to N rows and is caught by users == 1.
#
# Both queries below aggregate over EVERY user_segments row in the active
# origin/date scope. The contamination is NOT pytest-xdist concurrency (CI runs
# pytest serially): it is leftover `users` rows from other test files. Each
# pg_conn setup DROPs user_segments and replays migrations, and migration v009
# then backfills a DEFAULT segment row (origin 'organic', acquired_at CURRENT_DATE)
# for EVERY row still in `users`. pg_conn only deletes the fixture's own
# _TEST_USER_IDS afterward, so any user another file left behind survives, gets
# one of those default 'organic'/today segment rows, and lands in the default
# cohort's origin+window -- observed in CI as `assert 14 == 1` on the cohorts
# variant. Pin these two to an origin literal and acquired_at window no other test
# in the suite uses so the query can only ever see u1's own row.
# --------------------------------------------------------------------------- #

_GAP1_WINDOW = {"from": "2016-01-01", "to": "2016-12-31"}
_GAP1_ACQUIRED_AT = datetime(2016, 3, 10, tzinfo=UTC)


class TestGap1NoFanoutMultiRowPerUser:
    def test_channels_one_user_many_rows_net_no_fanout(self, client):
        create_user("u1", email="u1@test.com")
        create_user_segment("u1", "t8650-gap1-channels-fanout", None, "otp")
        _set_acquired_at("u1", _GAP1_ACQUIRED_AT)
        _seed_payment("u1", "purchase", 1000, obj_id="pi_a")
        _seed_payment("u1", "purchase", 500, obj_id="pi_b")
        _seed_payment("u1", "refund", -200, obj_id="re_a")
        _add_export_action("u1", count=2)  # a raw payments join would also 3x exports

        resp = client.get(
            "/api/admin/analytics/channels", params={"exclude_test": "false", **_GAP1_WINDOW},
            headers=_auth(),
        )
        ch = next(c for c in resp.json()["channels"] if c["origin"] == "t8650-gap1-channels-fanout")
        assert ch["users"] == 1                          # not 3 (raw join fans out)
        assert ch["revenue_cents"] == 1000 + 500 - 200   # net, each row once
        assert ch["exported"] == 1                       # not inflated by the payments rows

    def test_cohorts_one_user_many_rows_net_no_fanout(self, client):
        create_user("u1", email="u1@test.com")
        create_user_segment("u1", "t8650-gap1-cohorts-fanout", None, "otp")
        _set_acquired_at("u1", _GAP1_ACQUIRED_AT)
        _seed_payment("u1", "purchase", 1000, obj_id="pi_a")
        _seed_payment("u1", "purchase", 500, obj_id="pi_b")
        _seed_payment("u1", "refund", -200, obj_id="re_a")

        data = client.get(
            "/api/admin/analytics/cohorts",
            params={"exclude_test": "false", "origin": "t8650-gap1-cohorts-fanout", **_GAP1_WINDOW},
            headers=_auth(),
        ).json()
        assert sum(c["signups"] for c in data["cohorts"]) == 1                 # not 3
        assert sum(c["revenue_cents"] for c in data["cohorts"]) == 1000 + 500 - 200


# --------------------------------------------------------------------------- #
# Gap 4: /cohorts?origin=X computes its remainder WITHIN the filter scope
# (payers matching the filter who cannot be attributed to a cohort), never
# against the platform total.
# --------------------------------------------------------------------------- #

class TestGap4CohortsOriginScopedRemainder:
    def test_origin_filter_remainder_does_not_absorb_other_origins(self, client):
        create_user("u_tk", email="tk@test.com")
        create_user_segment("u_tk", "tiktok", None, "otp")
        _seed_payment("u_tk", "purchase", 1000, obj_id="pi_tk")
        create_user("u_og", email="og@test.com")
        create_user_segment("u_og", "organic", None, "otp")
        _seed_payment("u_og", "purchase", 7000, obj_id="pi_og")

        data = client.get(
            "/api/admin/analytics/cohorts?origin=tiktok&exclude_test=false", headers=_auth()
        ).json()
        attributed = sum(c.get("revenue_cents", 0) for c in data["cohorts"])
        assert attributed == 1000
        # The 7000 organic payer is out of the tiktok scope entirely, NOT an
        # unattributed remainder (round-1 code reported 7000 here).
        assert data["unattributed_revenue_cents"] == 0

    def test_origin_filter_remainder_is_the_in_scope_out_of_window_money(self, client):
        # An in-scope (tiktok) payer acquired before the default 365d window can't land
        # in a returned cohort -> it IS the remainder, and it stays scoped to tiktok.
        create_user("u_recent", email="r@test.com")
        create_user_segment("u_recent", "tiktok", None, "otp")
        _seed_payment("u_recent", "purchase", 1000, obj_id="pi_recent")

        create_user("u_old", email="o@test.com")
        create_user_segment("u_old", "tiktok", None, "otp")
        _set_acquired_at("u_old", datetime.now(UTC) - timedelta(days=800))
        _seed_payment("u_old", "purchase", 300, obj_id="pi_old")

        # Also an organic payer that must NOT leak into the tiktok remainder.
        create_user("u_og", email="og@test.com")
        create_user_segment("u_og", "organic", None, "otp")
        _seed_payment("u_og", "purchase", 7000, obj_id="pi_og")

        data = client.get(
            "/api/admin/analytics/cohorts?origin=tiktok&exclude_test=false", headers=_auth()
        ).json()
        attributed = sum(c.get("revenue_cents", 0) for c in data["cohorts"])
        assert attributed == 1000                          # only the in-window tiktok payer
        assert data["unattributed_revenue_cents"] == 300   # the out-of-window tiktok payer, not 7000
