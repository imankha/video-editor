"""T14910: spend-readiness gates -- pure rules on every boundary, seeded readers per gate
against Postgres, the Diagnose cuts, and the two admin-only endpoints.

Design: docs/plans/tasks/T14910-design.md (revision 3). Imports only the two new modules'
exported names, so against the exports-only stub revision every test fails on behaviour."""
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services import spend_readiness_constants as C
from app.services.analytics_spend_readiness import (
    _dollars,
    all_green,
    break_even_cents,
    build_gate_diagnosis,
    build_spend_readiness,
    channel_rows,
    channel_state,
    confidence,
    eta_days,
    focus,
    gate_row,
    measurement_test,
    rag_for,
    settle_n,
    settle_n_mean,
    verdict,
    wilson,
)
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

NOW = datetime.now(UTC)
TODAY = NOW.date()
TEST_BUILD = 14910
Z = 1.96


# ---------------------------------------------------------------------------
# Pure rules
# ---------------------------------------------------------------------------

class TestIntervals:
    def test_wilson_on_4_of_375_is_the_design_interval(self):
        lo, hi = wilson(4, 375)
        assert 0.003 < lo < 0.005
        assert 0.026 < hi < 0.028

    def test_wilson_contains_the_point_and_is_bounded(self):
        for k, n in [(0, 20), (20, 20), (1, 20), (10, 20)]:
            lo, hi = wilson(k, n)
            assert 0 <= lo <= k / n <= hi <= 1


class TestRag:
    @pytest.mark.parametrize("value,expected", [
        (25, "green"), (24.99, "yellow"), (15, "yellow"), (14.99, "red"), (0, "red"),
    ])
    def test_higher_is_better_boundaries(self, value, expected):
        assert rag_for(value, green=25, yellow=15, direction="higher") == expected

    @pytest.mark.parametrize("value,expected", [
        (9.99, "green"), (10, "yellow"), (19.99, "yellow"), (20, "red"), (100, "red"),
    ])
    def test_lower_is_better_boundaries(self, value, expected):
        assert rag_for(value, green=10, yellow=20, direction="lower") == expected

    def test_floor_edge_19_grey_20_coloured(self):
        under = gate_row("signup_to_export_14d", k=10, n=19, computed_at=NOW)
        at = gate_row("signup_to_export_14d", k=10, n=20, computed_at=NOW)
        assert under["rag"] == "grey" and under["confidence"] is None and under["value"] is None
        assert at["rag"] == "green" and at["value"] == 50.0
        assert under["unblock"]["need"] == {"have": 19, "floor": 20, "unit": "sign-ups",
                                            "eta_days": None, "rate_per_day": None}

    def test_every_gate_key_renders_each_colour_and_grey(self):
        for g in C.GATES:
            if g["kind"] != "proportion":
                continue
            assert gate_row(g["key"], k=0, n=5, computed_at=NOW)["rag"] == "grey"
            seen = {gate_row(g["key"], k=k, n=100, computed_at=NOW)["rag"] for k in range(0, 101)}
            assert seen == {"green", "yellow", "red"}, g["key"]


class TestConfidence:
    def test_one_payer_in_twenty_is_provisional_green_never_settled(self):
        row = gate_row("payers_per_100", k=1, n=20, computed_at=NOW)
        assert row["rag"] == "green"
        assert row["confidence"] == "provisional"
        assert row["settle"]["crosses"] == 5 and row["settle"]["crosses_rag"] == "yellow"
        # 1 of 20 sits exactly on the 5 per 100 threshold: no n settles it at this rate.
        assert row["settle"]["n_needed"] is None and "cannot settle" in row["settle"]["text"]
        two = gate_row("payers_per_100", k=2, n=20, computed_at=NOW)
        assert two["confidence"] == "provisional" and two["settle"]["n_needed"] > 20
        assert two["settle"]["more"] == two["settle"]["n_needed"] - 20

    def test_settled_when_the_whole_interval_is_on_one_side(self):
        assert confidence(50, 40, 60, green=25, yellow=15, direction="higher") == "settled"
        assert confidence(5, 1, 9, green=10, yellow=20, direction="lower") == "settled"
        assert confidence(20, 16, 24, green=25, yellow=15, direction="higher") == "settled"

    def test_provisional_when_the_interval_crosses_any_deciding_threshold(self):
        assert confidence(26, 20, 32, green=25, yellow=15, direction="higher") == "provisional"
        assert confidence(20, 14, 26, green=25, yellow=15, direction="higher") == "provisional"
        assert confidence(12, 8, 16, green=10, yellow=20, direction="lower") == "provisional"

    def test_settle_n_on_the_wilson_form(self):
        n = settle_n(0.30, 0.25)
        assert n > 20
        assert wilson(0.30 * n, n)[0] > 0.25
        assert wilson(0.30 * (n - 1), n - 1)[0] <= 0.25
        below = settle_n(0.10, 0.15)
        assert wilson(0.10 * below, below)[1] < 0.15
        assert wilson(0.10 * (below - 1), below - 1)[1] >= 0.15

    def test_a_value_on_the_threshold_never_settles(self):
        assert settle_n(0.25, 0.25) is None
        assert settle_n_mean(3500, 1000, 3500) is None
        row = gate_row("signup_to_export_14d", k=25, n=100, computed_at=NOW)
        assert row["confidence"] == "provisional"
        assert row["settle"]["n_needed"] is None
        assert "cannot settle" in row["settle"]["text"]

    def test_settle_n_mean_uses_the_standard_error(self):
        n = settle_n_mean(3000, 1200, 3500)
        assert n == 23  # ceil((1.96 * 1200 / 500) ** 2)

    def test_eta_with_zero_rate_is_none(self):
        assert eta_days(10, 0) is None
        assert eta_days(10, 2) == 5


