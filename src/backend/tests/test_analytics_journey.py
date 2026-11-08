"""T14010: Journey map pure fold -- conservation, implied reach, loss ranking, honesty rules.
Endpoint behaviour against Postgres: test_analytics_journey_endpoint.py."""
import random
from datetime import date
from itertools import pairwise

import pytest

from app.analytics import EVENT_INSTRUMENTED_AT, JOURNEY_LADDER, JOURNEY_MONEY_LADDER
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
        assert len(JOURNEY_LADDER) == 16
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


    def test_labels_use_the_copy_glossary_and_keys_stay_frozen(self):
        assert [(s["key"], s["label"]) for s in JOURNEY_LADDER] == [
            ("signed_up", "Signed up"),
            ("started", "Started"),
            ("add_footage", "Opened upload"),
            ("file_picked", "Picked a file"),
            ("upload_started", "Upload started"),
            ("footage_landed", "Video uploaded"),
            ("clipped", "First play"),
            ("frame_opened", "Opened Frame"),
            ("framed", "Moved the box"),
            ("export_pressed", "Pressed Sharpen my highlight"),
            ("exported", "Highlight made"),
            ("spotlight_opened", "Opened Spotlight"),
            ("spotlight_added", "Spotlight added"),
            ("finished", "Finished highlight"),
            ("watched", "Watched highlight"),
            ("took_away", "Took it away"),
        ]
        assert [s["label"] for s in JOURNEY_MONEY_LADDER] == [
            "Signed up", "Hit paywall", "Opened buy", "Purchased"]


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
        # The shared-in user skipped this stage but counts: they reached a later one.
        assert (add["reached"], add["in_window"], add["continued"]) == (6, 1, 5)
        aj.check_conservation(folded["nodes"], folded["edges"])  # no raise

    def test_skipped_stages_count_as_reached_and_are_not_drops(self):
        # Shared-in: {signed_up, clipped}, stages 1 to 3 have no action of their own.
        folded = aj.fold_journey([_pat(["clipped"], "stuck", 2)], JOURNEY_LADDER)
        for key in ("signed_up", "started", "add_footage", "footage_landed"):
            node = _node(folded, key)
            assert (node["reached"], node["continued"]) == (2, 2), key
            assert node["in_window"] + node["stuck"] + node["gone"] == 0, key
        clipped = _node(folded, "clipped")
        assert (clipped["reached"], clipped["continued"], clipped["stuck"]) == (2, 0, 2)
        assert _node(folded, "frame_opened")["reached"] == 0

    def test_edges_link_neighbours_only(self):
        # Finish Now: Exported to Finished with no spotlight stages.
        folded = aj.fold_journey([_pat(["exported", "finished"], "stuck", 2)], JOURNEY_LADDER)
        finished = KEYS.index("finished")
        assert folded["edges"] == [
            {"from": KEYS[r], "to": KEYS[r + 1], "users": 2} for r in range(finished)]

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


