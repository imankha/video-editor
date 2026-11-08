"""T14010: admin Journey map -- pure fold over per-user stage patterns.

Design: docs/plans/admin-journey-dropoff-design-2026-10-30.md Sections 5 and 6.

Every user sits at exactly one FURTHEST stage (highest ladder index they have an action
for). Reaching a stage means reaching every stage before it (T14720), so a user counts at
every rank from 0 to their furthest and stage counts never go up. Only the stages they
have an action for carry a first_at; a stage they skipped has none, and none is invented.
The SQL side (`fetch_patterns`) reduces users to pattern rows
`(mask, outcome, platform, origin, signup_build, signup_month, n)` where `mask` has bit
`rank` set for every stage the user has an action for and `outcome` classifies the user's
furthest stage (in_window / stuck / gone). The fold functions below consume those
rows, so they are unit-testable without Postgres and cost O(patterns), not O(users).

Outcome rules (W = conversion window, I = inactivity threshold):
    in_window : now - first_at(furthest) <  W            (pending, not judged)
    stuck     : now - first_at(furthest) >= W and last_active_at >= now - I
    gone      : now - first_at(furthest) >= W and last_active_at <  now - I
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime
from typing import Any

OUTCOMES = ("in_window", "stuck", "gone")
LOST_OUTCOMES = ("stuck", "gone")

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

    Every pattern row must carry the furthest stage's outcome. A user counts at every
    stage up to their furthest (T14720), so reached(S) >= reached(S + 1) and edges only
    join neighbours. Conservation (asserted by `check_conservation`): reached = continued
    + in_window + stuck + gone at every node, and reached(S) = sum of inflow edges into S.
    """
    size = len(ladder)
    reached = [0] * size
    outcome = [{o: 0 for o in OUTCOMES} for _ in range(size)]
    edge_users = [0] * (size - 1)  # index r: users on the edge from rank r to rank r + 1

    for row in patterns:
        mask, n, out = int(row["mask"]), int(row["n"]), row["outcome"]
        if out not in OUTCOMES:
            raise ValueError(f"unknown outcome {out!r}")
        ranks = [r for r in range(size) if mask >> r & 1]
        if not ranks:
            raise ValueError(f"pattern with empty mask: {row!r}")
        furthest = ranks[-1]
        for r in range(furthest + 1):
            reached[r] += n
        outcome[furthest][out] += n
        for r in range(furthest):
            edge_users[r] += n

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
        {"from": ladder[r]["key"], "to": ladder[r + 1]["key"], "users": users}
        for r, users in enumerate(edge_users) if users
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
                      instrumented_at: dict[str, str], *,
                      cohort_fold: Callable[[date], list[dict]] | None = None) -> None:
    """Honesty flags (design 5.6), in place.

    `partial_from`: the stage's earliest-instrumented action is younger than the signup
    window start, so older signups cannot have reached it. `no_data`: every action of the
    stage was instrumented after the window ended, so a count of 0 would be invented.
    Synthetic stages (no actions) are always instrumented.

    T15230: a partial stage can still be judged over the sign-ups since its own
    instrumentation date. `cohort_fold(cutoff)` re-folds ALL nodes with the window
    narrowed to start at `cutoff` (same ladder order); its result is attached to EVERY
    node (not just the partial one) as `node["cohort_at"][cutoff.isoformat()]`, since the
    OTHER end of a transition needs its reached-at-cutoff too, even when that end is not
    itself flagged partial. Called at most once per distinct cutoff. A `no_data` stage
    never gets a cohort -- it has nothing in the window to fold.
    """
    cohorts: dict[str, list[dict]] = {}
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
            if cohort_fold is not None and node["partial_from"] not in cohorts:
                cohorts[node["partial_from"]] = cohort_fold(first)
    for cutoff, cohort_nodes in cohorts.items():
        for node, cn in zip(nodes, cohort_nodes):
            node.setdefault("cohort_at", {})[cutoff] = cn


def percent_or_fraction(k: int, judged: int) -> dict[str, Any]:
    """Small-N rule: a percentage only when judged >= MIN_JUDGED_FOR_PERCENT, else k / n."""
    if judged >= MIN_JUDGED_FOR_PERCENT:
        return {"pct": round(100.0 * k / judged, 2), "k": k, "n": judged}
    return {"pct": None, "k": k, "n": judged}