class TestLadder:
    def test_break_even_formula(self):
        be = break_even_cents(payers_per_signup=0.05, revenue_per_payer_cents=4000,
                              export_rate=0.5, plays_per_exporter=4, games_per_signup=1,
                              purchases_per_payer=1)
        variable = 0.5 * 4 * C.GPU_PER_PLAY_CENTS + 1 * C.STORAGE_PER_GAME_CENTS \
            + 0.05 * (4000 * C.STRIPE_PCT + 1 * C.STRIPE_FIXED_CENTS)
        assert be == pytest.approx(200 - variable)

    @pytest.mark.parametrize("be,cost,expected", [
        (100, 100, "GO"), (99, 100, "TEST"), (50, 100, "TEST"), (49, 100, "NO"),
    ])
    def test_channel_state_boundaries(self, be, cost, expected):
        assert channel_state(be, cost) == expected

    def test_optimistic_state_is_the_task_reference_ladder(self):
        rows = {r["key"]: r for r in channel_rows(point=154, lower=154, upper=154)}
        assert rows["coach_credits"]["state"] == "GO"
        assert rows["coach_gift_cards"]["state"] == "GO"
        assert rows["reddit_cheapest"]["state"] == "TEST"
        assert rows["reddit_central"]["state"] == "NO"
        assert rows["meta_reels"]["state"] == "NO"
        assert all(r["confidence"] == "settled" for k, r in rows.items() if k != "club_placement")
        assert all(r["label_kind"] == "B" for k, r in rows.items() if k != "club_placement")

    def test_today_state_no_at_the_upper_bound_and_provisional_coach_rows(self):
        rows = {r["key"]: r for r in channel_rows(point=12, lower=0, upper=77,
                                                   payers_per_signup=0.0107, signups=375,
                                                   revenue_per_payer_cents=1899, variable_cents=7)}
        assert (rows["meta_reels"]["state"], rows["meta_reels"]["confidence"]) == ("NO", "settled")
        assert (rows["reddit_central"]["state"], rows["reddit_central"]["confidence"]) == ("NO", "settled")
        assert (rows["reddit_cheapest"]["state"], rows["reddit_cheapest"]["confidence"]) == ("NO", "settled")
        assert (rows["coach_gift_cards"]["state"], rows["coach_gift_cards"]["confidence"]) == ("NO", "provisional")
        assert "TEST" in rows["coach_gift_cards"]["reason"]
        assert (rows["coach_credits"]["state"], rows["coach_credits"]["confidence"]) == ("NO", "provisional")
        assert "GO" in rows["coach_credits"]["reason"] and "payers" in rows["coach_credits"]["reason"]
        assert rows["club_placement"]["state"] == "grey"
        assert "even at the upper bound" in rows["meta_reels"]["reason"]

    def test_rows_are_ordered_by_cost(self):
        rows = channel_rows(point=154, lower=154, upper=154)
        costs = [r["cost_cents"] for r in rows if r["key"] != "club_placement"]
        assert costs == sorted(costs)


def _gates(**overrides):
    """A full ladder of eleven rows, every one settled green unless overridden
    with (k, n) or a ready-made row."""
    rows = []
    for g in C.GATES:
        if g["key"] in overrides and isinstance(overrides[g["key"]], dict):
            rows.append(overrides[g["key"]])
            continue
        if g["kind"] == "proportion":
            k, n = overrides.get(g["key"], (900, 1000) if g["direction"] == "higher" else (10, 1000))
            rows.append(gate_row(g["key"], k=k, n=n, computed_at=NOW))
        elif g["kind"] == "mean":
            rows.append(gate_row(g["key"], mean=overrides.get(g["key"], 9000), sd=100, n=50, computed_at=NOW))
        elif g["kind"] == "counts":
            rows.append(gate_row(g["key"], counts=overrides.get(g["key"], (50, 10)), computed_at=NOW))
    return rows


