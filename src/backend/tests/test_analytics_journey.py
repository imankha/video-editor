"""T14010: Journey map pure fold -- conservation, skip edges, loss ranking, honesty rules.
Endpoint behaviour against Postgres: test_analytics_journey_endpoint.py."""
from datetime import date

import pytest

from app.analytics import EVENT_INSTRUMENTED_AT, JOURNEY_LADDER
from app.services import analytics_journey as aj

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

    def test_five_major_stages_bracket_the_ladder(self):
        majors = [st["key"] for st in JOURNEY_LADDER if st.get("major")]
        assert majors == ["signed_up", "clipped", "exported", "finished", "took_away"]
        assert JOURNEY_LADDER[0].get("major") and JOURNEY_LADDER[-1].get("major")

    def test_nodes_carry_major(self):
        folded = aj.fold_journey([_pat([], "gone")], JOURNEY_LADDER)
        assert [n["key"] for n in folded["nodes"] if n["major"]] == [
            "signed_up", "clipped", "exported", "finished", "took_away"]


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


# ---------------------------------------------------------------------------
# T14020: Step inspector folds (timing, Wilson, breakdown, lift, why)
# ---------------------------------------------------------------------------
from datetime import UTC, datetime, timedelta  # noqa: E402

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
T0 = NOW - timedelta(days=60)


def _user_row(uid, reached, *, platform="pwa-mobile", origin="organic", build=1,
              month="2026-09", last_active_days=0):
    """`reached` = {stage_key: first_at}; signed_up is implicit at T0."""
    firsts = [None] * len(KEYS)
    firsts[0] = T0
    for k, at in reached.items():
        firsts[KEYS.index(k)] = at
    return {"user_id": uid, "platform": platform, "origin": origin, "signup_build": build,
            "signup_month": month, "last_active_at": NOW - timedelta(days=last_active_days),
            "firsts": firsts}


def _classified(rows, **kw):
    return [aj.classify_user(r, JOURNEY_LADDER, NOW, 14, 14) for r in rows]


class TestClassifyUser:
    def test_furthest_and_outcomes(self):
        started = T0 + timedelta(days=1)
        stuck = aj.classify_user(_user_row("a", {"started": started}), JOURNEY_LADDER, NOW, 14, 14)
        gone = aj.classify_user(_user_row("b", {"started": started}, last_active_days=30),
                                JOURNEY_LADDER, NOW, 14, 14)
        pending = aj.classify_user(_user_row("c", {"started": NOW - timedelta(days=3)}),
                                   JOURNEY_LADDER, NOW, 14, 14)
        assert (stuck["furthest"], stuck["outcome"]) == (KEYS.index("started"), "stuck")
        assert gone["outcome"] == "gone"
        assert pending["outcome"] == "in_window"


class TestWilson:
    def test_known_values(self):
        assert aj.wilson_lower(0, 0) == 0.0
        # 8/10 at 95%: textbook lower bound 0.4902
        assert round(aj.wilson_lower(8, 10), 3) == 0.490
        assert aj.wilson_lower(0, 10) == 0.0
        assert aj.wilson_lower(10, 10) < 1.0


class TestTimeToNext:
    def _users(self, deltas):
        rows = []
        for i, d in enumerate(deltas):
            at = T0 + timedelta(days=1)
            rows.append(_user_row(f"u{i}", {"started": at, "add_footage": at + d}))
        return _classified(rows)

    def test_median_p75_and_buckets(self):
        deltas = [timedelta(minutes=10), timedelta(minutes=30), timedelta(hours=5),
                  timedelta(days=2), timedelta(days=6), timedelta(days=20)]
        out = aj.time_to_next(self._users(deltas), KEYS.index("started"), JOURNEY_LADDER)
        assert out["stage"] == "add_footage"
        assert out["buckets"] == {"lt_1h": 2, "same_day": 1, "d2_3": 1, "d4_14": 1, "gt_14d": 1}
        # sorted deltas: 10m 30m 5h 2d 6d 20d -> median is the mean of 5h and 2d
        assert out["median_s"] == (5 * 3600 + 2 * 86400) / 2
        assert out["n"] == 6 and out["out_of_order"] == 0

    def test_negative_deltas_counted_not_clamped(self):
        users = self._users([timedelta(hours=2), -timedelta(hours=3)])
        out = aj.time_to_next(users, KEYS.index("started"), JOURNEY_LADDER)
        assert out["out_of_order"] == 1
        assert out["n"] == 1
        assert out["median_s"] == 2 * 3600
        assert sum(out["buckets"].values()) == 1

    def test_no_continuers_has_no_median(self):
        out = aj.time_to_next([], KEYS.index("started"), JOURNEY_LADDER)
        assert out["median_s"] is None and out["p75_s"] is None and out["n"] == 0


