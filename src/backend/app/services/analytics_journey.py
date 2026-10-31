"""T14010: admin Journey map -- pure fold over per-user stage patterns.

Design: docs/plans/admin-journey-dropoff-design-2026-10-30.md Sections 5 and 6.

Every user sits at exactly one FURTHEST stage (highest ladder index reached). The
SQL side (`fetch_patterns`) reduces users to pattern rows
`(mask, outcome, platform, origin, signup_build, signup_month, n)` where `mask` has bit
`rank` set for every stage the user reached and `outcome` classifies the user's
furthest stage (in_window / stuck / gone). The fold functions below consume those
rows, so they are unit-testable without Postgres and cost O(patterns), not O(users).

Outcome rules (W = conversion window, I = inactivity threshold):
    in_window : now - first_at(furthest) <  W            (pending, not judged)
    stuck     : now - first_at(furthest) >= W and last_active_at >= now - I
    gone      : now - first_at(furthest) >= W and last_active_at <  now - I
"""
from __future__ import annotations

from datetime import date, datetime
from itertools import pairwise
from typing import Any

OUTCOMES = ("in_window", "stuck", "gone")

# Percentages render only when at least this many users were judged (design 5.6).
MIN_JUDGED_FOR_PERCENT = 20


def ladder_for(steps: str) -> list[dict]:
    """The compact 14-stage ladder, or full mode: every FUNNEL_STEPS event as a node."""
    from ..analytics import FLOW_EVENTS, FUNNEL_STEPS, JOURNEY_LADDER

    if steps == "compact":
        return JOURNEY_LADDER
    if steps != "full":
        raise ValueError(f"steps must be 'compact' or 'full', got {steps!r}")
    full = [JOURNEY_LADDER[0]]
    for event in FUNNEL_STEPS:
        full.append({
            "key": event,
            "label": FLOW_EVENTS[event]["label"],
            "band": "full",
            "actions": [event],
            "client_beacon": event in _CLIENT_BEACON_EVENTS,
        })
    return full


_CLIENT_BEACON_EVENTS = frozenset({"export_started", "result_viewed", "paywall_shown", "buy_modal_opened"})


def _stage_first_at_sql(stage: dict) -> str:
    # Stage actions are internal module constants (analytics.JOURNEY_LADDER), never
    # client input -- safe to inline into the FILTER clause.
    in_list = ", ".join(f"'{a}'" for a in stage["actions"])
    return f"MIN(a.first_at) FILTER (WHERE a.action IN ({in_list}))"


def _ladder_sql(ladder: list[dict], prefix: str) -> tuple[list[str], str, str]:
    """Per-stage first_at columns, the stage bitmask, and the furthest stage's first_at for
    one ladder. Generated FROM the ladder (same technique as admin._build_last_step_rank),
    so a ladder edit cannot desync them."""
    stage_cols = []
    mask_terms = []
    first_at_arms = []
    for rank, stage in enumerate(ladder):
        col = f"{prefix}{rank}"
        if rank == 0:
            stage_cols.append(f"s.acquired_at::timestamptz AS {col}")
        else:
            stage_cols.append(f"{_stage_first_at_sql(stage)} AS {col}")
        mask_terms.append(f"(CASE WHEN {col} IS NOT NULL THEN {1 << rank} ELSE 0 END)")
        first_at_arms.append(f"WHEN {col} IS NOT NULL THEN {col}")
    # Highest rank wins: reverse the arms so CASE picks the furthest populated stage's first_at.
    furthest_at = "CASE " + " ".join(reversed(first_at_arms)) + " END"
    return stage_cols, " + ".join(mask_terms), furthest_at


def _outcome_sql(furthest_at: str) -> str:
    return f"""CASE
                       WHEN now() - ({furthest_at}) < make_interval(days => %(window_days)s) THEN 'in_window'
                       WHEN last_active_at >= now() - make_interval(days => %(inactive_days)s) THEN 'stuck'
                       ELSE 'gone'
                   END"""