class TestFocusAndVerdicts:
    def test_focus_is_the_first_tier_with_work_then_its_worst_gate(self):
        rows = _gates(signup_to_export_14d=(10, 100), upload_failure=(150, 1000))
        f = focus(rows)
        assert f["tier"] == "B"
        assert f["gate"] == "signup_to_export_14d"  # red before yellow
        rows = _gates(signup_to_export_14d=(10, 100), finished_to_took_away=(10, 100))
        assert focus(rows)["gate"] == "signup_to_export_14d"  # ties by gate order

    def test_grey_for_missing_instrumentation_is_a_focus_but_waiting_on_volume_is_not(self):
        rows = _gates(signup_to_export_14d=(10, 100),
                      visit_to_signup=gate_row("visit_to_signup", k=0, n=0, computed_at=NOW,
                                               unblock={"kind": "task", "text": "ship T7410", "need": None}))
        assert focus(rows)["tier"] == "A"
        rows = _gates(revenue_per_payer=gate_row("revenue_per_payer", mean=1899, sd=None, n=4, computed_at=NOW))
        assert rows[6]["rag"] == "grey" and rows[6]["unblock"]["kind"] == "volume"
        assert focus(rows) is None

    def test_measurement_flight_is_blocked_by_a_provisional_red(self):
        rows = _gates(signup_to_export_14d=(14, 100))  # 14% red, interval crosses 15
        assert rows[1]["rag"] == "red" and rows[1]["confidence"] == "provisional"
        mt = measurement_test(rows)
        assert mt["allowed"] is False
        assert mt["blocking"] == ["signup_to_export_14d"]

    def test_measurement_flight_is_blocked_by_an_undercount_caveat_and_a_grey_task_gate(self):
        rows = _gates(visit_to_signup=gate_row("visit_to_signup", k=0, n=0, computed_at=NOW,
                                               unblock={"kind": "task", "text": "ship T7410", "need": None}))
        assert measurement_test(rows)["blocking"] == ["visit_to_signup"]
        rows = _gates(signup_to_export_14d=gate_row("signup_to_export_14d", k=90, n=100, computed_at=NOW,
                                                    caveats=[C.CAVEAT_EXPORT_EVENT]))
        assert measurement_test(rows)["blocking"] == ["signup_to_export_14d"]
        assert measurement_test(_gates())["allowed"] is True

    def test_all_green_is_refused_by_a_provisional_green(self):
        settled = _gates()
        go = channel_rows(point=154, lower=154, upper=154)
        assert all_green(settled, go) is True
        provisional = _gates(payers_per_100=(1, 20))
        assert provisional[5]["confidence"] == "provisional"
        assert all_green(provisional, go) is False
        assert all_green(settled, channel_rows(point=12, lower=0, upper=77)) is False

    def test_verdict_line_names_states_and_both_answers(self):
        rows = _gates(signup_to_export_14d=(10, 100), upload_failure=(287, 1000))
        channels = channel_rows(point=12, lower=0, upper=77)
        v = verdict(rows, channels, focus(rows), measurement_test(rows),
                    {"point_cents": 12, "upper_cents": 77})
        assert v["headline"] == "Not yet: fix the funnel."
        assert "red, settled" in v["line"]
        assert "Meta" in v["line"] and "NO" in v["line"]
        assert v["all_green"] is False
        assert "$0.12" in v["line"] and "$0.77" in v["line"]


class TestKFactorText:
    def test_k_factor_server_text_prints_per_100_like_the_chip(self):
        """Review follow-up 2026-11-06: the chip prints the ratio as "per 100"; the server's target,
        settle and verdict text printed the raw fraction ("0.05", "0.008")."""
        rows = _gates(k_factor=(3, 379))
        g9 = rows[8]
        assert g9["key"] == "k_factor"
        assert g9["target"]["text"] == ">= 5 per 100"
        assert g9["rag"] == "red" and g9["confidence"] == "provisional"
        assert "crosses 2 per 100 (yellow)" in g9["settle"]["text"]
        v = verdict(rows, channel_rows(point=154, lower=154, upper=154), focus(rows), measurement_test(rows),
                    {"point_cents": 154, "upper_cents": 154})
        assert "K-factor 0.79 per 100 red, provisional" in v["line"]
        assert "0.008" not in v["line"] and "0.05" not in v["line"]


# ---------------------------------------------------------------------------
# Seeded readers (Postgres)
# ---------------------------------------------------------------------------

def _uid(tag):
    return f"t14910-{tag}"


def get_pg():
    # Resolved at call time: pg_conn patches app.services.pg.get_pg after this module imports.
    from app.services.pg import get_pg as patched
    return patched()


def _user(tag, *, days_ago=30, test=False, build=TEST_BUILD, country=None, origin="organic"):
    uid = _uid(tag)
    create_user(uid, email=f"{uid}@test.com")
    register_test_user_ids(uid)
    create_user_segment(uid, origin, None, "otp")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE user_segments SET acquired_at = %s, signup_build = %s, country = %s "
                    "WHERE user_id = %s", (TODAY - timedelta(days=days_ago), build, country, uid))
        if test:
            cur.execute("UPDATE users SET is_test_account = true WHERE user_id = %s", (uid,))
    return uid


def _action(uid, action, *, days_ago, platform="webapp-desktop", count=1):
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_actions (user_id, action, platform, first_at, count) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (user_id, action, platform) DO UPDATE "
            "SET first_at = EXCLUDED.first_at, count = EXCLUDED.count",
            (uid, action, platform, NOW - timedelta(days=days_ago), count))


def _purchase(uid, cents, *, days_ago, tag=None):
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id, "
            "occurred_at, source) VALUES (%s, 'purchase', %s, 'usd', %s, %s, 'backfill')",
            (uid, cents, f"pi_t14910_{tag or uid}_{days_ago}", NOW - timedelta(days=days_ago)))


def _usage(uid, *, days_ago, succeeded=0, failed=0):
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_usage_daily (user_id, day, seconds, game_uploads_succeeded, "
            "game_uploads_failed) VALUES (%s, %s, 0, %s, %s)",
            (uid, TODAY - timedelta(days=days_ago), succeeded, failed))


