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