class TestNeverGoesUp:
    """T14720: reaching a stage means reaching every stage before it."""

    @pytest.mark.parametrize("ladder", [JOURNEY_LADDER, JOURNEY_MONEY_LADDER],
                             ids=["main", "money"])
    def test_counts_never_rise_for_any_filtered_population(self, ladder):
        rng = random.Random(14720)
        size = len(ladder)
        patterns = [{"mask": 1 | rng.randrange(1 << size),
                     "outcome": rng.choice(aj.OUTCOMES), "n": rng.randint(1, 9)}
                    for _ in range(300)]
        # A filter combination only ever selects a subset of the pattern rows.
        for _ in range(200):
            subset = rng.sample(patterns, rng.randint(1, len(patterns)))
            folded = aj.fold_journey(subset, ladder)
            counts = [n["reached"] for n in folded["nodes"]]
            assert all(a >= b for a, b in pairwise(counts)), counts
            keys = [s["key"] for s in ladder]
            assert all(keys.index(e["to"]) - keys.index(e["from"]) == 1 for e in folded["edges"])
            assert folded["nodes"][0]["reached"] == sum(r["n"] for r in subset)

    def test_money_strip_counts_a_buyer_who_never_saw_the_paywall(self):
        purchased = 1 | 1 << 3
        folded = aj.fold_journey([{"mask": purchased, "outcome": "stuck", "n": 4},
                                  {"mask": 1 | 1 << 1, "outcome": "gone", "n": 3}],
                                 JOURNEY_MONEY_LADDER)
        assert [n["reached"] for n in folded["nodes"]] == [7, 7, 4, 4]

    def test_each_user_still_drops_once_at_their_furthest_stage(self):
        patterns = [_pat(["clipped"], "stuck", 2), _pat(["started", "exported"], "gone", 3)]
        folded = aj.fold_journey(patterns, JOURNEY_LADDER)
        by_stage = {r["stage"]: r["lost"] for r in folded["loss"]}
        assert by_stage == {"clipped": 2, "exported": 3}


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

    def test_cohort_fold_attaches_to_every_node_at_the_partial_cutoff(self):
        # T15230: a partial end's cohort is computed over ALL nodes (not just the partial one),
        # so the other end of a transition can read its reached-at-cutoff too.
        nodes = [{"key": "x"}, {"key": "y"}, {"key": "z"}]
        ladder = [
            {"key": "x", "actions": []},
            {"key": "y", "actions": ["new_a"]},
            {"key": "z", "actions": ["old_b"]},
        ]
        instr = {"new_a": "2026-08-26", "old_b": "2026-01-01"}
        cohort_payload = [{"reached": 10, "continued": 10, "in_window": 0, "stuck": 0, "gone": 0, "judged": 10},
                          {"reached": 7, "continued": 5, "in_window": 0, "stuck": 1, "gone": 1, "judged": 7},
                          {"reached": 7, "continued": 0, "in_window": 0, "stuck": 0, "gone": 7, "judged": 7}]
        calls = []

        def cohort_fold(cutoff):
            calls.append(cutoff)
            return cohort_payload

        aj.annotate_coverage(nodes, ladder, date(2026, 5, 1), date(2026, 10, 1), instr,
                             cohort_fold=cohort_fold)
        assert calls == [date(2026, 8, 26)]
        for node in nodes:
            assert node["cohort_at"]["2026-08-26"] == cohort_payload[nodes.index(node)]

    def test_cohort_fold_called_once_per_distinct_cutoff(self):
        nodes = [{"key": "x"}, {"key": "y"}, {"key": "z"}]
        ladder = [
            {"key": "x", "actions": []},
            {"key": "y", "actions": ["new_a"]},
            {"key": "z", "actions": ["new_a"]},  # same instrumentation date as y
        ]
        instr = {"new_a": "2026-08-26"}
        calls = []

        def cohort_fold(cutoff):
            calls.append(cutoff)
            return [{"reached": 0, "continued": 0, "in_window": 0, "stuck": 0, "gone": 0, "judged": 0}] * 3

        aj.annotate_coverage(nodes, ladder, date(2026, 5, 1), date(2026, 10, 1), instr,
                             cohort_fold=cohort_fold)
        assert calls == [date(2026, 8, 26)]

    def test_no_data_end_never_gets_a_cohort(self):
        nodes = [{"key": "x"}, {"key": "y"}]
        ladder = [{"key": "x", "actions": []}, {"key": "y", "actions": ["too_new"]}]
        instr = {"too_new": "2026-12-01"}
        calls = []
        aj.annotate_coverage(nodes, ladder, date(2026, 5, 1), date(2026, 10, 1), instr,
                             cohort_fold=lambda cutoff: calls.append(cutoff))
        assert nodes[1]["no_data"] is True
        assert "cohort_at" not in nodes[1]
        assert calls == []


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


    def test_reached_is_every_stage_up_to_the_furthest(self):
        at = T0 + timedelta(days=1)
        user = aj.classify_user(_user_row("a", {"clipped": at}), JOURNEY_LADDER, NOW, 14, 14)
        assert user["furthest"] == KEYS.index("clipped")
        assert user["reached"] == list(range(KEYS.index("clipped") + 1))


