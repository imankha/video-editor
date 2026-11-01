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
    signup_month, first_signup, n)`. Named params: actions, window_days, inactive_days, platform_like (when
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
    # Device family over the stored keys (user_context._VALID_PLATFORMS: pwa-/webapp- x
    # mobile/desktop). The app records no iOS vs Android split.
    platform_where = "WHERE COALESCE(platform, 'unknown') LIKE %(platform_like)s" if platform_filter else ""
    return f"""
        WITH per_user AS (
            SELECT s.user_id, s.origin, s.signup_build, s.last_active_at, s.acquired_at,
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
            SELECT origin, signup_build, signup_month, acquired_at,
                   COALESCE(platform, 'unknown') AS platform,
                   ({mask}) AS mask,
                   {_outcome_sql(furthest_at)} AS outcome,
                   ({m_mask}) AS money_mask,
                   {_outcome_sql(m_furthest_at)} AS money_outcome
            FROM per_user
            {platform_where}
        )
        SELECT mask, outcome, money_mask, money_outcome, platform, origin, signup_build,
               signup_month, MIN(acquired_at) AS first_signup, COUNT(*) AS n
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
            "major": bool(stage.get("major")),
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


def fetch_patterns(cur, ladder: list[dict], money_ladder: list[dict], *, d_from: date | None,
                   d_to: date, origin: str, build: int | None, platform: str | None, excl: str,
                   window_days: int, inactive_days: int) -> list[dict]:
    """Run the single pattern query for both ladders under the dashboard's filters.
    `d_from=None` means no lower bound (every signup up to `d_to`)."""
    excl_join = "LEFT JOIN users u ON u.user_id = s.user_id" if excl else ""
    conds = ["s.acquired_at <= %(d_to)s"]
    if d_from is not None:
        conds.append("s.acquired_at >= %(d_from)s")
    params: dict[str, Any] = {"d_from": d_from, "d_to": d_to, "window_days": window_days,
                              "inactive_days": inactive_days,
                              "platform_like": f"%-{platform}" if platform else None}
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


def build_journey(cur, *, d_from: date | None, d_to: date, origin: str, build: int | None,
                  platform: str | None, excl: str, window_days: int, inactive_days: int,
                  now: datetime) -> dict[str, Any]:
    from ..analytics import EVENT_INSTRUMENTED_AT, JOURNEY_LADDER, JOURNEY_MONEY_LADDER

    ladder = JOURNEY_LADDER
    rows = fetch_patterns(cur, ladder, JOURNEY_MONEY_LADDER, d_from=d_from, d_to=d_to,
                          origin=origin, build=build, platform=platform, excl=excl,
                          window_days=window_days, inactive_days=inactive_days)
    if d_from is None:
        # All signups: the window starts at the earliest signup actually included, so
        # partial badges compare instrumentation dates against real data (empty -> d_to).
        d_from = min((r["first_signup"] for r in rows), default=d_to)
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


# ---------------------------------------------------------------------------
# T14020: Step inspector (design Sections 4, 5.4 to 5.6)
# ---------------------------------------------------------------------------
# Users are classified in Python from per-user rows (`fetch_step_users`): the inspector
# only ever loads the users who reached ONE stage, so this is O(users at stage).
BREAKDOWN_DIMENSIONS = {
    "platform": "platform",
    "origin": "origin",
    "build": "signup_build",
    "cohort_month": "signup_month",
}
# Side-action lift is shown only when BOTH groups have at least this many users with A.
MIN_LIFT_USERS = 5
PEOPLE_CAP = 200
# Non-ladder actions worth comparing (dropped vs continued). Failure rows (`base:reason`)
# and impression rows (`dialog_impression:slug`, `toast_impression:slug`) join dynamically.
SIDE_ACTIONS = (
    "watched_annotate_tutorial", "watched_framing_tutorial", "watched_overlay_tutorial",
    "watched_publish_tutorial", "paywall_shown", "buy_modal_opened",
    "overlay_offered", "overlay_deferred", "overlay_declined",
    "framing_point_added", "draft_saved", "preview_started", "speed_segment_created",
)
TIME_BUCKETS = (("lt_1h", 3600), ("same_day", 86400), ("d2_3", 4 * 86400), ("d4_14", 15 * 86400))
_BUCKET_KEYS = (*(k for k, _ in TIME_BUCKETS), "gt_14d")


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    """Lower bound of the Wilson 95% interval for k successes in n trials (0 when n == 0)."""
    if n <= 0:
        return 0.0
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5)
    return max(0.0, (centre - margin) / denom)


def classify_user(row: dict, ladder: list[dict], now: datetime, window_days: int,
                  inactive_days: int) -> dict[str, Any]:
    """Furthest stage rank and its outcome for one user row (`firsts[rank]` = first_at or
    None). Same rules as the SQL `_outcome_sql`, so counts equal the map's."""
    from datetime import timedelta

    firsts = row["firsts"]
    reached = [r for r in range(len(ladder)) if firsts[r] is not None]
    if not reached:
        raise ValueError(f"user {row.get('user_id')!r} reached no stage")
    furthest = reached[-1]
    if now - firsts[furthest] < timedelta(days=window_days):
        outcome = "in_window"
    elif row["last_active_at"] >= now - timedelta(days=inactive_days):
        outcome = "stuck"
    else:
        outcome = "gone"
    return {**row, "reached": reached, "furthest": furthest, "outcome": outcome}


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def time_to_next(users: list[dict], s_rank: int, ladder: list[dict]) -> dict[str, Any]:
    """first_at(next reached stage) - first_at(S) for users who continued past S.
    Negative deltas are counted as `out_of_order` and kept out of the stats (never clamped)."""
    deltas: list[float] = []
    out_of_order = 0
    skipped = 0
    for u in users:
        later = [r for r in u["reached"] if r > s_rank]
        if not later or s_rank not in u["reached"]:
            continue
        nxt = later[0]
        if nxt != s_rank + 1:
            skipped += 1
        d = (u["firsts"][nxt] - u["firsts"][s_rank]).total_seconds()
        if d < 0:
            out_of_order += 1
        else:
            deltas.append(d)
    deltas.sort()
    buckets = dict.fromkeys(_BUCKET_KEYS, 0)
    for d in deltas:
        for key, limit in TIME_BUCKETS:
            if d < limit:
                buckets[key] += 1
                break
        else:
            buckets["gt_14d"] += 1
    nominal = ladder[s_rank + 1]["key"] if s_rank + 1 < len(ladder) else None
    return {
        "stage": nominal,
        "n": len(deltas),
        "median_s": _quantile(deltas, 0.5) if deltas else None,
        "p75_s": _quantile(deltas, 0.75) if deltas else None,
        "buckets": buckets,
        "out_of_order": out_of_order,
        "skipped": skipped,
    }


def step_breakdown(users: list[dict], s_rank: int, by: str) -> list[dict]:
    """Per-dimension rows for users who reached S, sorted by loss (stuck + gone) desc."""
    if by not in BREAKDOWN_DIMENSIONS:
        raise ValueError(f"unknown breakdown dimension {by!r}")
    field = BREAKDOWN_DIMENSIONS[by]
    rows: dict[str, dict] = {}
    for u in users:
        key = str(u[field]) if u[field] is not None else "unknown"
        r = rows.setdefault(key, {"key": key, "reached": 0, "continued": 0,
                                  "in_window": 0, "stuck": 0, "gone": 0})
        r["reached"] += 1
        if u["furthest"] > s_rank:
            r["continued"] += 1
        else:
            r[u["outcome"]] += 1
    out = []
    for r in rows.values():
        judged = r["continued"] + r["stuck"] + r["gone"]
        r["judged"] = judged
        r["rate"] = percent_or_fraction(r["continued"], judged)
        r["rate_lb"] = round(100 * wilson_lower(r["continued"], judged), 1)
        out.append(r)
    out.sort(key=lambda r: (-(r["stuck"] + r["gone"]), r["key"]))
    return out


def _judged_groups(users: list[dict], s_rank: int) -> tuple[dict[str, dict], dict[str, dict]]:
    """(dropped, continued) judged users who reached S, as user_id -> user. In-window
    users are pending, so they join neither group."""
    dropped, continued = {}, {}
    for u in users:
        if s_rank not in u["reached"]:
            continue
        if u["furthest"] > s_rank:
            continued[u["user_id"]] = u
        elif u["outcome"] != "in_window":
            dropped[u["user_id"]] = u
    return dropped, continued


def _after_stage(side_users: dict[str, datetime], group: dict[str, dict], s_rank: int) -> int:
    return sum(1 for uid, at in side_users.items()
               if uid in group and at >= group[uid]["firsts"][s_rank])


def side_action_lift(users: list[dict], s_rank: int,
                     side: dict[str, dict[str, datetime]]) -> list[dict]:
    """lift = p(A | dropped) / p(A | continued), counting A only when first_at(A) >=
    first_at(S). Hidden unless both groups have >= MIN_LIFT_USERS users with A. Correlation."""
    dropped, continued = _judged_groups(users, s_rank)
    if not dropped or not continued:
        return []
    out = []
    for action, by_user in side.items():
        n_d = _after_stage(by_user, dropped, s_rank)
        n_c = _after_stage(by_user, continued, s_rank)
        if n_d < MIN_LIFT_USERS or n_c < MIN_LIFT_USERS:
            continue
        p_d, p_c = n_d / len(dropped), n_c / len(continued)
        out.append({"action": action, "n_dropped": n_d, "n_continued": n_c,
                    "p_dropped": round(p_d, 3), "p_continued": round(p_c, 3),
                    "lift": round(p_d / p_c, 2)})
    out.sort(key=lambda r: (-r["lift"], r["action"]))
    return out


def why_signals(users: list[dict], s_rank: int, side: dict[str, dict[str, datetime]]) -> dict:
    """Failure reasons (`base:reason`) and impressions among users who STOPPED at S
    (furthest == S, any outcome), counted when they happened at or after reaching S."""
    stopped = {u["user_id"]: u for u in users if u["furthest"] == s_rank}
    failures, impressions = [], []
    for action, by_user in side.items():
        n = _after_stage(by_user, stopped, s_rank)
        if not n or ":" not in action:
            continue
        base, tail = action.split(":", 1)
        if base.endswith("_impression"):
            impressions.append({"slug": action, "users": n})
        else:
            failures.append({"event": base, "reason": tail, "users": n})
    failures.sort(key=lambda r: (-r["users"], r["event"], r["reason"]))
    impressions.sort(key=lambda r: (-r["users"], r["slug"]))
    return {"failures": failures, "impressions": impressions}


def people_by_outcome(users: list[dict], s_rank: int, emails: dict[str, str]) -> dict[str, list]:
    """Users who stopped at S, per outcome, newest activity first, capped per outcome."""
    out: dict[str, list] = {o: [] for o in OUTCOMES}
    stopped = sorted((u for u in users if u["furthest"] == s_rank),
                     key=lambda u: u["last_active_at"], reverse=True)
    for u in stopped:
        bucket = out[u["outcome"]]
        if len(bucket) < PEOPLE_CAP:
            bucket.append({"user_id": u["user_id"], "email": emails.get(u["user_id"]),
                           "platform": u["platform"],
                           "last_active_at": u["last_active_at"].isoformat()})
    return out


def step_counts(users: list[dict], s_rank: int) -> dict[str, Any]:
    """Same shape and rules as the map node for S (the inspector's counts must equal it)."""
    reached = [u for u in users if s_rank in u["reached"]]
    counts: dict[str, Any] = {"reached": len(reached), "continued": 0,
                              "in_window": 0, "stuck": 0, "gone": 0}
    for u in reached:
        if u["furthest"] > s_rank:
            counts["continued"] += 1
        else:
            counts[u["outcome"]] += 1
    judged = counts["continued"] + counts["stuck"] + counts["gone"]
    counts["judged"] = judged
    counts["continue_rate"] = percent_or_fraction(counts["continued"], judged)
    return counts


def fetch_step_users(cur, ladder: list[dict], s_rank: int, *, d_from: date | None, d_to: date,
                     origin: str, build: int | None, platform: str | None, excl: str,
                     now: datetime, window_days: int, inactive_days: int) -> list[dict]:
    """Every user who reached stage `s_rank` under the map's filters, classified.
    Same population joins as `build_patterns_sql`, but one row per user."""
    cols, _mask, _furthest_at = _ladder_sql(ladder, "fa_")
    conds = ["s.acquired_at <= %(d_to)s"]
    params: dict[str, Any] = {"d_to": d_to, "actions": sorted({a for st in ladder for a in st["actions"]})}
    if d_from is not None:
        conds.append("s.acquired_at >= %(d_from)s")
        params["d_from"] = d_from
    if origin != "all":
        conds.append("s.origin = %(origin)s")
        params["origin"] = origin
    if build is not None:
        conds.append("s.signup_build = %(build)s")
        params["build"] = build
    if excl:
        conds.append(excl)
    outer = [f"fa_{s_rank} IS NOT NULL"]
    if platform:
        outer.append("COALESCE(platform, 'unknown') LIKE %(platform_like)s")
        params["platform_like"] = f"%-{platform}"
    stage_cols = ",\n                   ".join(cols)
    sql = f"""
        WITH per_user AS (
            SELECT s.user_id, u.email, s.origin, s.signup_build, s.last_active_at, s.acquired_at,
                   (array_agg(a.platform ORDER BY a.first_at NULLS LAST))[1] AS platform,
                   to_char(s.acquired_at, 'YYYY-MM') AS signup_month,
                   {stage_cols}
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            LEFT JOIN user_actions a ON a.user_id = s.user_id AND a.action = ANY(%(actions)s)
            WHERE {" AND ".join(conds)}
            GROUP BY s.user_id, u.email, s.origin, s.signup_build, s.last_active_at, s.acquired_at
        )
        SELECT * FROM per_user WHERE {" AND ".join(outer)}
    """
    cur.execute(sql, params)
    users = []
    for r in cur.fetchall():
        row = dict(r)
        row["platform"] = row["platform"] or "unknown"
        row["firsts"] = [row.pop(f"fa_{i}") for i in range(len(ladder))]
        users.append(classify_user(row, ladder, now, window_days, inactive_days))
    return users


def fetch_side_actions(cur, user_ids: list[str]) -> dict[str, dict[str, datetime]]:
    """action -> {user_id: first_at} for the lift and why folds: the curated side actions
    plus every failure row (`base:reason`) and impression row among `user_ids`."""
    if not user_ids:
        return {}
    cur.execute(
        """
        SELECT user_id, action, MIN(first_at) AS first_at
        FROM user_actions
        WHERE user_id = ANY(%s) AND (action = ANY(%s) OR action LIKE '%%:%%')
        GROUP BY user_id, action
        """,
        (user_ids, list(SIDE_ACTIONS)),
    )
    side: dict[str, dict[str, datetime]] = {}
    for r in cur.fetchall():
        side.setdefault(r["action"], {})[r["user_id"]] = r["first_at"]
    return side


def build_step(cur, stage: str, by: str, *, d_from: date | None, d_to: date, origin: str,
               build: int | None, platform: str | None, excl: str, window_days: int,
               inactive_days: int, now: datetime) -> dict[str, Any]:
    from ..analytics import JOURNEY_LADDER

    ladder = JOURNEY_LADDER
    keys = [s["key"] for s in ladder]
    if stage not in keys:
        raise KeyError(stage)
    s_rank = keys.index(stage)
    users = fetch_step_users(cur, ladder, s_rank, d_from=d_from, d_to=d_to, origin=origin,
                             build=build, platform=platform, excl=excl, now=now,
                             window_days=window_days, inactive_days=inactive_days)
    side = fetch_side_actions(cur, [u["user_id"] for u in users])
    emails = {u["user_id"]: u["email"] for u in users}
    return {
        "stage": stage,
        "label": ladder[s_rank]["label"],
        "counts": step_counts(users, s_rank),
        "next": time_to_next(users, s_rank, ladder),
        "breakdown": step_breakdown(users, s_rank, by),
        "by": by,
        "instead": side_action_lift(users, s_rank, side),
        "instead_note": "correlation, not cause",
        "why": why_signals(users, s_rank, side),
        "people": people_by_outcome(users, s_rank, emails),
        "meta": {"window_days": window_days, "inactive_days": inactive_days,
                 "computed_at": now.isoformat()},
    }
