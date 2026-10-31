"""T14010: Journey map -- fold conservation, classification, skip edges, honesty rules,
and the endpoint against Postgres (window / inactivity boundaries, filters)."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import (
    EVENT_INSTRUMENTED_AT,
    FUNNEL_STEPS,
    JOURNEY_LADDER,
    create_user_segment,
    record_milestone,
)
from app.services import analytics_journey as aj
from app.services.auth_db import create_user

TEST_BUILD = 14010
KEYS = [s["key"] for s in JOURNEY_LADDER]


def _mask(*keys):
    m = 1  # signed_up is always reached
    for k in keys:
        m |= 1 << KEYS.index(k)
    return m


def _pat(keys, outcome, n=1):
    return {"mask": _mask(*keys), "outcome": outcome, "n": n}


def _node(folded, key):
    return next(n for n in folded["nodes"] if n["key"] == key)


class TestLadder:
    def test_fourteen_stages_in_three_bands(self):
        assert len(JOURNEY_LADDER) == 14
        assert [b["key"] for b in aj._bands(JOURNEY_LADDER)] == [
            "get_footage_in", "make_highlight", "take_it_away"]

    def test_every_action_is_instrumented_and_known(self):
        from app.analytics import FLOW_EVENTS
        for stage in JOURNEY_LADDER:
            for a in stage["actions"]:
                assert a in FLOW_EVENTS, a
                assert a in EVENT_INSTRUMENTED_AT, a

    def test_full_mode_has_every_funnel_step(self):
        full = aj.ladder_for("full")
        assert [s["key"] for s in full[1:]] == FUNNEL_STEPS


class TestFold:
    def test_conservation_and_edges(self):
        patterns = [
            _pat([], "gone", 3),
            _pat(["started"], "stuck", 2),
            _pat(["started", "add_footage"], "in_window", 1),
            _pat(["started", "add_footage", "footage_landed", "clipped"], "gone", 4),
            _pat(["started", "clipped"], "stuck", 1),  # shared-in: skips add/landed
        ]
        folded = aj.fold_journey(patterns, JOURNEY_LADDER)
        started = _node(folded, "started")
        assert started["reached"] == 8
        assert started["stuck"] == 2 and started["continued"] == 6
        add = _node(folded, "add_footage")
        assert (add["reached"], add["in_window"], add["continued"]) == (5, 1, 4)
        aj.check_conservation(folded["nodes"], folded["edges"])  # no raise

    def test_skip_edge_flagged_and_not_a_drop(self):
        # Finish Now: Exported -> Finished with no spotlight stages.
        patterns = [_pat(["exported", "finished"], "stuck", 2)]
        folded = aj.fold_journey(patterns, JOURNEY_LADDER)
        edge = next(e for e in folded["edges"] if e["from"] == "exported")
        assert edge == {"from": "exported", "to": "finished", "users": 2, "skip": True}
        exported = _node(folded, "exported")
        assert exported["continued"] == 2 and exported["stuck"] == 0 and exported["gone"] == 0

    def test_conservation_violation_raises(self):
        nodes = [{"key": "a", "reached": 5, "continued": 1, "in_window": 1, "stuck": 1, "gone": 1}]
        with pytest.raises(AssertionError):
            aj.check_conservation(nodes, [])

    def test_loss_ranking_sorted_excludes_terminal_and_zero(self):
        patterns = [
            _pat(["started"], "stuck", 2),
            _pat(["started", "add_footage"], "gone", 5),
            _pat(["started", "add_footage", "footage_landed", "clipped"], "in_window", 9),
            _pat(KEYS[1:], "gone", 7),  # furthest = took_away (terminal)
        ]
        loss = aj.fold_journey(patterns, JOURNEY_LADDER)["loss"]
        assert [r["stage"] for r in loss] == ["add_footage", "started"]
        assert loss[0]["lost"] == 5 and loss[1]["still_visiting"] == 2
        assert loss[0]["judged"] == 21  # continued 16 + gone 5; in_window excluded

    def test_empty_mask_rejected(self):
        with pytest.raises(ValueError):
            aj.fold_journey([{"mask": 0, "outcome": "gone", "n": 1}], JOURNEY_LADDER)


class TestHonesty:
    def test_small_n_has_no_percent(self):
        assert aj.percent_or_fraction(3, 19) == {"pct": None, "k": 3, "n": 19}
        assert aj.percent_or_fraction(10, 20)["pct"] == 50.0

    def test_partial_and_no_data_flags(self):
        nodes = [{"key": "x"}, {"key": "y"}, {"key": "z"}]
        ladder = [
            {"key": "x", "actions": []},
            {"key": "y", "actions": ["new_a"]},
            {"key": "z", "actions": ["new_b"]},
        ]
        instr = {"new_a": "2026-06-01", "new_b": "2026-09-01"}
        aj.annotate_coverage(nodes, ladder, date(2026, 5, 1), date(2026, 8, 1), instr)
        assert nodes[0]["partial_from"] is None and not nodes[0]["no_data"]
        assert nodes[1]["partial_from"] == "2026-06-01" and not nodes[1]["no_data"]
        assert nodes[2]["no_data"] is True and nodes[2]["partial_from"] is None

    def test_missing_instrumented_entry_fails_loudly(self):
        with pytest.raises(KeyError):
            aj.annotate_coverage([{}], [{"key": "q", "actions": ["nope"]}],
                                 date(2026, 1, 1), date(2026, 2, 1), {})


# --- endpoint against Postgres -------------------------------------------------

def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _age(user_id, *, action_days=None, active_days=0, acquired_days=60):
    """Backdate a user: every action's first_at, last_active_at and acquired_at."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        if action_days is not None:
            cur.execute("UPDATE user_actions SET first_at = now() - make_interval(days => %s) "
                        "WHERE user_id = %s", (action_days, user_id))
        cur.execute("UPDATE user_segments SET last_active_at = now() - make_interval(days => %s), "
                    "acquired_at = CURRENT_DATE - %s WHERE user_id = %s",
                    (active_days, acquired_days, user_id))