def build_patterns_sql(ladder: list[dict], money_ladder: list[dict], *, excl_join: str,
                       where: str, platform_filter: bool) -> str:
    """ONE pass producing pattern rows for both the main ladder and the money strip:
    `(mask, outcome, money_mask, money_outcome, platform, origin, signup_build,
    signup_month, n)`. Named params: actions, window_days, inactive_days, platform (when
    `platform_filter`), plus the `where` fragment's own. `where` filters alias `s`.

    The join reads only the actions some stage uses (%(actions)s): impression, reason and
    polish rows dominate user_actions and never affect a stage, so they never leave the
    index. The user's platform is therefore the platform of their FIRST JOURNEY action.
    """
    cols, mask, furthest_at = _ladder_sql(ladder, "fa_")
    m_cols, m_mask, m_furthest_at = _ladder_sql(money_ladder, "mfa_")
    all_cols = ",\n                   ".join(cols + m_cols[1:])  # rank 0 (signed_up) is shared
    m_furthest_at = m_furthest_at.replace("mfa_0", "fa_0")
    m_mask = m_mask.replace("mfa_0", "fa_0")
    platform_where = "WHERE COALESCE(platform, 'unknown') = %(platform)s" if platform_filter else ""
    return f"""
        WITH per_user AS (
            SELECT s.user_id, s.origin, s.signup_build, s.last_active_at,
                   (array_agg(a.platform ORDER BY a.first_at NULLS LAST))[1] AS platform,
                   to_char(s.acquired_at, 'YYYY-MM') AS signup_month,
                   {all_cols}
            FROM user_segments s
            {excl_join}
            LEFT JOIN user_actions a ON a.user_id = s.user_id AND a.action = ANY(%(actions)s)
            {where}
            GROUP BY s.user_id, s.origin, s.signup_build, s.last_active_at, s.acquired_at
        ),
        classified AS (
            SELECT origin, signup_build, signup_month, COALESCE(platform, 'unknown') AS platform,
                   ({mask}) AS mask,
                   {_outcome_sql(furthest_at)} AS outcome,
                   ({m_mask}) AS money_mask,
                   {_outcome_sql(m_furthest_at)} AS money_outcome
            FROM per_user
            {platform_where}
        )
        SELECT mask, outcome, money_mask, money_outcome, platform, origin, signup_build,
               signup_month, COUNT(*) AS n
        FROM classified
        GROUP BY mask, outcome, money_mask, money_outcome, platform, origin, signup_build, signup_month
    """


def fold_journey(patterns: list[dict], ladder: list[dict]) -> dict[str, Any]:
    """Fold pattern rows into nodes, edges and the loss ranking.

    Every pattern row must carry the furthest stage's outcome. Conservation
    (asserted by `check_conservation`): reached = continued + in_window + stuck + gone
    at every node, and reached(S) = sum of inflow edges into S.
    """
    size = len(ladder)
    reached = [0] * size
    outcome = [{o: 0 for o in OUTCOMES} for _ in range(size)]
    edge_users: dict[tuple[int, int], int] = {}

    for row in patterns:
        mask, n, out = int(row["mask"]), int(row["n"]), row["outcome"]
        if out not in OUTCOMES:
            raise ValueError(f"unknown outcome {out!r}")
        ranks = [r for r in range(size) if mask >> r & 1]
        if not ranks:
            raise ValueError(f"pattern with empty mask: {row!r}")
        for r in ranks:
            reached[r] += n
        outcome[ranks[-1]][out] += n
        for a, b in pairwise(ranks):
            edge_users[(a, b)] = edge_users.get((a, b), 0) + n

    nodes = []
    for rank, stage in enumerate(ladder):
        o = outcome[rank]
        dropped = o["in_window"] + o["stuck"] + o["gone"]
        nodes.append({
            "key": stage["key"],
            "label": stage["label"],
            "band": stage["band"],
            "client_beacon": bool(stage.get("client_beacon")),
            "reached": reached[rank],
            "continued": reached[rank] - dropped,
            "in_window": o["in_window"],
            "stuck": o["stuck"],
            "gone": o["gone"],
        })
    edges = [
        {"from": ladder[a]["key"], "to": ladder[b]["key"], "users": users, "skip": b != a + 1}
        for (a, b), users in sorted(edge_users.items())
    ]
    check_conservation(nodes, edges)
    return {"nodes": nodes, "edges": edges, "loss": loss_ranking(nodes)}


def check_conservation(nodes: list[dict], edges: list[dict]) -> None:
    """Raise AssertionError when a node's counts do not add up (internal bug: fail loudly)."""
    inflow: dict[str, int] = {}
    for e in edges:
        inflow[e["to"]] = inflow.get(e["to"], 0) + e["users"]
    outflow: dict[str, int] = {}
    for e in edges:
        outflow[e["from"]] = outflow.get(e["from"], 0) + e["users"]
    for i, n in enumerate(nodes):
        total = n["continued"] + n["in_window"] + n["stuck"] + n["gone"]
        assert n["reached"] == total, f"node {n['key']}: reached {n['reached']} != {total}"
        assert n["continued"] == outflow.get(n["key"], 0), (
            f"node {n['key']}: continued {n['continued']} != outflow {outflow.get(n['key'], 0)}")
        if i > 0:
            assert n["reached"] == inflow.get(n["key"], 0), (
                f"node {n['key']}: reached {n['reached']} != inflow {inflow.get(n['key'], 0)}")


def loss_ranking(nodes: list[dict]) -> list[dict]:
    """Stages sorted by absolute users lost (stuck + gone). The terminal stage has nothing
    left to lose and is excluded. `still_visiting` is the stuck count shown beside the total."""
    ranked = []
    for n in nodes[:-1]:
        lost = n["stuck"] + n["gone"]
        ranked.append({
            "stage": n["key"],
            "label": n["label"],
            "lost": lost,
            "stuck": n["stuck"],
            "gone": n["gone"],
            "still_visiting": n["stuck"],
            "judged": n["continued"] + lost,
        })
    ranked.sort(key=lambda r: (-r["lost"], r["stage"]))
    return [r for r in ranked if r["lost"] > 0]