def _daily(*, days_ago, **cols):
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    with get_pg() as conn:
        conn.cursor().execute(
            f"INSERT INTO daily_counters (counter_date, origin_type, {names}) VALUES (%s, 'all', {marks})",
            (TODAY - timedelta(days=days_ago), *cols.values()))


def _referral(referrer, referred):
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO referrals (referrer_id, referred_id, channel) VALUES (%s, %s, 'invite')",
            (referrer, referred))


def _read(excl=True):
    from app.routers.admin import _test_exclusion
    with get_pg() as conn:
        return build_spend_readiness(conn.cursor(), _test_exclusion(excl), NOW)


def _gate(payload, key):
    return next(g for g in payload["gates"] if g["key"] == key)


def _diag(key, excl=True):
    from app.routers.admin import _test_exclusion
    with get_pg() as conn:
        return build_gate_diagnosis(conn.cursor(), _test_exclusion(excl), NOW, key)


@pytest.fixture()
def pg(pg_conn):
    return pg_conn


class TestGateReaders:
    def test_payload_has_every_gate_in_order_with_tier_and_fields(self, pg):
        data = _read()
        assert [g["key"] for g in data["gates"]] == [g["key"] for g in C.GATES]
        for g in data["gates"]:
            assert g["rag"] in ("green", "yellow", "red", "grey")
            assert g["tier"] in ("A", "B", "C")
            for field in ("value", "n", "interval", "confidence", "settle", "recent", "target",
                          "why", "caveats", "unblock", "reference", "computed_at", "label_kind"):
                assert field in g, (g["key"], field)
        assert data["focus"] is None or data["focus"]["tier"] in ("A", "B", "C")
        assert set(data["measurement_test"]) == {"allowed", "blocking"}
        assert set(data["verdict"]) >= {"headline", "line", "all_green"}

    def test_gate_2_mature_cohort_edges_hit_deadline_and_test_exclusion(self, pg):
        # 21 mature users: 5 hits at day 13, 1 miss at day 15, the rest no export.
        for i in range(21):
            _user(f"g2-{i}", days_ago=30)
        for i in range(5):
            _action(_uid(f"g2-{i}"), "export_completed", days_ago=17)
        _action(_uid("g2-5"), "credits_consumed", days_ago=15)
        # Edges: 14 and 104 days ago count; 13 and 105 do not. Test account never counts.
        _user("g2-edge14", days_ago=14)
        _action(_uid("g2-edge14"), "export_completed", days_ago=1)
        _user("g2-edge104", days_ago=104)
        _user("g2-young", days_ago=13)
        _action(_uid("g2-young"), "export_completed", days_ago=1)
        _user("g2-old", days_ago=105)
        _user("g2-test", days_ago=30, test=True)
        _action(_uid("g2-test"), "export_completed", days_ago=17)
        g = _gate(_read(), "signup_to_export_14d")
        assert (g["k"], g["n"]) == (6, 23)
        assert g["value"] == pytest.approx(round(600 / 23, 2))
        assert g["rag"] == "green" and g["confidence"] == "provisional"
        assert g["recent"]["n"] == 22  # mature sign-ups of the last 30 d: all but the 104-day one
        assert g["target"] == {"green": 25, "yellow": 15, "direction": "higher", "text": ">= 25%"}
        assert _gate(_read(excl=False), "signup_to_export_14d")["n"] == 24

    def test_gates_2_and_4_carry_the_export_event_caveat_from_data_only(self, pg):
        data = _read()
        assert C.CAVEAT_EXPORT_EVENT in _gate(data, "signup_to_export_14d")["caveats"]
        assert C.CAVEAT_EXPORT_EVENT in _gate(data, "finished_to_took_away")["caveats"]
        _daily(days_ago=3, exports_started=3)
        data = _read()
        assert _gate(data, "signup_to_export_14d")["caveats"] == []
        assert _gate(data, "finished_to_took_away")["caveats"] == []

    def test_gate_3_upload_failure_span_recent_reference_and_exclusion(self, pg):
        _user("g3-a", days_ago=60)
        _usage(_uid("g3-a"), days_ago=80, succeeded=6, failed=4)
        _usage(_uid("g3-a"), days_ago=10, succeeded=6, failed=4)
        _user("g3-test", days_ago=60, test=True)
        _usage(_uid("g3-test"), days_ago=10, succeeded=0, failed=50)
        _user("g3-old", days_ago=120)
        _usage(_uid("g3-old"), days_ago=95, succeeded=0, failed=50)  # outside 90 d
        _daily(days_ago=5, game_uploads_succeeded=5, game_uploads_failed=5)
        g = _gate(_read(), "upload_failure")
        assert (g["k"], g["n"]) == (8, 20)
        assert g["value"] == 40.0 and g["rag"] == "red"
        assert g["target"]["direction"] == "lower"
        assert g["span"]["since"] == (TODAY - timedelta(days=80)).isoformat()
        assert (g["recent"]["k"], g["recent"]["n"]) == (4, 10)
        assert g["recent"]["value"] is None  # under the floor: counts only
        assert g["reference"]["value"] == 50.0 and g["reference"]["n"] == 10
        assert "test accounts" in g["reference"]["text"]

    def test_gate_4_finished_to_took_away_floor_and_progress(self, pg):
        for i in range(19):
            _user(f"g4-{i}", days_ago=40)
            _action(_uid(f"g4-{i}"), "overlay_exported", days_ago=30)
        for i in range(8):
            _action(_uid(f"g4-{i}"), "video_downloaded", days_ago=29)
        g = _gate(_read(), "finished_to_took_away")
        assert (g["k"], g["n"], g["rag"], g["value"]) == (8, 19, "grey", None)
        assert g["unblock"]["kind"] == "volume"
        assert g["unblock"]["need"]["have"] == 19 and g["unblock"]["need"]["floor"] == 20
        assert "1 more" in g["unblock"]["text"]
        _user("g4-20", days_ago=40)
        _action(_uid("g4-20"), "export_completed", days_ago=30)  # a true export also counts as finished
        _action(_uid("g4-20"), "share_completed", days_ago=29)
        g = _gate(_read(), "finished_to_took_away")
        assert (g["k"], g["n"], g["rag"]) == (9, 20, "red")
        assert g["target"]["green"] == C.FINISHED_TO_TOOK_AWAY_GREEN == 80

    def test_gate_5_money_ladder_counts_since_the_reprice(self, pg):
        since = (TODAY - C.REPRICE_DATE).days
        for i in range(3):
            _user(f"g5-{i}", days_ago=since + 5)
            _action(_uid(f"g5-{i}"), "paywall_shown", days_ago=max(since - 1, 0))
        _action(_uid("g5-0"), "credit_purchased", days_ago=max(since - 1, 0))
        _user("g5-before", days_ago=since + 5)
        _action(_uid("g5-before"), "paywall_shown", days_ago=since + 2)
        g = _gate(_read(), "money_ladder_n")
        assert g["value"] == {"paywall_users": 3, "buyers": 1}
        assert g["rag"] == "red" and g["confidence"] is None
        assert g["unblock"]["kind"] == "volume"
        assert g["unblock"]["need"]["have"] == 3 and g["unblock"]["need"]["floor"] == C.MONEY_LADDER_GREEN[0]

    def test_gate_5_rate_divides_by_the_days_observed_since_the_reprice(self, pg):
        """Review follow-up 2026-11-06: paywall users are counted since REPRICE_DATE, so the daily
        rate (and the ETA built on it) divides by the days observed since then, capped at
        COHORT_DAYS, never by a flat 90."""
        since = (TODAY - C.REPRICE_DATE).days
        observed = min(C.COHORT_DAYS, max(1, since))
        for i in range(3):
            _user(f"g5r-{i}", days_ago=since + 5)
            _action(_uid(f"g5r-{i}"), "paywall_shown", days_ago=max(since - 1, 0))
        g = _gate(_read(), "money_ladder_n")
        need = g["unblock"]["need"]
        assert need["have"] == 3 and need["floor"] == C.MONEY_LADDER_GREEN[0]
        assert need["rate_per_day"] == pytest.approx(3 / observed)
        assert need["eta_days"] == pytest.approx((C.MONEY_LADDER_GREEN[0] - 3) * observed / 3)
        assert f"at {3 / observed:.2f} a day" in g["unblock"]["text"]

    def test_gate_6_payers_per_100_and_gate_7_revenue_progress(self, pg):
        for i in range(25):
            _user(f"g6-{i}", days_ago=20)
        _purchase(_uid("g6-0"), 1999, days_ago=10)
        _purchase(_uid("g6-0"), 999, days_ago=5)  # a second purchase: one payer still
        _purchase(_uid("g6-1"), 2999, days_ago=170)
        _purchase(_uid("g6-2"), 4999, days_ago=200)  # outside 180 d for gate 7
        _user("g6-test", days_ago=20, test=True)
        _purchase(_uid("g6-test"), 9999, days_ago=10)
        data = _read()
        g6 = _gate(data, "payers_per_100")
        assert (g6["k"], g6["n"]) == (3, 25)
        assert g6["value"] == 12.0 and g6["rag"] == "green" and g6["confidence"] == "provisional"
        assert g6["interval"][0] < 5 < g6["interval"][1]
        g7 = _gate(data, "revenue_per_payer")
        assert g7["n"] == 2 and g7["rag"] == "grey"
        assert g7["value"] == (1999 + 999 + 2999) / 2
        assert g7["unblock"]["need"]["have"] == 2 and g7["unblock"]["need"]["floor"] == 20
        assert g7["label_kind"] == "M"
        assert data["break_even"]["readable"] is False
        assert data["break_even"]["inputs"]["payers_per_signup"] == pytest.approx(3 / 25)

    def test_gate_8_repeat_purchase_eligibility_date(self, pg):
        _user("g8-repeat", days_ago=300)
        _purchase(_uid("g8-repeat"), 1000, days_ago=200)
        _purchase(_uid("g8-repeat"), 1000, days_ago=70)  # 130 d after the first
        _user("g8-once", days_ago=300)
        _purchase(_uid("g8-once"), 1000, days_ago=190)
        _user("g8-quick", days_ago=300)
        _purchase(_uid("g8-quick"), 1000, days_ago=200)
        _purchase(_uid("g8-quick"), 1000, days_ago=150)  # only 50 d later: not a repeat
        _user("g8-young", days_ago=120)
        _purchase(_uid("g8-young"), 1000, days_ago=100)  # not yet eligible
        g = _gate(_read(), "repeat_purchase")
        assert (g["k"], g["n"]) == (1, 3)
        assert g["rag"] == "grey" and g["unblock"]["kind"] == "time"
        assert (TODAY - timedelta(days=100) + timedelta(days=C.REPEAT_AGE_DAYS)).isoformat() in g["unblock"]["text"]
        assert "of 20 eligible" in g["unblock"]["text"]

    def test_gate_9_k_factor_counts_referrals_rows(self, pg):
        _user("g9-ref", days_ago=200)
        for i in range(30):
            _user(f"g9-{i}", days_ago=20)
        for i in range(3):
            _referral(_uid("g9-ref"), _uid(f"g9-{i}"))
        g = _gate(_read(), "k_factor")
        assert (g["k"], g["n"]) == (3, 30)
        assert g["value"] == 0.1 and g["rag"] == "green"
        assert g["recent"]["n"] == 30

    def test_gates_10_and_11_are_grey_until_t15200(self, pg):
        data = _read()
        g10, g11 = _gate(data, "attribution_coverage"), _gate(data, "kickback_payers_per_100")
        assert g10["rag"] == "grey" and g10["unblock"]["kind"] == "none"
        assert "T15200" in g10["unblock"]["text"]
        assert g11["rag"] == "grey" and g11["unblock"]["kind"] == "volume"
        assert g11["unblock"]["need"]["floor"] == C.KICKBACK_MIN_SIGNUPS

    def test_gate_1_is_grey_not_instrumented_without_visit_daily(self, pg):
        g = _gate(_read(), "visit_to_signup")
        assert g["rag"] == "grey" and g["unblock"]["kind"] == "task"
        assert "not instrumented" in g["unblock"]["text"]

    def test_signups_by_country_for_the_window_with_unknown(self, pg):
        for i in range(3):
            _user(f"cty-us-{i}", days_ago=10, country="US")
        _user("cty-ca", days_ago=10, country="CA")
        _user("cty-none", days_ago=10)
        _user("cty-old", days_ago=100, country="GB")
        rows = {r["country"]: r for r in _read()["signups_by_country"]}
        assert rows["US"]["n"] == 3 and rows["US"]["pct"] == 60.0
        assert rows["unknown"]["n"] == 1
        assert "GB" not in rows