@pytest.fixture()
def journey_client(pg_conn, tmp_path):
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _user(uid, origin="organic"):
    create_user(uid, email=f"{uid}@test.com")
    create_user_segment(uid, origin, None, "otp")
    # The shared dev DB holds unrelated users: scope every test to a private build id.
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute("UPDATE user_segments SET signup_build = %s WHERE user_id = %s",
                              (TEST_BUILD, uid))


def _get(client, **params):
    q = {"from": (date.today() - timedelta(days=200)).isoformat(),
         "to": date.today().isoformat(), "build": TEST_BUILD, **params}
    resp = client.get("/api/admin/analytics/journey", params=q, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_key(data):
    return {n["key"]: n for n in data["nodes"]}


class TestEndpoint:
    def test_non_admin_403(self, journey_client):
        _user("regular-user")
        resp = journey_client.get("/api/admin/analytics/journey", headers=_auth("regular-user"))
        assert resp.status_code == 403

    def test_classification_at_window_and_inactivity_boundaries(self, journey_client):
        # All four stop at "started". W=14, I=14.
        for uid, action_days, active_days in [
            ("user-1", 13, 0),    # inside window  -> in_window
            ("user-2", 15, 13),     # past window, active within I -> stuck
            ("user-a", 15, 15),      # past window, idle >= I -> gone
            ("user-b", 30, 20),
        ]:
            _user(uid)
            record_milestone(uid, "session_started")
            _age(uid, action_days=action_days, active_days=active_days)
        started = _by_key(_get(journey_client))["started"]
        assert started["reached"] == 4
        assert (started["in_window"], started["stuck"], started["gone"]) == (1, 1, 2)
        assert started["continued"] == 0

    def test_window_and_inactivity_controls_change_split(self, journey_client):
        _user("user-c")
        record_milestone("user-c", "session_started")
        _age("user-c", action_days=10, active_days=10)
        wide = _by_key(_get(journey_client, window_days=14))["started"]
        assert wide["in_window"] == 1
        narrow = _by_key(_get(journey_client, window_days=7, inactive_days=14))["started"]
        assert narrow["stuck"] == 1
        idle = _by_key(_get(journey_client, window_days=7, inactive_days=5))["started"]
        assert idle["gone"] == 1

    def test_conservation_over_http_and_skip_edge(self, journey_client):
        _user("test-user")
        for a in ("session_started", "export_completed", "overlay_exported"):
            record_milestone("test-user", a)
        _age("test-user", action_days=30, active_days=0)
        data = _get(journey_client)
        for n in data["nodes"]:
            assert n["reached"] == n["continued"] + n["in_window"] + n["stuck"] + n["gone"]
        edge = next(e for e in data["edges"] if e["from"] == "exported")
        assert edge["to"] == "finished" and edge["skip"] is True
        assert _by_key(data)["finished"]["stuck"] == 1

    def test_filters_origin_build_platform_and_test_exclusion(self, journey_client):
        _user("test-user-1", "organic")
        _user("target-user", "paid")
        for u in ("test-user-1", "target-user"):
            record_milestone(u, "session_started")
        assert _by_key(_get(journey_client))["signed_up"]["reached"] == 2
        assert _by_key(_get(journey_client, origin="paid"))["signed_up"]["reached"] == 1
        assert _by_key(_get(journey_client, build=987654))["signed_up"]["reached"] == 0
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute("UPDATE users SET is_test_account = true WHERE user_id = 'target-user'")
        assert _by_key(_get(journey_client))["signed_up"]["reached"] == 1
        assert _by_key(_get(journey_client, exclude_test="false"))["signed_up"]["reached"] == 2
        assert _by_key(_get(journey_client, platform="no-such-platform"))["signed_up"]["reached"] == 0

    def test_full_mode_and_meta_and_money(self, journey_client):
        _user("other-regular")
        record_milestone("other-regular", "paywall_shown")
        data = _get(journey_client, steps="full")
        assert len(data["nodes"]) == len(FUNNEL_STEPS) + 1
        assert data["meta"]["window_days"] == 14 and data["meta"]["inactive_days"] == 14
        compact = _get(journey_client)
        assert [n["key"] for n in compact["money"]["nodes"]] == [
            "paywall_shown", "buy_modal_opened", "credit_purchased"]
        assert compact["money"]["nodes"][0]["reached"] == 1

    def test_invalid_steps_422(self, journey_client):
        resp = journey_client.get("/api/admin/analytics/journey?steps=bogus", headers=_auth())
        assert resp.status_code == 422