def annotate_coverage(nodes: list[dict], ladder: list[dict], d_from: date, d_to: date,
                      instrumented_at: dict[str, str]) -> None:
    """Honesty flags (design 5.6), in place.

    `partial_from`: the stage's earliest-instrumented action is younger than the signup
    window start, so older signups cannot have reached it. `no_data`: every action of the
    stage was instrumented after the window ended, so a count of 0 would be invented.
    Synthetic stages (no actions) are always instrumented.
    """
    for node, stage in zip(nodes, ladder):
        dates = [date.fromisoformat(instrumented_at[a]) for a in stage["actions"]
                 if a in instrumented_at]
        node["partial_from"] = None
        node["no_data"] = False
        if not stage["actions"]:
            continue
        if len(dates) != len(stage["actions"]):
            missing = [a for a in stage["actions"] if a not in instrumented_at]
            raise KeyError(f"EVENT_INSTRUMENTED_AT missing {missing}")
        first = min(dates)
        if first > d_to:
            node["no_data"] = True
        elif first > d_from:
            node["partial_from"] = first.isoformat()


def percent_or_fraction(k: int, judged: int) -> dict[str, Any]:
    """Small-N rule: a percentage only when judged >= MIN_JUDGED_FOR_PERCENT, else k / n."""
    if judged >= MIN_JUDGED_FOR_PERCENT:
        return {"pct": round(100.0 * k / judged, 1), "k": k, "n": judged}
    return {"pct": None, "k": k, "n": judged}


def fetch_patterns(cur, ladder: list[dict], money_ladder: list[dict], *, d_from: date,
                   d_to: date, origin: str, build: int | None, platform: str | None, excl: str,
                   window_days: int, inactive_days: int) -> list[dict]:
    """Run the single pattern query for both ladders under the dashboard's filters."""
    excl_join = "LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    conds = ["s.acquired_at BETWEEN %(d_from)s AND %(d_to)s"]
    params: dict[str, Any] = {"d_from": d_from, "d_to": d_to, "window_days": window_days,
                              "inactive_days": inactive_days, "platform": platform}
    if origin != "all":
        conds.append("s.origin = %(origin)s")
        params["origin"] = origin
    if build is not None:
        conds.append("s.signup_build = %(build)s")
        params["build"] = build
    if excl:
        conds.append(excl)
    params["actions"] = sorted({a for st in ladder + money_ladder for a in st["actions"]})
    sql = build_patterns_sql(ladder, money_ladder, excl_join=excl_join,
                             where="WHERE " + " AND ".join(conds), platform_filter=bool(platform))
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def build_journey(cur, *, steps: str, d_from: date, d_to: date, origin: str, build: int | None,
                  platform: str | None, excl: str, window_days: int, inactive_days: int,
                  now: datetime) -> dict[str, Any]:
    from ..analytics import EVENT_INSTRUMENTED_AT, JOURNEY_MONEY_LADDER

    ladder = ladder_for(steps)
    rows = fetch_patterns(cur, ladder, JOURNEY_MONEY_LADDER, d_from=d_from, d_to=d_to,
                          origin=origin, build=build, platform=platform, excl=excl,
                          window_days=window_days, inactive_days=inactive_days)
    # Each row carries both classifications; fold_journey sums rows that share a mask.
    folded = fold_journey(
        [{"mask": r["mask"], "outcome": r["outcome"], "n": r["n"]} for r in rows], ladder)
    money = fold_journey(
        [{"mask": r["money_mask"], "outcome": r["money_outcome"], "n": r["n"]} for r in rows],
        JOURNEY_MONEY_LADDER)
    annotate_coverage(folded["nodes"], ladder, d_from, d_to, EVENT_INSTRUMENTED_AT)
    annotate_coverage(money["nodes"], JOURNEY_MONEY_LADDER, d_from, d_to, EVENT_INSTRUMENTED_AT)
    for n in folded["nodes"] + money["nodes"]:
        judged = n["continued"] + n["stuck"] + n["gone"]
        n["judged"] = judged
        n["continue_rate"] = percent_or_fraction(n["continued"], judged)
    return {
        "nodes": folded["nodes"],
        "edges": folded["edges"],
        "loss": folded["loss"],
        "money": {"nodes": money["nodes"][1:], "edges": money["edges"]},
        "bands": _bands(ladder),
        "meta": {
            "window_days": window_days,
            "inactive_days": inactive_days,
            "from": d_from.isoformat(),
            "to": d_to.isoformat(),
            "steps": steps,
            "computed_at": now.isoformat(),
        },
    }


def _bands(ladder: list[dict]) -> list[dict]:
    from ..analytics import JOURNEY_BANDS

    bands: list[dict] = []
    for stage in ladder:
        if not bands or bands[-1]["key"] != stage["band"]:
            bands.append({"key": stage["band"], "label": JOURNEY_BANDS.get(stage["band"], "All events")})
    return bands