class TestNoBreakEvenEstimate:
    """T14910 follow-up (2026-11-06): no payers or no sign-ups means NO UPPER BOUND, so no channel
    may read settled and no reason may quote a $0.00 bound as evidence. Through the production
    path (build_spend_readiness), never hand-picked bounds. A real upper bound under the floor
    (one payer) still rules the dear channels out, as design section 4 allows."""

    @staticmethod
    def _assert_no_estimate(data, missing):
        be = data["break_even"]
        assert be["point_cents"] is None and be["upper_cents"] is None and be["lower_cents"] is None
        priced = [c for c in data["channels"] if c["key"] != "club_placement"]
        assert len(priced) == 5
        assert all((c["state"], c["confidence"]) == ("grey", None) for c in priced), [
            (c["key"], c["state"], c["confidence"]) for c in priced]
        assert all("$0.00" not in c["reason"] and missing in c["reason"] for c in priced)
        assert not any(c["confidence"] == "settled" for c in data["channels"])
        line = data["verdict"]["line"]
        assert "$0.00" not in line and f"no estimate yet ({missing})" in line
        assert data["verdict"]["all_green"] is False
        assert be["readable"] is False and be["no_estimate"] == missing and be["binding_input"] is None
        assert missing in be["text"]

    def test_empty_database_has_no_upper_bound_so_no_channel_is_settled(self, pg):
        self._assert_no_estimate(_read(), f"0 sign-ups in the {C.COHORT_DAYS} d cohort")

    def test_many_signups_and_no_payers_is_grey_not_a_settled_no(self, pg):
        for i in range(30):
            _user(f"np-{i}", days_ago=20)
        data = _read()
        assert _gate(data, "payers_per_100")["n"] == 30
        self._assert_no_estimate(data, f"0 payers in {C.REVENUE_DAYS} d")
        assert data["break_even"]["inputs"]["revenue_per_payer_cents"] is None
        assert data["break_even"]["inputs"]["payers_per_signup"] == 0.0

    def test_one_payer_gives_a_real_upper_bound_that_still_rules_meta_out(self, pg):
        for i in range(100):
            _user(f"op-{i}", days_ago=20)
        _purchase(_uid("op-0"), 1999, days_ago=10)
        data = _read()
        be = data["break_even"]
        assert be["readable"] is False and be["no_estimate"] is None
        assert 0 < be["upper_cents"] < 300
        rows = {c["key"]: c for c in data["channels"]}
        assert (rows["meta_reels"]["state"], rows["meta_reels"]["confidence"]) == ("NO", "settled")
        assert (rows["reddit_central"]["state"], rows["reddit_central"]["confidence"]) == ("NO", "settled")
        assert "even at the upper bound" in rows["meta_reels"]["reason"]
        assert "$0.00" not in rows["meta_reels"]["reason"]
        assert rows["coach_credits"]["confidence"] == "provisional"
        assert f"at most {_dollars(be['upper_cents'])}" in data["verdict"]["line"]