def _add_country(conds: list[str], params: dict[str, Any], country: str | None) -> None:
    """Named-param twin of admin._append_country: `unknown` is the NULLs."""
    if country == "unknown":
        conds.append("s.country IS NULL")
    elif country:
        conds.append("s.country = %(country)s")
        params["country"] = country


def _add_sport(conds: list[str], params: dict[str, Any], sport: str | None) -> None:
    """Named-param twin of admin._append_sport (T14930): `unknown` is an ad's own
    utm_content OR none at all, never inferred."""
    from ..analytics import ARRIVAL_SPORT_KEYS

    if sport == "unknown":
        conds.append("(s.utm_content IS NULL OR s.utm_content != ALL(%(sport_keys)s))")
        params["sport_keys"] = list(ARRIVAL_SPORT_KEYS)
    elif sport:
        conds.append("s.utm_content = %(sport)s")
        params["sport"] = sport


def _bucket_arrival_sport(utm_content: str | None) -> str:
    from ..analytics import ARRIVAL_SPORT_KEYS

    return utm_content if utm_content in ARRIVAL_SPORT_KEYS else "unknown"


# T15010: landing_path page classes (design step 5). Mirrors the landing's own page
# structure (src/landing/src/data/sports.ts slugs, src/landing/src/pages/{works-with,vs,
# guides}/, for-clubs/for-coaches/for-parents) by hand -- no shared import between the
# two trees. A path that matches none of these is "other", never inferred further.
_LANDING_PATH_AUDIENCE_PAGES = frozenset({"/for-clubs", "/for-coaches", "/for-parents"})
_LANDING_PATH_SPORT_SLUGS = frozenset({
    "soccer", "basketball", "football", "flag-football", "baseball", "softball",
    "volleyball", "lacrosse", "hockey", "rugby", "tennis",
})


def _bucket_landing_path(landing_path: str | None) -> str:
    """The step inspector's landing_path breakdown groups by page CLASS, not the exact
    path (small N per exact path otherwise). NULL (direct app arrival, or signed up before
    T15010) is the explicit 'unknown' bucket -- never inferred."""
    if not landing_path:
        return "unknown"
    if landing_path == "/":
        return "home"
    if landing_path.startswith("/works-with/"):
        return "works-with"
    if landing_path.startswith("/vs/"):
        return "vs"
    if landing_path.startswith("/guides/"):
        return "guides"
    if landing_path in _LANDING_PATH_AUDIENCE_PAGES:
        return "audience"
    first_segment = landing_path[1:].split("/", 1)[0]
    if first_segment in _LANDING_PATH_SPORT_SLUGS:
        return "sport"
    return "other"


