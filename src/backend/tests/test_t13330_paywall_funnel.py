"""T13330: paywall + buy-modal funnel events and the admin pack-mix view."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app.analytics import (
    CLIENT_FUNNEL_EVENTS,
    FLOW_EVENTS,
    FUNNEL_STEPS,
    create_user_segment,
    record_funnel_event,
)
from app.routers import admin
from app.services import pg as pg_service
from app.services.auth_db import create_user

NEW_EVENTS = ("paywall_shown", "buy_modal_opened")


def _action_count(user_id, action):
    with pg_service.get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) AS n FROM user_actions "
            "WHERE user_id = %s AND action = %s",
            (user_id, action),
        )
        return cur.fetchone()["n"]


class TestRegistration:
    def test_flow_events_map_to_daily_columns(self, pg_conn):
        assert FLOW_EVENTS["paywall_shown"] == {"label": "Hit Paywall", "daily_col": "paywall_shown"}
        assert FLOW_EVENTS["buy_modal_opened"] == {"label": "Opened Buy", "daily_col": "buy_modal_opened"}

    def test_events_are_client_beaconable(self, pg_conn):
        for event in NEW_EVENTS:
            assert event in CLIENT_FUNNEL_EVENTS

    def test_funnel_places_tries_next_to_purchased(self, pg_conn):
        i = FUNNEL_STEPS.index("paywall_shown")
        assert FUNNEL_STEPS[i:i + 3] == ["paywall_shown", "buy_modal_opened", "credit_purchased"]

    def test_daily_counters_has_columns(self, pg_conn):
        with pg_service.get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
                "WHERE table_name = 'daily_counters' AND column_name = ANY(%s)",
                (list(NEW_EVENTS),),
            )
            cols = {r["column_name"]: r for r in cur.fetchall()}
        assert set(cols) == set(NEW_EVENTS)
        for r in cols.values():
            assert r["is_nullable"] == "NO"
            assert r["column_default"] == "0"


class TestBeacon:
    def test_each_beacon_increments_user_action_once(self, pg_conn):
        create_user("user-1", email="user-1@test.local")
        create_user_segment("user-1", origin="organic", referrer_id=None, signup_method="google")
        for event in NEW_EVENTS:
            with patch("app.analytics.get_current_user_id", return_value="user-1"):
                record_funnel_event(event)
            assert _action_count("user-1", event) == 1

    def test_daily_counter_rolls_up(self, pg_conn):
        from app.analytics import _counter_buffer
        create_user("user-2", email="user-2@test.local")
        create_user_segment("user-2", origin="organic", referrer_id=None, signup_method="google")
        _counter_buffer.flush()  # drain increments buffered by earlier tests
        with pg_service.get_pg() as conn:
            conn.cursor().execute("DELETE FROM daily_counters WHERE counter_date = CURRENT_DATE")
        with patch("app.analytics.get_current_user_id", return_value="user-2"):
            record_funnel_event("paywall_shown")
        _counter_buffer.flush()
        with pg_service.get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT paywall_shown FROM daily_counters "
                "WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            assert cur.fetchone()["paywall_shown"] == 1


def _pay(user_id, pack, cents, obj, days_ago, kind="purchase"):
    with pg_service.get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO payments (user_id, kind, amount_cents, stripe_object_id, pack, "
            "credits, occurred_at, source) VALUES (%s,%s,%s,%s,%s,%s,%s,'backfill')",
            (user_id, kind, cents, obj, pack, 100,
             datetime.now(UTC) - timedelta(days=days_ago)),
        )


def _mix(**kw):
    with patch.object(admin, "_require_admin", return_value=None):
        return admin.analytics_pack_mix(**kw)


class TestPackMix:
    def _seed(self):
        create_user("user-a", email="real@test.local")
        create_user("user-b", email="test@test.local")
        with pg_service.get_pg() as conn:
            conn.cursor().execute(
                "UPDATE users SET is_test_account = true WHERE user_id = 'user-b'"
            )
        _pay("user-a", "popular", 1299, "pi_a", 5)
        _pay("user-a", "popular", 1299, "pi_b", 60)
        _pay("user-a", "starter", 699, "pi_c", 200)
        _pay("user-a", "popular", -1299, "re_a", 5, kind="refund")  # not a purchase
        _pay("user-b", "best_value", 2999, "pi_t", 5)

    def _by_pack(self, resp, window):
        return {r["pack"]: (r["purchases"], r["gross_cents"]) for r in resp["windows"][window]}

    def test_windows_and_counts(self, pg_conn):
        self._seed()
        resp = _mix(exclude_test=True)
        assert self._by_pack(resp, "30d") == {"popular": (1, 1299)}
        assert self._by_pack(resp, "90d") == {"popular": (2, 2598)}
        assert self._by_pack(resp, "all") == {"popular": (2, 2598), "starter": (1, 699)}

    def test_test_accounts_filterable(self, pg_conn):
        self._seed()
        resp = _mix(exclude_test=False)
        assert self._by_pack(resp, "30d")["best_value"] == (1, 2999)