class TestDiagnosis:
    def test_weekly_buckets_split_at_the_monday_edge_and_fill_twelve_weeks(self, pg):
        monday = TODAY - timedelta(days=TODAY.weekday()) - timedelta(weeks=5)
        _user("wk-mon", days_ago=(TODAY - monday).days)
        _user("wk-sun", days_ago=(TODAY - monday).days + 1)
        _action(_uid("wk-mon"), "export_completed", days_ago=(TODAY - monday).days - 2)
        weeks = _diag("signup_to_export_14d")["cuts"]["weekly"]
        assert len(weeks) == C.WEEKLY_WEEKS
        by = {w["group"]: w for w in weeks}
        assert by[monday.isoformat()]["n"] == 1 and by[monday.isoformat()]["k"] == 1
        assert by[(monday - timedelta(weeks=1)).isoformat()]["n"] == 1
        assert by[monday.isoformat()]["value"] is None  # under the floor: counts only
        assert by[monday.isoformat()]["text"] == "1 of 1"

    def test_by_build_keeps_the_last_four_builds_newest_first(self, pg):
        for b in range(14910, 14915):
            _user(f"bd-{b}", days_ago=30, build=b)
        builds = _diag("signup_to_export_14d")["cuts"]["by_build"]
        assert [r["group"] for r in builds] == [14914, 14913, 14912, 14911]

    def test_by_platform_uses_the_device_family_and_keeps_unknown(self, pg):
        _user("pf-mobile", days_ago=30)
        _action(_uid("pf-mobile"), "session_started", days_ago=29, platform="pwa-mobile")
        _user("pf-desktop", days_ago=30)
        _action(_uid("pf-desktop"), "session_started", days_ago=29, platform="webapp-desktop")
        _user("pf-none", days_ago=30)
        rows = {r["group"]: r for r in _diag("finished_to_took_away")["cuts"]["by_platform"]}
        assert rows == {}  # none of them finished a highlight
        rows = {r["group"]: r for r in _diag("signup_to_export_14d")["cuts"]["by_platform"]}
        assert rows["mobile"]["n"] == 1 and rows["desktop"]["n"] == 1 and rows["unknown"]["n"] == 1

    def test_by_country_top_three_plus_unknown(self, pg):
        for c, n in [("US", 4), ("CA", 3), ("GB", 2), ("DE", 1)]:
            for i in range(n):
                _user(f"cc-{c}-{i}", days_ago=30, country=c)
        _user("cc-none", days_ago=30)
        rows = [r["group"] for r in _diag("signup_to_export_14d")["cuts"]["by_country"]]
        assert rows[:3] == ["US", "CA", "GB"]
        assert "unknown" in rows and "DE" not in rows

    def test_gate_3_cuts_by_attempt_week_build_and_platform(self, pg):
        _user("u3-a", days_ago=40, build=14911)
        _action(_uid("u3-a"), "session_started", days_ago=39, platform="pwa-mobile")
        _usage(_uid("u3-a"), days_ago=8, succeeded=1, failed=1)
        d = _diag("upload_failure")["cuts"]
        assert sum(w["n"] for w in d["weekly"]) == 2
        assert d["by_build"][0] == {"group": 14911, "n": 2, "k": 1, "value": None, "interval": None,
                                    "rag": "grey", "confidence": None, "text": "1 of 2"}
        assert d["by_platform"][0]["group"] == "mobile"

    def test_repeat_purchase_has_no_drawer_and_every_gate_says_whether_it_has_one(self, pg):
        """Review follow-up 2026-11-06: gate 8's eligible payers are REPEAT_AGE_DAYS old by
        definition, so a last-12-weeks cut was always 0 of 0. No drawer; the payload says so."""
        flags = {g["key"]: g["diagnosable"] for g in _read()["gates"]}
        assert flags == {"visit_to_signup": False, "signup_to_export_14d": True, "upload_failure": True,
                         "finished_to_took_away": True, "money_ladder_n": False, "payers_per_100": True,
                         "revenue_per_payer": True, "repeat_purchase": False, "k_factor": True,
                         "attribution_coverage": False, "kickback_payers_per_100": False}
        with pytest.raises(KeyError):
            _diag("repeat_purchase")
        with pytest.raises(KeyError):
            _diag("kickback_payers_per_100")

    def test_tier_c_gets_weekly_only_and_tier_a_has_no_drawer(self, pg):
        d = _diag("payers_per_100")
        assert list(d["cuts"]) == ["weekly"]
        with pytest.raises(KeyError):
            _diag("visit_to_signup")
        with pytest.raises(KeyError):
            _diag("nope")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@pytest.fixture()