class TestInspectorAgreesWithTheMap:
    def test_step_counts_equal_the_node_at_a_skipped_stage(self):
        at = T0 + timedelta(days=1)
        users = _classified([_user_row("skip", {"clipped": at}),
                             _user_row("stop", {"add_footage": at})])
        folded = aj.fold_journey([_pat(["clipped"], "stuck"), _pat(["add_footage"], "stuck")],
                                 JOURNEY_LADDER)
        for key in ("started", "add_footage", "footage_landed", "clipped"):
            counts = aj.step_counts(users, KEYS.index(key))
            node = _node(folded, key)
            for field in ("reached", "continued", "in_window", "stuck", "gone"):
                assert counts[field] == node[field], (key, field)

    def test_breakdown_counts_a_user_who_skipped_the_stage_as_continued(self):
        users = _classified([_user_row("skip", {"clipped": T0})])
        row = aj.step_breakdown(users, KEYS.index("add_footage"), "platform")[0]
        assert (row["reached"], row["continued"]) == (1, 1)


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


    def test_users_with_no_timestamp_are_left_out_and_reported(self):
        at = T0 + timedelta(days=1)
        users = _classified([
            _user_row("timed", {"add_footage": at, "footage_landed": at + timedelta(minutes=5)}),
            _user_row("skipped_s", {"clipped": at}),  # no first_at for add_footage
            _user_row("stopped", {"add_footage": at}),  # did not continue
        ])
        out = aj.time_to_next(users, KEYS.index("add_footage"), JOURNEY_LADDER)
        assert (out["continued"], out["timed"], out["n"]) == (2, 1, 1)
        assert out["median_s"] == 300

    def test_next_timestamp_is_the_next_stage_that_has_one(self):
        at = T0 + timedelta(days=1)
        users = _classified([_user_row("u", {"add_footage": at, "clipped": at + timedelta(hours=2)})])
        out = aj.time_to_next(users, KEYS.index("add_footage"), JOURNEY_LADDER)
        assert (out["n"], out["skipped"], out["median_s"]) == (1, 1, 7200)

    def test_out_of_order_users_still_have_a_timestamp(self):
        users = self._users([-timedelta(hours=3)])
        out = aj.time_to_next(users, KEYS.index("started"), JOURNEY_LADDER)
        assert (out["continued"], out["timed"], out["n"], out["out_of_order"]) == (1, 1, 0, 1)

    def test_nobody_timed_has_no_median(self):
        users = _classified([_user_row("skip", {"clipped": T0})])
        out = aj.time_to_next(users, KEYS.index("add_footage"), JOURNEY_LADDER)
        assert (out["continued"], out["timed"], out["median_s"]) == (1, 0, None)


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
        assert desk["rate_lb"] == round(100 * aj.wilson_lower(5, 25), 2)
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


    def test_users_with_no_timestamp_for_the_stage_join_neither_group(self):
        # "After the stage" has no meaning without its first_at: same population as before
        # implied reach, and no comparison against None.
        rows = [_user_row(f"d{i}", {"add_footage": T0}) for i in range(5)]
        rows += [_user_row(f"c{i}", {"add_footage": T0, "clipped": T0}) for i in range(5)]
        rows += [_user_row(f"s{i}", {"clipped": T0}) for i in range(5)]
        users = _classified(rows)
        after = T0 + timedelta(hours=1)
        side = {"paywall_shown": {u["user_id"]: after for u in users}}
        out = aj.side_action_lift(users, KEYS.index("add_footage"), side)
        assert [(r["n_dropped"], r["n_continued"], r["lift"]) for r in out] == [(5, 5, 1.0)]


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