def fetch_patterns(cur, ladder: list[dict], money_ladder: list[dict], *, d_from: date | None,
                   d_to: date, origin: str, build: int | None, platform: str | None, excl: str,
                   window_days: int, inactive_days: int, country: str | None = None,
                   sport: str | None = None) -> list[dict]:
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
    _add_country(conds, params, country)
    _add_sport(conds, params, sport)
    if excl:
        conds.append(excl)
    params["actions"] = sorted({a for st in ladder + money_ladder for a in st["actions"]})
    sql = build_patterns_sql(ladder, money_ladder, excl_join=excl_join,
                             where="WHERE " + " AND ".join(conds), platform_filter=bool(platform))
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def build_journey(cur, *, d_from: date | None, d_to: date, origin: str, build: int | None,
                  platform: str | None, excl: str, window_days: int, inactive_days: int,
                  now: datetime, country: str | None = None, sport: str | None = None) -> dict[str, Any]:
    from ..analytics import EVENT_INSTRUMENTED_AT, JOURNEY_LADDER, JOURNEY_MONEY_LADDER

    ladder = JOURNEY_LADDER
    rows = fetch_patterns(cur, ladder, JOURNEY_MONEY_LADDER, d_from=d_from, d_to=d_to,
                          origin=origin, build=build, platform=platform, excl=excl,
                          window_days=window_days, inactive_days=inactive_days, country=country,
                          sport=sport)
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
    def _cohort_fold(cutoff: date) -> list[dict]:
        # T15230: re-run the same query/fold with the window narrowed to start at `cutoff`,
        # so a partial stage can be judged over the sign-ups it can actually measure.
        cohort_rows = fetch_patterns(cur, ladder, JOURNEY_MONEY_LADDER, d_from=cutoff, d_to=d_to,
                                     origin=origin, build=build, platform=platform, excl=excl,
                                     window_days=window_days, inactive_days=inactive_days,
                                     country=country)
        cohort_folded = fold_journey(
            [{"mask": r["mask"], "outcome": r["outcome"], "n": r["n"]} for r in cohort_rows], ladder)
        return [{"reached": n["reached"], "continued": n["continued"], "in_window": n["in_window"],
                "stuck": n["stuck"], "gone": n["gone"],
                "judged": n["continued"] + n["stuck"] + n["gone"]} for n in cohort_folded["nodes"]]

    annotate_coverage(folded["nodes"], ladder, d_from, d_to, EVENT_INSTRUMENTED_AT,
                      cohort_fold=_cohort_fold)
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
    "country": "country",
    # T14930: bucketed by fetch_step_users (with_sport), never the raw utm_content column.
    "arrival_sport": "arrival_sport",
    # T15010: bucketed by fetch_step_users (with_landing_path), never the raw path column.
    "landing_path": "landing_path",
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
    None). Same rules as the SQL `_outcome_sql`, so counts equal the map's. `reached` is
    every rank up to the furthest; `firsts` stays None at the ranks the user skipped."""
    from datetime import timedelta

    firsts = row["firsts"]
    stamped = [r for r in range(len(ladder)) if firsts[r] is not None]
    if not stamped:
        raise ValueError(f"user {row.get('user_id')!r} reached no stage")
    furthest = stamped[-1]
    if now - firsts[furthest] < timedelta(days=window_days):
        outcome = "in_window"
    # A deleted account keeps its segment row with last_active_at NULL: gone, as in the SQL.
    elif row["last_active_at"] is not None and row["last_active_at"] >= now - timedelta(days=inactive_days):
        outcome = "stuck"
    else:
        outcome = "gone"
    return {**row, "reached": list(range(furthest + 1)), "furthest": furthest, "outcome": outcome}


def _quantile(sorted_vals: list[float], q: float) -> float:
    pos = (len(sorted_vals) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def time_to_next(users: list[dict], s_rank: int, ladder: list[dict]) -> dict[str, Any]:
    """first_at(next stage with a timestamp) - first_at(S) for users who continued past S.
    A user with no first_at for S skipped it: they are left out of the stats, and `timed`
    of `continued` reports how many were usable. Negative deltas are counted as
    `out_of_order` and kept out of the stats (never clamped)."""
    deltas: list[float] = []
    continued = 0
    timed = 0
    out_of_order = 0
    skipped = 0
    for u in users:
        if u["furthest"] <= s_rank:
            continue
        continued += 1
        if u["firsts"][s_rank] is None:
            continue
        timed += 1
        # The furthest stage always has a first_at, so a later stamped rank always exists.
        nxt = next(r for r in range(s_rank + 1, u["furthest"] + 1) if u["firsts"][r] is not None)
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
        "continued": continued,
        "timed": timed,
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
        r["rate_lb"] = round(100 * wilson_lower(r["continued"], judged), 2)
        out.append(r)
    out.sort(key=lambda r: (-(r["stuck"] + r["gone"]), r["key"]))
    return out


def _judged_groups(users: list[dict], s_rank: int) -> tuple[dict[str, dict], dict[str, dict]]:
    """(dropped, continued) judged users with a first_at for S, as user_id -> user. In-window
    users are pending, so they join neither group. Neither does a user who skipped S: the
    lift counts actions after first_at(S), which they do not have."""
    dropped, continued = {}, {}
    for u in users:
        if u["firsts"][s_rank] is None:
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
                    "p_dropped": round(p_d, 4), "p_continued": round(p_c, 4),
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
    """Users who stopped at S, per outcome, newest activity first (deleted accounts have no
    activity, so they come last), capped per outcome."""
    out: dict[str, list] = {o: [] for o in OUTCOMES}
    stopped = sorted((u for u in users if u["furthest"] == s_rank),
                     key=lambda u: (u["last_active_at"] is not None, u["last_active_at"]),
                     reverse=True)
    for u in stopped:
        bucket = out[u["outcome"]]
        if len(bucket) < PEOPLE_CAP:
            bucket.append({"user_id": u["user_id"], "email": emails.get(u["user_id"]),
                           "platform": u["platform"],
                           "last_active_at": u["last_active_at"] and u["last_active_at"].isoformat()})
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
                     now: datetime, window_days: int, inactive_days: int,
                     with_country: bool = False, country: str | None = None,
                     with_sport: bool = False, sport: str | None = None,
                     with_landing_path: bool = False) -> list[dict]:
    """Every user who reached stage `s_rank` (furthest >= s_rank, so a user who skipped it
    counts) under the map's filters, classified. Same population joins as
    `build_patterns_sql`, but one row per user. `with_country`/`with_sport`/
    `with_landing_path` select their column only for the tab that reads it (T14930 mirrors
    T15100's `with_country`; T15010 mirrors both)."""
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
    _add_country(conds, params, country)
    _add_sport(conds, params, sport)
    if excl:
        conds.append(excl)
    at_or_past = ", ".join(f"fa_{r}" for r in range(s_rank, len(ladder)))
    outer = [f"COALESCE({at_or_past}) IS NOT NULL"]
    if platform:
        outer.append("COALESCE(platform, 'unknown') LIKE %(platform_like)s")
        params["platform_like"] = f"%-{platform}"
    stage_cols = ",\n                   ".join(cols)
    country_col = ", s.country" if with_country else ""
    sport_col = ", s.utm_content" if with_sport else ""
    landing_path_col = ", s.landing_path" if with_landing_path else ""
    sql = f"""
        WITH per_user AS (
            SELECT s.user_id, u.email, s.origin, s.signup_build, s.last_active_at, s.acquired_at{country_col}{sport_col}{landing_path_col},
                   (array_agg(a.platform ORDER BY a.first_at NULLS LAST))[1] AS platform,
                   to_char(s.acquired_at, 'YYYY-MM') AS signup_month,
                   {stage_cols}
            FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            LEFT JOIN user_actions a ON a.user_id = s.user_id AND a.action = ANY(%(actions)s)
            WHERE {" AND ".join(conds)}
            GROUP BY s.user_id, u.email, s.origin, s.signup_build, s.last_active_at, s.acquired_at{country_col}{sport_col}{landing_path_col}
        )
        SELECT * FROM per_user WHERE {" AND ".join(outer)}
    """
    cur.execute(sql, params)
    users = []
    for r in cur.fetchall():
        row = dict(r)
        row["platform"] = row["platform"] or "unknown"
        if with_sport:
            row["arrival_sport"] = _bucket_arrival_sport(row.pop("utm_content"))
        if with_landing_path:
            row["landing_path"] = _bucket_landing_path(row.pop("landing_path"))
        row["firsts"] = [row.pop(f"fa_{i}") for i in range(len(ladder))]
        users.append(classify_user(row, ladder, now, window_days, inactive_days))
    return users


def stopped_user_ids(cur, stages: list[str], outcome: str, *, d_from: date | None, d_to: date,
                     origin: str, build: int | None, platform: str | None, excl: str,
                     window_days: int, inactive_days: int, now: datetime) -> list[str]:
    """Who the map counts as stopped at `stages` with `outcome` (T14740). `lost` = stuck + gone,
    as in the loss ranking. Several stages = a collapsed group's summed drops. Raises KeyError
    on an unknown stage."""
    from ..analytics import JOURNEY_LADDER

    ladder = JOURNEY_LADDER
    rank_of = {s["key"]: r for r, s in enumerate(ladder)}
    ranks = {rank_of[stage] for stage in stages}
    outcomes = LOST_OUTCOMES if outcome == "lost" else (outcome,)
    users = fetch_step_users(cur, ladder, min(ranks), d_from=d_from, d_to=d_to, origin=origin,
                             build=build, platform=platform, excl=excl, now=now,
                             window_days=window_days, inactive_days=inactive_days)
    return [u["user_id"] for u in users if u["furthest"] in ranks and u["outcome"] in outcomes]


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
               inactive_days: int, now: datetime, country: str | None = None,
               sport: str | None = None) -> dict[str, Any]:
    from ..analytics import JOURNEY_LADDER

    ladder = JOURNEY_LADDER
    keys = [s["key"] for s in ladder]
    if stage not in keys:
        raise KeyError(stage)
    s_rank = keys.index(stage)
    users = fetch_step_users(cur, ladder, s_rank, d_from=d_from, d_to=d_to, origin=origin,
                             build=build, platform=platform, excl=excl, now=now,
                             window_days=window_days, inactive_days=inactive_days,
                             with_country=by == "country", country=country,
                             with_sport=by == "arrival_sport" or sport is not None, sport=sport,
                             with_landing_path=by == "landing_path")
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