def client(pg_conn, tmp_path):
    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    create_user("regular-user", email="regular@test.com")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


class TestEndpoints:
    def test_spend_readiness_requires_admin(self, client):
        assert client.get("/api/admin/analytics/spend-readiness",
                          headers={"X-User-ID": "regular-user"}).status_code == 403
        resp = client.get("/api/admin/analytics/spend-readiness", headers={"X-User-ID": "admin-user"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["gates"]) == 11
        assert len(body["channels"]) == len(C.CHANNELS)
        assert "signups_by_country" in body and "computed_at" in body

    def test_gate_diagnosis_404s_only_on_validation_and_lets_a_real_bug_propagate(self, client):
        """Review follow-up 2026-11-06: `except KeyError` around the builder turned any KeyError
        bug into a 404. The route validates the key first and catches nothing."""
        admin = {"X-User-ID": "admin-user"}
        assert client.get("/api/admin/analytics/spend-readiness/gate/repeat_purchase", headers=admin).status_code == 404
        assert client.get("/api/admin/analytics/spend-readiness/gate/kickback_payers_per_100",
                          headers=admin).status_code == 404
        with patch("app.services.analytics_spend_readiness.build_gate_diagnosis", side_effect=KeyError("bug")), \
             pytest.raises(KeyError, match="bug"):
            client.get("/api/admin/analytics/spend-readiness/gate/upload_failure", headers=admin)

    def test_gate_diagnosis_requires_admin_and_404s_unknown_or_tier_a(self, client):
        assert client.get("/api/admin/analytics/spend-readiness/gate/upload_failure",
                          headers={"X-User-ID": "regular-user"}).status_code == 403
        ok = client.get("/api/admin/analytics/spend-readiness/gate/upload_failure",
                        headers={"X-User-ID": "admin-user"})
        assert ok.status_code == 200, ok.text
        assert set(ok.json()["cuts"]) == {"weekly", "by_build", "by_platform", "by_country"}
        assert client.get("/api/admin/analytics/spend-readiness/gate/visit_to_signup",
                          headers={"X-User-ID": "admin-user"}).status_code == 404
        assert client.get("/api/admin/analytics/spend-readiness/gate/nope",
                          headers={"X-User-ID": "admin-user"}).status_code == 404


class TestGateDrillUsers:
    """The Users list a gate drill opens is the gate's own lost users, not a stage approximation."""

    def _ids(self, client, key):
        resp = client.get(f"/api/admin/users?spend_gate={key}&exclude_test=true",
                          headers={"X-User-ID": "admin-user"})
        assert resp.status_code == 200, resp.text
        return {u["user_id"] for u in resp.json()["users"]}

    def test_gate_4_lists_every_exporter_who_did_not_take_it_away(self, client):
        credits_only = _user("g4-credits")      # exported before export_completed existed
        _action(credits_only, "credits_consumed", days_ago=25)
        completed = _user("g4-completed")       # stopped at Highlight made, never Finished
        _action(completed, "export_completed", days_ago=25)
        finished = _user("g4-finished")
        _action(finished, "overlay_exported", days_ago=25)
        kept = _user("g4-kept")
        _action(kept, "overlay_exported", days_ago=25)
        _action(kept, "video_downloaded", days_ago=24)
        never = _user("g4-never")
        too_new = _user("g4-new", days_ago=5)
        _action(too_new, "overlay_exported", days_ago=4)
        test_account = _user("g4-test", test=True)
        _action(test_account, "overlay_exported", days_ago=25)

        ids = self._ids(client, "finished_to_took_away")
        assert ids == {credits_only, completed, finished}
        assert kept not in ids and never not in ids
        g = _gate(_read(), "finished_to_took_away")
        assert len(ids) == g["n"] - g["k"]

    def test_gate_2_lists_sign_ups_without_an_export_inside_14_days(self, client):
        never = _user("g2-never")
        late = _user("g2-late")
        _action(late, "export_completed", days_ago=5)       # 25 days after sign-up
        in_time = _user("g2-in-time")
        _action(in_time, "export_completed", days_ago=25)
        credits = _user("g2-credits")                       # stopped early on the ladder, still exported
        _action(credits, "credits_consumed", days_ago=25)

        ids = self._ids(client, "signup_to_export_14d")
        assert ids == {never, late}
        g = _gate(_read(), "signup_to_export_14d")
        assert len(ids) == g["n"] - g["k"]

    @pytest.mark.parametrize("age,listed", [(13, False), (14, True), (104, True), (105, False)])
    def test_the_list_uses_the_gate_window_at_both_edges(self, client, age, listed):
        uid = _user(f"g2-age-{age}", days_ago=age)
        assert (uid in self._ids(client, "signup_to_export_14d")) is listed

    @pytest.mark.parametrize("segment", ["origin=meta-test", "acquired_from=2026-10-01", "acquired_to=2026-10-31",
                                         "build=1405", "country=CA"])
    def test_a_segment_filter_cannot_narrow_a_gate(self, client, segment):
        resp = client.get(f"/api/admin/users?spend_gate=finished_to_took_away&{segment}",
                          headers={"X-User-ID": "admin-user"})
        assert resp.status_code == 422, resp.text

    def test_rejects_an_unknown_gate_and_a_mixed_filter(self, client):
        admin = {"X-User-ID": "admin-user"}
        assert client.get("/api/admin/users?spend_gate=payers_per_100", headers=admin).status_code == 422
        assert client.get("/api/admin/users?spend_gate=finished_to_took_away&journey_stage=finished&journey_outcome=lost",
                          headers=admin).status_code == 422
        assert client.get("/api/admin/users?spend_gate=finished_to_took_away&filter=paying",
                          headers=admin).status_code == 422