class TestBreakdown:
    def test_sorted_by_loss_with_wilson_and_small_n(self):
        rows = []
        # mobile: 3 stuck at started (small n); desktop: 25 judged, 5 continued, 20 gone
        for i in range(3):
            rows.append(_user_row(f"m{i}", {"started": T0}, platform="pwa-mobile"))
        for i in range(5):
            rows.append(_user_row(f"dc{i}", {"started": T0, "add_footage": T0}, platform="pwa-desktop"))
        for i in range(20):
            rows.append(_user_row(f"dg{i}", {"started": T0}, platform="pwa-desktop", last_active_days=40))
        out = aj.step_breakdown(_classified(rows), KEYS.index("started"), "platform")
        assert [r["key"] for r in out] == ["pwa-desktop", "pwa-mobile"]
        desk, mob = out
        assert (desk["reached"], desk["continued"], desk["gone"], desk["stuck"]) == (25, 5, 20, 0)
        assert desk["rate"]["pct"] == 20.0 and desk["rate"]["n"] == 25
        assert desk["rate_lb"] == round(100 * aj.wilson_lower(5, 25), 1)
        assert mob["rate"] == {"pct": None, "k": 0, "n": 3}  # k / n below 20 judged

    def test_unknown_dimension_rejected(self):
        with pytest.raises(ValueError):
            aj.step_breakdown([], 1, "shoe_size")


class TestLift:
    def _population(self, n_dropped, n_continued):
        rows = [_user_row(f"d{i}", {"started": T0}) for i in range(n_dropped)]
        rows += [_user_row(f"c{i}", {"started": T0, "add_footage": T0}) for i in range(n_continued)]
        return _classified(rows)

    def test_lift_threshold_and_sort(self):
        users = self._population(10, 10)
        after = T0 + timedelta(hours=1)
        side = {
            "dialog_impression:too_big": {f"d{i}": after for i in range(6)} | {f"c{i}": after for i in range(2)},
            "paywall_shown": {f"d{i}": after for i in range(5)} | {f"c{i}": after for i in range(5)},
            "draft_saved": {f"d{i}": after for i in range(2)} | {f"c{i}": after for i in range(9)},
            "preview_started": {f"d{i}": after for i in range(9)},  # 0 continued -> hidden
        }
        out = aj.side_action_lift(users, KEYS.index("started"), side)
        names = [r["action"] for r in out]
        assert "preview_started" not in names and "draft_saved" not in names
        assert names == ["paywall_shown"]
        pw = next(r for r in out if r["action"] == "paywall_shown")
        assert (pw["n_dropped"], pw["n_continued"], pw["lift"]) == (5, 5, 1.0)

    def test_two_rows_sorted_by_lift_desc(self):
        users = self._population(10, 10)
        after = T0 + timedelta(hours=1)
        side = {
            "buy_modal_opened": {f"d{i}": after for i in range(5)} | {f"c{i}": after for i in range(5)},
            "dialog_impression:too_big": {f"d{i}": after for i in range(8)} | {f"c{i}": after for i in range(5)},
        }
        out = aj.side_action_lift(users, KEYS.index("started"), side)
        assert [r["action"] for r in out] == ["dialog_impression:too_big", "buy_modal_opened"]

    def test_actions_before_the_stage_do_not_count(self):
        users = self._population(6, 6)
        before = T0 - timedelta(hours=1)
        side = {"paywall_shown": {u["user_id"]: before for u in users}}
        assert aj.side_action_lift(users, KEYS.index("started"), side) == []

    def test_in_window_users_are_not_judged(self):
        rows = [_user_row(f"p{i}", {"started": NOW - timedelta(days=2)}) for i in range(8)]
        rows += [_user_row(f"c{i}", {"started": T0, "add_footage": T0}) for i in range(8)]
        side = {"paywall_shown": {u["user_id"]: NOW for u in _classified(rows)}}
        assert aj.side_action_lift(_classified(rows), KEYS.index("started"), side) == []


class TestWhy:
    def test_failures_grouped_by_base_and_reason_impressions_by_slug(self):
        users = _classified([_user_row(f"d{i}", {"started": T0}) for i in range(4)])
        after = T0 + timedelta(hours=1)
        side = {
            "game_upload_failed:timeout": {"d0": after, "d1": after},
            "game_upload_failed:network": {"d2": after},
            "dialog_impression:file_too_large": {"d0": after, "d3": after},
            "toast_impression:oops": {"d1": T0 - timedelta(hours=1)},  # before the stage
            "paywall_shown": {"d0": after},  # neither failure nor impression
        }
        out = aj.why_signals(users, KEYS.index("started"), side)
        assert out["failures"] == [
            {"event": "game_upload_failed", "reason": "timeout", "users": 2},
            {"event": "game_upload_failed", "reason": "network", "users": 1}]
        assert out["impressions"] == [{"slug": "dialog_impression:file_too_large", "users": 2}]
