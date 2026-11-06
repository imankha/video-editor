"""T14910: spend-readiness gates -- "can we spend on ads yet?" as eleven read-only gates in
three tiers, a break-even per sign-up, a channel ladder and two verdicts.

Design: docs/plans/tasks/T14910-design.md (revision 3). Thresholds, windows, floors and the
ladder live in spend_readiness_constants.py; this module holds the rules (pure, unit-tested on
every boundary) and the Postgres readers (one per gate, each taking the admin test-exclusion
predicate and an optional diagnosis `cut`).

Rules:
    rag        a value's colour against its gate's thresholds; grey under SMALL_N_FLOOR
    confidence settled when the 95% interval agrees with the point estimate's colour,
               provisional when it crosses a deciding threshold (colour by the point)
    settle_n   the smallest n at which an interval centred on the point would exclude the
               nearest crossed threshold (Wilson form for proportions, SE for a mean)
    focus      the first tier with a gate that is red, yellow or grey for missing
               instrumentation, then its worst gate; waiting on volume is never a focus
    verdicts   measurement flight allowed (gates 1 to 5 + 10, blocked by any red, a grey
               task gate or the export-event caveat) and channel economics (GO / TEST / NO
               by the point estimate, NO at the upper bound before the floor)

Readers never write. Test accounts are excluded through the caller's predicate, which needs
`LEFT JOIN users u` and the `s` (user_segments) alias on every query.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta
from typing import Any

from . import spend_readiness_constants as C

logger = logging.getLogger(__name__)

RAG_RANK = {"red": 0, "yellow": 1, "grey": 2, "green": 3}
# Actions that count as a true export (the Frame export) for gates 2 and 4 and the
# break-even's export rate: the same pair admin.FIRST_HIGHLIGHT_ACTIONS uses.
EXPORT_ACTIONS = ("credits_consumed", "export_completed")
FINISHED_ACTIONS = ("overlay_exported", *EXPORT_ACTIONS)
TOOK_AWAY_ACTIONS = ("video_downloaded", "share_completed")
# Device family over the stored platform keys (user_context._VALID_PLATFORMS: pwa-/webapp- x
# mobile/desktop): the Journey map's rule. `%%` because every query carries params.
PLATFORM_FAMILY = ("CASE WHEN p.platform LIKE '%%-mobile' THEN 'mobile' "
                   "WHEN p.platform LIKE '%%-desktop' THEN 'desktop' ELSE 'unknown' END")
PLATFORM_JOIN = ("LEFT JOIN (SELECT user_id, (array_agg(platform ORDER BY first_at))[1] AS platform "
                 "FROM user_actions GROUP BY user_id) p ON p.user_id = s.user_id")
CUTS_B = ("weekly", "by_build", "by_platform", "by_country")
CUTS_C = ("weekly",)


# ---------------------------------------------------------------------------
# Pure rules
# ---------------------------------------------------------------------------

def wilson(k: float, n: float, z: float = C.Z) -> tuple[float, float]:
    """95% Wilson score interval for k of n, as fractions. (0, 1) with no data."""
    if n <= 0:
        return 0.0, 1.0
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = p + z2 / (2 * n)
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    lo = 0.0 if k <= 0 else max(0.0, (centre - half) / denom)
    hi = 1.0 if k >= n else min(1.0, (centre + half) / denom)
    return lo, hi


def mean_interval(mean: float, sd: float, n: int, z: float = C.Z) -> tuple[float, float]:
    half = z * sd / math.sqrt(n)
    return mean - half, mean + half


def rag_for(value: float, green: float, yellow: float, direction: str) -> str:
    if direction == "higher":
        if value >= green:
            return "green"
        return "yellow" if value >= yellow else "red"
    if value < green:
        return "green"
    return "yellow" if value < yellow else "red"


def confidence(point: float, lo: float, hi: float, green: float, yellow: float, direction: str) -> str:
    """settled when both bounds read the same colour as the point, else provisional."""
    r = rag_for(point, green, yellow, direction)
    if rag_for(lo, green, yellow, direction) == r == rag_for(hi, green, yellow, direction):
        return "settled"
    return "provisional"


def nearest_crossed(point: float, lo: float, hi: float, green: float, yellow: float,
                    direction: str) -> tuple[float, str] | None:
    """The deciding threshold the interval crosses nearest to the point, and the colour on
    its other side; None when the interval crosses none."""
    crossed = [t for t in (green, yellow) if lo < t <= hi]
    if not crossed:
        return None
    t = min(crossed, key=lambda x: abs(point - x))
    eps = 1e-9 * max(1.0, abs(t))
    point_rag = rag_for(point, green, yellow, direction)
    other = rag_for(t - eps, green, yellow, direction)
    if other == point_rag:
        other = rag_for(t + eps, green, yellow, direction)
    return t, other


def settle_n(p: float, threshold: float) -> int | None:
    """Smallest n at which the Wilson interval for a proportion p excludes `threshold`;
    None when p sits on it or the cap is reached ("cannot settle at this rate")."""
    if p == threshold:
        return None
    above = p > threshold

    def excludes(n: int) -> bool:
        lo, hi = wilson(p * n, n)
        return lo > threshold if above else hi < threshold

    n = 1
    while not excludes(n):
        n *= 2
        if n > C.SETTLE_N_CAP:
            return None
    lo_n, hi_n = n // 2, n  # excludes(hi_n) and not excludes(lo_n) (or lo_n == 0)
    while hi_n - lo_n > 1:
        mid = (lo_n + hi_n) // 2
        if excludes(mid):
            hi_n = mid
        else:
            lo_n = mid
    return hi_n


def settle_n_mean(mean: float, sd: float | None, threshold: float) -> int | None:
    if sd is None or mean == threshold or sd <= 0:
        return None
    return max(1, math.ceil((C.Z * sd / abs(mean - threshold)) ** 2))


def eta_days(more: float, rate_per_day: float | None) -> float | None:
    if not rate_per_day or rate_per_day <= 0:
        return None
    return more / rate_per_day


def variable_cost_cents(*, payers_per_signup: float, revenue_per_payer_cents: float, export_rate: float,
                        plays_per_exporter: float, games_per_signup: float, purchases_per_payer: float) -> float:
    return (export_rate * plays_per_exporter * C.GPU_PER_PLAY_CENTS
            + games_per_signup * C.STORAGE_PER_GAME_CENTS
            + payers_per_signup * (revenue_per_payer_cents * C.STRIPE_PCT
                                   + purchases_per_payer * C.STRIPE_FIXED_CENTS))


def break_even_cents(*, payers_per_signup: float, revenue_per_payer_cents: float, export_rate: float,
                     plays_per_exporter: float, games_per_signup: float, purchases_per_payer: float) -> float:
    """Break-even CAC per sign-up: payers x revenue per payer minus the variable cost."""
    return payers_per_signup * revenue_per_payer_cents - variable_cost_cents(
        payers_per_signup=payers_per_signup, revenue_per_payer_cents=revenue_per_payer_cents,
        export_rate=export_rate, plays_per_exporter=plays_per_exporter,
        games_per_signup=games_per_signup, purchases_per_payer=purchases_per_payer)


def channel_state(break_even: float, cost_cents: float) -> str:
    if break_even >= cost_cents:
        return "GO"
    return "TEST" if break_even >= cost_cents / 2 else "NO"


def _dollars(cents: float) -> str:
    return f"${cents / 100:.2f}"


def channel_rows(*, point: float | None, lower: float | None, upper: float | None,
                 payers_per_signup: float | None = None, signups: int | None = None,
                 revenue_per_payer_cents: float | None = None, variable_cents: float | None = None,
                 club_attributed: int = 0, no_estimate: str | None = None) -> list[dict[str, Any]]:
    """The ladder: one benchmark row per channel, ordered by cost, coloured by the break-even
    against the channel's cost per sign-up. A state whose bounds disagree is provisional and
    names the other reading and the payers needed to settle. With no break-even estimate at all
    (`no_estimate` names the unmeasured factor; the bounds are None) every priced row is grey,
    like a gate under its floor: there is no upper bound, so nothing can be settled either way."""
    if (no_estimate is None) != (point is not None and lower is not None and upper is not None):
        raise ValueError(f"channel_rows: bounds and no_estimate disagree ({point}, {lower}, {upper}, {no_estimate!r})")
    rows = []
    for ch in C.CHANNELS:
        row = {"key": ch["key"], "label": ch["label"], "platform": ch["platform"], "label_kind": "B",
               "note": ch["note"], "n": None, "cost_cents": ch["cost_cents"], "state": None,
               "confidence": None, "reason": ""}
        if ch["cost_cents"] is None:  # club placement: a fixed fee over attributed sign-ups
            row["n"] = club_attributed
            if club_attributed < C.CLUB_MIN_SIGNUPS:
                row["state"] = "grey"
                row["reason"] = f"{C.CLUB_MIN_SIGNUPS} attributed sign-ups needed ({club_attributed} so far)"
                rows.append(row)
                continue
            row["cost_cents"] = ch["fee_cents"] / club_attributed
        if no_estimate is not None:
            row["state"] = "grey"
            row["reason"] = f"no break-even yet: {no_estimate}"
            rows.append(row)
            continue
        cost = row["cost_cents"]
        s_point, s_lo, s_hi = (channel_state(x, cost) for x in (point, lower, upper))
        settled = ((s_point == "GO" and s_lo == "GO")
                   or (s_point == "TEST" and s_lo == "TEST" and s_hi == "TEST")
                   or (s_point == "NO" and s_hi == "NO"))
        row["state"] = s_point
        row["confidence"] = "settled" if settled else "provisional"
        if settled:
            row["reason"] = {
                "GO": f"break-even {_dollars(point)} covers {_dollars(cost)} even at the lower bound {_dollars(lower)}",
                "TEST": f"break-even {_dollars(point)} is within 2x of {_dollars(cost)} at both bounds",
                "NO": f"NO even at the upper bound {_dollars(upper)} (half the cost is {_dollars(cost / 2)})",
            }[s_point]
        else:
            other, side, bound = (s_hi, "upper", upper) if s_hi != s_point else (s_lo, "lower", lower)
            boundary = cost / 2 if "NO" in (s_point, other) else cost
            row["reason"] = f"{other} at the {side} bound {_dollars(bound)}; " + _payers_to_settle(
                boundary, payers_per_signup, signups, revenue_per_payer_cents, variable_cents)
        rows.append(row)
    rows.sort(key=lambda r: (r["cost_cents"] is None, r["cost_cents"] or 0))
    return rows


def _payers_to_settle(boundary: float, payers_per_signup, signups, revenue_per_payer_cents,
                      variable_cents) -> str:
    if not payers_per_signup or not signups or not revenue_per_payer_cents:
        return "settles as payers accumulate (A)"
    rate_needed = (boundary + (variable_cents or 0)) / revenue_per_payer_cents
    n_needed = settle_n(payers_per_signup, rate_needed)
    if n_needed is None:
        return "cannot settle at this rate (A)"
    more_payers = max(0, math.ceil((n_needed - signups) * payers_per_signup))
    return f"{more_payers} more payers to settle (A)"


def _scale(unit: str, fraction: float) -> float:
    if unit in ("pct", "per100"):
        return round(fraction * 100, 2)
    return round(fraction, 4)


def _fmt(unit: str, value) -> str:
    if value is None:
        return "no data"
    if unit == "pct":
        return f"{value:.2f}%"
    if unit == "per100":
        return f"{value:.2f} per 100"
    if unit == "cents":
        return _dollars(value)
    if unit == "counts":
        return f"{value['paywall_users']} paywall, {value['buyers']} bought"
    if unit == "ratio":  # the chip prints the K-factor per 100 sign-ups (admin 2-decimal rule)
        return f"{value * 100:.2f} per 100"
    return f"{value:.3f}"


def _threshold_text(unit: str, value: float) -> str:
    if unit == "cents":
        return _dollars(value)
    if unit == "ratio":
        return f"{value * 100:g} per 100"
    return {"pct": f"{value:g}%", "per100": f"{value:g} per 100"}.get(unit, f"{value:g}")


def _target_text(g: dict) -> str:
    if g["kind"] == "counts":
        return f">= {g['green'][0]} paywall users and >= {g['green'][1]} buyers"
    op = ">=" if g["direction"] == "higher" else "<"
    return f"{op} {_threshold_text(g['unit'], g['green'])}"


def _volume_unblock(have: int, floor: int, unit: str, rate_per_day: float | None) -> dict:
    more = max(0, floor - have)
    eta = eta_days(more, rate_per_day)
    text = f"{more} more {unit} to the floor of {floor}"
    if eta is not None:
        text += f", about {eta:.0f} days at {rate_per_day:.2f} a day (A)"
    return {"kind": "volume", "text": text,
            "need": {"have": have, "floor": floor, "unit": unit, "eta_days": eta, "rate_per_day": rate_per_day}}


def _settle_dict(g: dict, point: float, lo: float, hi: float, n: int, rate_per_day, *,
                 proportion: bool, sd: float | None = None) -> dict | None:
    if confidence(point, lo, hi, g["green"], g["yellow"], g["direction"]) == "settled":
        return None
    t, other = nearest_crossed(point, lo, hi, g["green"], g["yellow"], g["direction"])
    if proportion:
        scale = 100 if g["unit"] in ("pct", "per100") else 1
        n_needed = settle_n(point / scale, t / scale)
    else:
        n_needed = settle_n_mean(point, sd, t)
    more = None if n_needed is None else max(0, n_needed - n)
    eta = None if more is None else eta_days(more, rate_per_day)
    if n_needed is None:
        text = f"crosses {_threshold_text(g['unit'], t)} ({other}); cannot settle at this rate"
    else:
        text = f"crosses {_threshold_text(g['unit'], t)} ({other}); {more} more to settle"
        if eta is not None:
            text += f", about {eta:.0f} days (A)"
    return {"crosses": t, "crosses_rag": other, "n_needed": n_needed, "more": more, "eta_days": eta, "text": text}


def _recent_dict(g: dict, k: int, n: int) -> dict:
    row = {"k": k, "n": n, "value": None, "interval": None, "rag": "grey", "confidence": None}
    if n >= C.SMALL_N_FLOOR:
        lo, hi = wilson(k, n)
        row["value"] = _scale(g["unit"], k / n)
        row["interval"] = [_scale(g["unit"], lo), _scale(g["unit"], hi)]
        row["rag"] = rag_for(row["value"], g["green"], g["yellow"], g["direction"])
        row["confidence"] = confidence(row["value"], row["interval"][0], row["interval"][1],
                                       g["green"], g["yellow"], g["direction"])
    return row


def has_diagnosis(key: str) -> bool:
    """Whether a gate has a Diagnose drawer: Tier A gates are shipped, not diagnosed; kind none
    has no reader yet; NO_DIAGNOSIS_GATES are excluded by design. False for an unknown key."""
    g = C.GATE_BY_KEY.get(key)
    return g is not None and g["tier"] != "A" and g["kind"] != "none" and key not in C.NO_DIAGNOSIS_GATES


def gate_row(key: str, *, k: int | None = None, n: int | None = None, mean: float | None = None,
             sd: float | None = None, counts: tuple[int, int] | None = None, recent: dict | None = None,
             caveats=(), unblock: dict | None = None, reference: dict | None = None,
             computed_at: datetime, rate_per_day: float | None = None, floor_unit: str = "sign-ups",
             extra: dict | None = None) -> dict[str, Any]:
    """One gate's payload row from its measured inputs: colour, interval, confidence, settle
    and the default unblock (volume to the floor) unless the caller names another."""
    g = C.GATE_BY_KEY[key]
    row: dict[str, Any] = {
        "key": key, "tier": g["tier"], "label": g["label"], "kind": g["kind"], "unit": g["unit"],
        "label_kind": "M", "value": None, "n": n, "k": k, "interval": None, "confidence": None,
        "settle": None, "recent": recent,
        "target": {"green": g["green"], "yellow": g["yellow"], "direction": g["direction"], "text": _target_text(g)},
        "why": g["why"], "caveats": list(caveats), "reference": reference, "rag": "grey",
        "unblock": {"kind": "none", "text": "", "need": None},
        "computed_at": computed_at.isoformat(), "diagnosable": has_diagnosis(key),
    }
    if g["kind"] == "proportion":
        n = n or 0
        row["n"] = n
        if n < C.SMALL_N_FLOOR:
            row["unblock"] = _volume_unblock(n, C.SMALL_N_FLOOR, floor_unit, rate_per_day)
        else:
            lo, hi = wilson(k, n)
            row["value"] = _scale(g["unit"], k / n)
            row["interval"] = [_scale(g["unit"], lo), _scale(g["unit"], hi)]
            row["rag"] = rag_for(row["value"], g["green"], g["yellow"], g["direction"])
            row["confidence"] = confidence(row["value"], row["interval"][0], row["interval"][1],
                                           g["green"], g["yellow"], g["direction"])
            row["settle"] = _settle_dict(g, row["value"], row["interval"][0], row["interval"][1], n,
                                         rate_per_day, proportion=True)
    elif g["kind"] == "mean":
        n = n or 0
        row["n"] = n
        row["value"] = None if mean is None else round(mean, 2)
        if mean is not None and n > 0:
            if n >= 5 and sd is not None:
                sd_used, sd_label = sd, "M"
            else:
                sd_used, sd_label = mean * C.REVENUE_CV_ASSUMED, "A"
            lo, hi = mean_interval(mean, sd_used, n)
            row["interval"] = [round(lo, 2), round(hi, 2)]
            row["interval_label_kind"] = sd_label
            if n >= C.SMALL_N_FLOOR:
                row["rag"] = rag_for(mean, g["green"], g["yellow"], g["direction"])
                row["confidence"] = confidence(mean, lo, hi, g["green"], g["yellow"], g["direction"])
                row["settle"] = _settle_dict(g, mean, lo, hi, n, rate_per_day, proportion=False, sd=sd_used)
        if n < C.SMALL_N_FLOOR:
            row["unblock"] = _volume_unblock(n, C.SMALL_N_FLOOR, "payers", rate_per_day)
    elif g["kind"] == "counts":
        paywall, buyers = counts or (0, 0)
        row["value"] = {"paywall_users": paywall, "buyers": buyers}
        row["n"] = paywall
        row["k"] = buyers
        if paywall >= g["green"][0] and buyers >= g["green"][1]:
            row["rag"] = "green"
        elif paywall >= g["yellow"][0] and buyers >= g["yellow"][1]:
            row["rag"] = "yellow"
        else:
            row["rag"] = "red"
        if row["rag"] != "green":
            row["unblock"] = _volume_unblock(paywall, g["green"][0], "paywall users", rate_per_day)
    if unblock is not None:
        row["unblock"] = unblock
    if extra:
        row.update(extra)
    return row


def _needs_work(g: dict) -> bool:
    return g["rag"] in ("red", "yellow") or (g["rag"] == "grey" and g["unblock"]["kind"] == "task")


def focus(gates: list[dict]) -> dict | None:
    """First tier with a gate that is red, yellow or grey for missing instrumentation, then
    the worst gate in it (red before yellow before grey; ties by gate order)."""
    for tier in C.TIERS:
        candidates = [(i, g) for i, g in enumerate(gates) if g["tier"] == tier and _needs_work(g)]
        if candidates:
            _, worst = min(candidates, key=lambda ig: (RAG_RANK[ig[1]["rag"]], ig[0]))
            return {"tier": tier, "gate": worst["key"], "label": worst["label"], "rag": worst["rag"],
                    "unblocked_by": C.TIERS[tier]["unblocked_by"]}
    return None


def measurement_test(gates: list[dict]) -> dict:
    """Is the $1,000 measurement flight allowed? Blocked by any gate 1 to 5 that is red, grey
    for a missing instrument, or carrying the export-event caveat, and by a red gate 10."""
    def blocks(g: dict) -> bool:
        if g["key"] == "attribution_coverage":
            return g["rag"] == "red"
        if g["key"] not in C.MEASUREMENT_TEST_GATES:
            return False
        return (g["rag"] == "red" or (g["rag"] == "grey" and g["unblock"]["kind"] == "task")
                or C.CAVEAT_EXPORT_EVENT in g["caveats"])

    blocking = [g["key"] for g in gates if blocks(g)]
    return {"allowed": not blocking, "blocking": blocking}


def all_green(gates: list[dict], channels: list[dict]) -> bool:
    """Every gate settled green and at least one channel settled GO: the "start marketing" cue.
    A count gate has no interval, so its green is settled by construction."""
    return (all(g["rag"] == "green" and g["confidence"] != "provisional" for g in gates)
            and any(c["state"] == "GO" and c["confidence"] == "settled" for c in channels))


def verdict(gates: list[dict], channels: list[dict], focus_: dict | None, measurement: dict,
            break_even: dict) -> dict:
    green = all_green(gates, channels)
    if green:
        headline = "Start marketing."
    elif focus_ is None:
        headline = "Not yet: waiting on volume."
    else:
        headline = {"A": "Not yet: ship the instruments.", "B": "Not yet: fix the funnel.",
                    "C": "Not yet: the economics."}[focus_["tier"]]
    parts = []
    bad = [g for g in gates if g["rag"] in ("red", "yellow")]
    if bad:
        parts.append("; ".join(f"{g['label']} {_fmt(g['unit'], g['value'])} {g['rag']}"
                               + (f", {g['confidence']}" if g["confidence"] else "") for g in bad) + ".")
    if measurement["allowed"]:
        parts.append("Measurement flight allowed.")
    else:
        by_key = {g["key"]: g for g in gates}
        first = by_key[measurement["blocking"][0]]["label"]
        parts.append(f"Measurement flight blocked by {len(measurement['blocking'])} gate(s) (first: {first}).")
    parts.append("Channels: " + ", ".join(
        f"{c['label']} {c['state']}" + (" (provisional)" if c["confidence"] == "provisional" else "")
        for c in channels) + ".")
    if break_even.get("no_estimate"):
        parts.append(f"Break-even: no estimate yet ({break_even['no_estimate']}).")
    elif break_even.get("point_cents") is not None:
        parts.append(f"Break-even today {_dollars(break_even['point_cents'])}, "
                     f"at most {_dollars(break_even['upper_cents'])} (A).")
    return {"headline": headline, "line": " ".join(parts), "all_green": green}


# ---------------------------------------------------------------------------
# Readers (Postgres). Every query: user_segments s LEFT JOIN users u, so the caller's
# test-exclusion predicate composes. `cut` names a diagnosis grouping or None.
# ---------------------------------------------------------------------------

def _and(excl: str) -> str:
    return f" AND {excl}" if excl else ""


def _group(cut: str | None, acquired: str = "s.acquired_at") -> tuple[str, str]:
    """(group expression, extra join) for a cut."""
    if cut is None:
        return "NULL", ""
    if cut == "weekly":
        return f"date_trunc('week', {acquired})::date", ""
    if cut == "by_build":
        return "s.signup_build", ""
    if cut == "by_platform":
        return PLATFORM_FAMILY, PLATFORM_JOIN
    if cut == "by_country":
        return "COALESCE(s.country, 'unknown')", ""
    raise KeyError(cut)


def _exists(actions: tuple[str, ...], param: str, deadline: str = "") -> str:
    return (f"EXISTS (SELECT 1 FROM user_actions a WHERE a.user_id = s.user_id "
            f"AND a.action = ANY(%({param})s){deadline})")


def _cohort_rows(cur, excl: str, today: date, *, lo_days: int, hi_days: int, hit: str,
                 population: str = "", params: dict | None = None, cut: str | None = None) -> list[dict]:
    """Sign-ups acquired between lo_days and hi_days ago (inclusive), n and the k that `hit`."""
    grp, join = _group(cut)
    cur.execute(f"""
        SELECT {grp} AS grp, COUNT(*) AS n, COUNT(*) FILTER (WHERE {hit}) AS k
        FROM user_segments s
        LEFT JOIN users u ON u.user_id = s.user_id
        {join}
        WHERE s.acquired_at BETWEEN %(d_lo)s AND %(d_hi)s {population}{_and(excl)}
        GROUP BY grp
    """, {**(params or {}), "d_lo": today - timedelta(days=lo_days), "d_hi": today - timedelta(days=hi_days)})
    return [{"grp": r["grp"], "n": int(r["n"]), "k": int(r["k"])} for r in cur.fetchall()]


def _total(rows: list[dict]) -> tuple[int, int]:
    return sum(r["k"] for r in rows), sum(r["n"] for r in rows)


def _gate2_cohort() -> dict:
    deadline = " AND a.first_at <= (s.acquired_at + %(mature)s)::timestamp AT TIME ZONE 'UTC'"
    return {"hit": _exists(EXPORT_ACTIONS, "export_actions", deadline),
            "params": {"export_actions": list(EXPORT_ACTIONS), "mature": C.MATURE_DAYS}}


def _gate4_cohort() -> dict:
    return {"hit": _exists(TOOK_AWAY_ACTIONS, "took_away"),
            "population": " AND " + _exists(FINISHED_ACTIONS, "finished"),
            "params": {"took_away": list(TOOK_AWAY_ACTIONS), "finished": list(FINISHED_ACTIONS)}}


def _gate2_rows(cur, excl, today, *, lo_days, hi_days, cut=None):
    return _cohort_rows(cur, excl, today, lo_days=lo_days, hi_days=hi_days, cut=cut, **_gate2_cohort())


def _gate4_rows(cur, excl, today, *, lo_days, hi_days, cut=None):
    return _cohort_rows(cur, excl, today, lo_days=lo_days, hi_days=hi_days, cut=cut, **_gate4_cohort())


def _mature_window() -> tuple[int, int]:
    """(lo_days, hi_days) ago: sign-ups old enough for the 14 d outcome, over the cohort span."""
    return C.COHORT_DAYS + C.MATURE_DAYS, C.MATURE_DAYS


DRILL_COHORTS = {"signup_to_export_14d": _gate2_cohort, "finished_to_took_away": _gate4_cohort}


def gate_lost_user_ids(cur, excl: str, now: datetime, key: str) -> list[str]:
    """The n - k behind a mature-cohort gate: the same population and hit as its reader, so the
    Users list a drill opens is the number on the gate. KeyError for a gate outside DRILL_COHORTS."""
    spec = DRILL_COHORTS[key]()
    today = now.date()
    lo_days, hi_days = _mature_window()
    cur.execute(f"""
        SELECT s.user_id
        FROM user_segments s
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE s.acquired_at BETWEEN %(d_lo)s AND %(d_hi)s {spec.get("population", "")}{_and(excl)}
          AND NOT ({spec["hit"]})
    """, {**spec["params"], "d_lo": today - timedelta(days=lo_days), "d_hi": today - timedelta(days=hi_days)})
    return [r["user_id"] for r in cur.fetchall()]


def _gate6_rows(cur, excl, today, *, lo_days, hi_days, cut=None):
    return _cohort_rows(cur, excl, today, lo_days=lo_days, hi_days=hi_days, cut=cut,
                        hit="EXISTS (SELECT 1 FROM payments p2 WHERE p2.user_id = s.user_id AND p2.kind = 'purchase')")


def _gate9_rows(cur, excl, today, *, lo_days, hi_days, cut=None):
    return _cohort_rows(cur, excl, today, lo_days=lo_days, hi_days=hi_days, cut=cut,
                        hit="EXISTS (SELECT 1 FROM referrals r WHERE r.referred_id = s.user_id)")


def _gate3_rows(cur, excl, today, *, days: int, cut=None) -> list[dict]:
    """Upload outcomes per user-day (user_usage_daily, v042), test accounts excluded."""
    grp, join = _group(cut, acquired="d.day")
    cur.execute(f"""
        SELECT {grp} AS grp,
               COALESCE(SUM(d.game_uploads_failed), 0) AS k,
               COALESCE(SUM(d.game_uploads_succeeded + d.game_uploads_failed), 0) AS n,
               MIN(d.day) FILTER (WHERE d.game_uploads_succeeded + d.game_uploads_failed > 0) AS since
        FROM user_usage_daily d
        JOIN user_segments s ON s.user_id = d.user_id
        LEFT JOIN users u ON u.user_id = s.user_id
        {join}
        WHERE d.day >= %(d_from)s {_and(excl)}
        GROUP BY grp
    """, {"d_from": today - timedelta(days=days)})
    return [{"grp": r["grp"], "n": int(r["n"]), "k": int(r["k"]), "since": r["since"]} for r in cur.fetchall()]


def _gate3_reference(cur, today) -> dict | None:
    cur.execute("""
        SELECT COALESCE(SUM(game_uploads_failed), 0) AS k,
               COALESCE(SUM(game_uploads_succeeded + game_uploads_failed), 0) AS n
        FROM daily_counters WHERE origin_type = 'all' AND counter_date >= %s
    """, (today - timedelta(days=C.COHORT_DAYS),))
    r = cur.fetchone()
    n, k = int(r["n"]), int(r["k"])
    return {"value": round(100 * k / n, 2) if n else None, "n": n, "k": k,
            "text": f"all accounts incl. test accounts, daily_counters {C.COHORT_DAYS} d"}


def _gate5(cur, excl, now: datetime) -> tuple[tuple[int, int], float]:
    cur.execute(f"""
        SELECT COUNT(DISTINCT s.user_id) FILTER (WHERE a.action = 'paywall_shown') AS paywall,
               COUNT(DISTINCT s.user_id) FILTER (WHERE a.action = 'credit_purchased') AS buyers,
               COUNT(DISTINCT s.user_id) FILTER (WHERE a.action = 'paywall_shown' AND a.first_at >= %(d90)s) AS paywall_90
        FROM user_actions a
        JOIN user_segments s ON s.user_id = a.user_id
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE a.action IN ('paywall_shown', 'credit_purchased') AND a.first_at >= %(reprice)s {_and(excl)}
    """, {"reprice": C.REPRICE_DATE, "d90": now - timedelta(days=C.COHORT_DAYS)})
    r = cur.fetchone()
    # The count runs from REPRICE_DATE, so the daily rate divides by the days observed since
    # then, capped at COHORT_DAYS (review follow-up 2026-11-06: a flat 90 read 7.5x too low).
    observed_days = min(C.COHORT_DAYS, max(1, (now.date() - C.REPRICE_DATE).days))
    return (int(r["paywall"]), int(r["buyers"])), int(r["paywall_90"]) / observed_days


def _payers_cte(excl: str, where: str) -> str:
    return f"""
        per_payer AS (
            SELECT p.user_id, SUM(p.amount_cents) AS cents, COUNT(*) AS purchases,
                   MIN(p.occurred_at) AS first_at
            FROM payments p
            JOIN user_segments s ON s.user_id = p.user_id
            LEFT JOIN users u ON u.user_id = s.user_id
            WHERE p.kind = 'purchase' {where}{_and(excl)}
            GROUP BY p.user_id
        )"""


def _gate7(cur, excl, now: datetime, cut: str | None = None) -> list[dict]:
    """Revenue per payer over REVENUE_DAYS: n payers, mean, sample SD, purchases; weekly cut
    buckets payers by their first purchase in the window."""
    grp = "date_trunc('week', first_at)::date" if cut == "weekly" else "NULL"
    cur.execute(f"""
        WITH {_payers_cte(excl, "AND p.occurred_at >= %(since)s")}
        SELECT {grp} AS grp, COUNT(*) AS n, AVG(cents) AS mean, STDDEV_SAMP(cents) AS sd,
               COALESCE(SUM(purchases), 0) AS purchases,
               COUNT(*) FILTER (WHERE first_at >= %(d90)s) AS payers_90
        FROM per_payer GROUP BY grp
    """, {"since": now - timedelta(days=C.REVENUE_DAYS), "d90": now - timedelta(days=C.COHORT_DAYS)})
    return [{"grp": r["grp"], "n": int(r["n"]), "mean": None if r["mean"] is None else float(r["mean"]),
             "sd": None if r["sd"] is None else float(r["sd"]), "purchases": int(r["purchases"]),
             "payers_90": int(r["payers_90"])} for r in cur.fetchall()]


def _gate8(cur, excl, now: datetime) -> list[dict]:
    """Repeat purchase among payers whose first purchase is REPEAT_AGE_DAYS old. No cut: those
    payers are at least that old, so a recent-weeks drawer could only ever read 0 of 0."""
    cur.execute(f"""
        WITH {_payers_cte(excl, "")}
        SELECT NULL AS grp,
               COUNT(*) FILTER (WHERE first_at <= %(eligible)s) AS n,
               COUNT(*) FILTER (WHERE first_at <= %(eligible)s AND EXISTS (
                   SELECT 1 FROM payments q WHERE q.user_id = per_payer.user_id AND q.kind = 'purchase'
                     AND q.occurred_at >= per_payer.first_at + make_interval(days => %(gap)s))) AS k,
               MIN(first_at) FILTER (WHERE first_at > %(eligible)s) AS next_first
        FROM per_payer GROUP BY grp
    """, {"eligible": now - timedelta(days=C.REPEAT_AGE_DAYS), "gap": C.REPEAT_GAP_DAYS})
    return [{"grp": r["grp"], "n": int(r["n"]), "k": int(r["k"]), "next_first": r["next_first"]}
            for r in cur.fetchall()]


def _export_event_live(cur, today) -> bool:
    cur.execute("SELECT COALESCE(SUM(exports_started), 0) AS n FROM daily_counters WHERE counter_date >= %s",
                (today - timedelta(days=C.RECENT_DAYS),))
    return int(cur.fetchone()["n"]) > 0


def _visit_daily_exists(cur) -> bool:
    cur.execute("SELECT to_regclass('visit_daily') IS NOT NULL AS present")
    return bool(cur.fetchone()["present"])


def _cohort_inputs(cur, excl, today) -> dict:
    cur.execute(f"""
        SELECT COUNT(*) AS signups,
               COUNT(*) FILTER (WHERE {_exists(EXPORT_ACTIONS, "export_actions")}) AS exporters,
               COALESCE(SUM((SELECT SUM(a.count) FROM user_actions a
                             WHERE a.user_id = s.user_id AND a.action = 'credits_consumed')), 0) AS plays,
               COALESCE(SUM((SELECT SUM(a.count) FROM user_actions a
                             WHERE a.user_id = s.user_id AND a.action = 'game_upload_succeeded')), 0) AS games
        FROM user_segments s
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE s.acquired_at BETWEEN %(d_lo)s AND %(d_hi)s {_and(excl)}
    """, {"export_actions": list(EXPORT_ACTIONS), "d_lo": today - timedelta(days=C.COHORT_DAYS), "d_hi": today})
    r = cur.fetchone()
    return {k: int(r[k]) for k in ("signups", "exporters", "plays", "games")}


def _signups_by_country(cur, excl, today) -> list[dict]:
    cur.execute(f"""
        SELECT COALESCE(s.country, 'unknown') AS country, COUNT(*) AS n
        FROM user_segments s
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE s.acquired_at BETWEEN %(d_lo)s AND %(d_hi)s {_and(excl)}
        GROUP BY 1 ORDER BY n DESC, country
    """, {"d_lo": today - timedelta(days=C.COHORT_DAYS), "d_hi": today})
    rows = cur.fetchall()
    total = sum(int(r["n"]) for r in rows)
    return [{"country": r["country"], "n": int(r["n"]), "pct": round(100 * int(r["n"]) / total, 2)} for r in rows]


def _ratio(a: float, b: float) -> float:
    return a / b if b else 0.0


def _break_even(g6: dict, g7: dict, inputs: dict, purchases_per_payer: float) -> dict:
    """Break-even per sign-up with its 95% bounds. Both factors must be MEASURED for any bound
    to exist: with no sign-up in the cohort or no payer in REVENUE_DAYS there is no estimate,
    so every bound is None and `no_estimate` names the missing input (2026-11-06 follow-up:
    treating a missing revenue per payer as $0.00 manufactured a settled NO on every channel)."""
    signups = inputs["signups"]
    export_rate = _ratio(inputs["exporters"], signups)
    plays_per_exporter = _ratio(inputs["plays"], inputs["exporters"])
    games_per_signup = _ratio(inputs["games"], signups)
    payers = g6["k"] / g6["n"] if g6["n"] else None
    revenue = g7["value"]
    if payers is None:
        missing = f"0 sign-ups in the {C.COHORT_DAYS} d cohort"
    elif revenue is None:
        missing = f"0 payers in {C.REVENUE_DAYS} d"
    else:
        missing = None
    base = {"readable": False, "label_kind": "M", "upper_label_kind": "A", "binding_input": None,
            "binding_text": None, "no_estimate": missing,
            "inputs": {"payers_per_signup": payers, "revenue_per_payer_cents": revenue, "export_rate": export_rate,
                       "plays_per_exporter": plays_per_exporter, "games_per_signup": games_per_signup,
                       "purchases_per_payer": purchases_per_payer, "variable_cents": None, "signups": signups}}
    if missing is not None:
        return {**base, "point_cents": None, "lower_cents": None, "upper_cents": None,
                "text": f"no break-even yet: {missing}"}
    rev_lo, rev_hi = g7["interval"]
    kw = {"export_rate": export_rate, "plays_per_exporter": plays_per_exporter,
          "games_per_signup": games_per_signup, "purchases_per_payer": purchases_per_payer}
    point = break_even_cents(payers_per_signup=payers, revenue_per_payer_cents=revenue, **kw)
    variable = variable_cost_cents(payers_per_signup=payers, revenue_per_payer_cents=revenue, **kw)
    p_lo, p_hi = wilson(g6["k"], g6["n"])
    lower = break_even_cents(payers_per_signup=p_lo, revenue_per_payer_cents=max(rev_lo, 0), **kw)
    upper = break_even_cents(payers_per_signup=p_hi, revenue_per_payer_cents=rev_hi, **kw)
    readable = g6["n"] >= C.SMALL_N_FLOOR and g7["n"] >= C.SMALL_N_FLOOR
    g6c, g7c = C.GATE_BY_KEY["payers_per_100"], C.GATE_BY_KEY["revenue_per_payer"]
    cheapest = min(c["cost_cents"] for c in C.CHANNELS if c["cost_cents"] is not None)
    binding = None
    if readable and point < cheapest:
        at_payers = break_even_cents(payers_per_signup=g6c["green"] / 100, revenue_per_payer_cents=revenue, **kw)
        at_revenue = break_even_cents(payers_per_signup=payers, revenue_per_payer_cents=g7c["green"], **kw)
        if max(at_payers, at_revenue) >= cheapest:
            binding = "payers_per_100" if at_payers >= at_revenue else "revenue_per_payer"
    text = (f"{payers * 100:.2f}% payers x {_dollars(revenue)} - {_dollars(variable)} variable "
            f"({export_rate:.3f} export x {plays_per_exporter:.1f} plays x {_dollars(C.GPU_PER_PLAY_CENTS)} "
            f"+ {games_per_signup:.2f} games x {_dollars(C.STORAGE_PER_GAME_CENTS)} + Stripe)")
    base["inputs"]["variable_cents"] = round(variable, 2)
    return {**base, "point_cents": round(point, 2), "lower_cents": round(lower, 2), "upper_cents": round(upper, 2),
            "readable": readable, "binding_input": binding,
            "binding_text": ("Revenue per payer is the input that moves paid channels into range: a pricing "
                             "decision, not a funnel fix." if binding == "revenue_per_payer" else None),
            "text": text}


def build_spend_readiness(cur, excl: str, now: datetime) -> dict[str, Any]:
    """The whole panel in one read: eleven gates in order, focus, both verdicts, break-even,
    the channel ladder and sign-ups by country."""
    today = now.date()
    export_live = _export_event_live(cur, today)
    caveats = [] if export_live else [C.CAVEAT_EXPORT_EVENT]
    mature_lo, mature_hi = _mature_window()
    recent_lo = C.RECENT_DAYS + C.MATURE_DAYS
    gates: list[dict] = []

    # 1 visit -> sign-up
    if _visit_daily_exists(cur):
        logger.warning("[spend-readiness] visit_daily exists but gate 1 has no reader yet (T7410)")
        text = "visit_daily exists but this gate has no reader yet"
    else:
        text = "not instrumented: no visit beacon (visit_daily missing)"
    gates.append(gate_row("visit_to_signup", k=0, n=0, computed_at=now,
                          unblock={"kind": "task", "text": text, "need": None}))

    # 2 sign-up -> export in 14 d (mature cohort), recent = last 30 d of mature sign-ups
    rows = _gate2_rows(cur, excl, today, lo_days=mature_lo, hi_days=mature_hi)
    k, n = _total(rows)
    rk, rn = _total(_gate2_rows(cur, excl, today, lo_days=recent_lo, hi_days=mature_hi))
    g2 = C.GATE_BY_KEY["signup_to_export_14d"]
    gates.append(gate_row("signup_to_export_14d", k=k, n=n, recent=_recent_dict(g2, rk, rn), caveats=caveats,
                          computed_at=now, rate_per_day=n / C.COHORT_DAYS))

    # 3 upload failure (user_usage_daily, since v042), reference from daily_counters
    rows = _gate3_rows(cur, excl, today, days=C.COHORT_DAYS)
    k, n = _total(rows)
    since = min((r["since"] for r in rows if r["since"]), default=None)
    rk, rn = _total(_gate3_rows(cur, excl, today, days=C.RECENT_DAYS))
    g3 = C.GATE_BY_KEY["upload_failure"]
    span_days = (today - since).days + 1 if since else 0
    gates.append(gate_row("upload_failure", k=k, n=n, recent=_recent_dict(g3, rk, rn), computed_at=now,
                          reference=_gate3_reference(cur, today), floor_unit="attempts",
                          rate_per_day=n / span_days if span_days else None,
                          extra={"span": {"since": since.isoformat() if since else None, "days": span_days}}))

    # 4 finished -> took away (mature cohort)
    rows = _gate4_rows(cur, excl, today, lo_days=mature_lo, hi_days=mature_hi)
    k, n = _total(rows)
    rk, rn = _total(_gate4_rows(cur, excl, today, lo_days=recent_lo, hi_days=mature_hi))
    g4 = C.GATE_BY_KEY["finished_to_took_away"]
    gates.append(gate_row("finished_to_took_away", k=k, n=n, recent=_recent_dict(g4, rk, rn), caveats=caveats,
                          computed_at=now, rate_per_day=n / C.COHORT_DAYS, floor_unit="finished highlights"))

    # 5 money ladder n since the reprice
    counts, paywall_rate = _gate5(cur, excl, now)
    gates.append(gate_row("money_ladder_n", counts=counts, computed_at=now, rate_per_day=paywall_rate))

    # 6 payers per 100 sign-ups (90 d cohort), recent 30 d
    rows = _gate6_rows(cur, excl, today, lo_days=C.COHORT_DAYS, hi_days=0)
    k6, n6 = _total(rows)
    rk, rn = _total(_gate6_rows(cur, excl, today, lo_days=C.RECENT_DAYS, hi_days=0))
    g6 = C.GATE_BY_KEY["payers_per_100"]
    gates.append(gate_row("payers_per_100", k=k6, n=n6, recent=_recent_dict(g6, rk, rn), computed_at=now,
                          rate_per_day=n6 / C.COHORT_DAYS))

    # 7 revenue per payer (180 d)
    r7 = (_gate7(cur, excl, now) or [{"n": 0, "mean": None, "sd": None, "purchases": 0, "payers_90": 0}])[0]
    gates.append(gate_row("revenue_per_payer", mean=r7["mean"], sd=r7["sd"], n=r7["n"], computed_at=now,
                          rate_per_day=r7["payers_90"] / C.COHORT_DAYS))

    # 8 repeat purchase: eligibility is time, not volume
    r8 = (_gate8(cur, excl, now) or [{"n": 0, "k": 0, "next_first": None}])[0]
    if r8["next_first"] is not None:
        eligible_on = (r8["next_first"] + timedelta(days=C.REPEAT_AGE_DAYS)).date().isoformat()
        when = f"next payer eligible {eligible_on}"
    else:
        when = "no further payers yet"
    unblock8 = None
    if r8["n"] < C.SMALL_N_FLOOR:
        unblock8 = {"kind": "time", "text": f"{r8['n']} of {C.SMALL_N_FLOOR} eligible; {when}",
                    "need": {"have": r8["n"], "floor": C.SMALL_N_FLOOR, "unit": "eligible payers",
                             "eta_days": None, "rate_per_day": None}}
    gates.append(gate_row("repeat_purchase", k=r8["k"], n=r8["n"], computed_at=now, unblock=unblock8,
                          floor_unit="eligible payers"))

    # 9 K-factor (90 d), recent 30 d
    rows = _gate9_rows(cur, excl, today, lo_days=C.COHORT_DAYS, hi_days=0)
    k, n = _total(rows)
    rk, rn = _total(_gate9_rows(cur, excl, today, lo_days=C.RECENT_DAYS, hi_days=0))
    g9 = C.GATE_BY_KEY["k_factor"]
    gates.append(gate_row("k_factor", k=k, n=n, recent=_recent_dict(g9, rk, rn), computed_at=now,
                          rate_per_day=n / C.COHORT_DAYS))

    # 10, 11: the campaign registry has no spend or channel columns until T15200
    gates.append(gate_row("attribution_coverage", computed_at=now,
                          unblock={"kind": "none", "text": f"no paid campaign yet; {C.T15200_TEXT}", "need": None}))
    gates.append(gate_row("kickback_payers_per_100", computed_at=now,
                          unblock={"kind": "volume", "text": f"{C.T15200_TEXT}; {C.KICKBACK_MIN_SIGNUPS} attributed sign-ups",
                                   "need": {"have": 0, "floor": C.KICKBACK_MIN_SIGNUPS, "unit": "attributed sign-ups",
                                            "eta_days": None, "rate_per_day": None}}))

    inputs = _cohort_inputs(cur, excl, today)
    purchases_per_payer = _ratio(r7["purchases"], r7["n"])
    break_even = _break_even(gates[5], gates[6], inputs, purchases_per_payer)
    channels = channel_rows(point=break_even["point_cents"], lower=break_even["lower_cents"],
                            upper=break_even["upper_cents"],
                            payers_per_signup=break_even["inputs"]["payers_per_signup"], signups=inputs["signups"],
                            revenue_per_payer_cents=break_even["inputs"]["revenue_per_payer_cents"],
                            variable_cents=break_even["inputs"]["variable_cents"],
                            no_estimate=break_even["no_estimate"])
    focus_ = focus(gates)
    measurement = measurement_test(gates)
    return {
        "computed_at": now.isoformat(),
        "meta": {"small_n_floor": C.SMALL_N_FLOOR, "cohort_days": C.COHORT_DAYS, "recent_days": C.RECENT_DAYS,
                 "mature_days": C.MATURE_DAYS, "revenue_days": C.REVENUE_DAYS, "reprice_date": C.REPRICE_DATE.isoformat(),
                 "tiers": C.TIERS, "export_event_live": export_live},
        "focus": focus_,
        "measurement_test": measurement,
        "verdict": verdict(gates, channels, focus_, measurement, break_even),
        "gates": gates,
        "break_even": break_even,
        "channels": channels,
        "signups_by_country": _signups_by_country(cur, excl, today),
    }


# ---------------------------------------------------------------------------
# Diagnosis: the Tier B drawers (weekly, by build, by platform, by country) and Tier C's weekly.
# ---------------------------------------------------------------------------

def _cut_row(g: dict, group, k: int, n: int) -> dict:
    row = {"group": group, "n": n, "k": k, "value": None, "interval": None, "rag": "grey",
           "confidence": None, "text": f"{k} of {n}"}
    if n >= C.SMALL_N_FLOOR:
        r = _recent_dict(g, k, n)
        row.update(value=r["value"], interval=r["interval"], rag=r["rag"], confidence=r["confidence"],
                   text=_fmt(g["unit"], r["value"]))
    return row


def _weekly(g: dict, rows: list[dict], today: date) -> list[dict]:
    """WEEKLY_WEEKS buckets ending this week (Monday keys), zero-filled."""
    this_monday = today - timedelta(days=today.weekday())
    weeks = [this_monday - timedelta(weeks=w) for w in range(C.WEEKLY_WEEKS - 1, -1, -1)]
    by_week = {r["grp"]: r for r in rows if r["grp"] is not None}
    out = []
    for monday in weeks:
        r = by_week.get(monday, {"k": 0, "n": 0})
        out.append(_cut_row(g, monday.isoformat(), r["k"], r["n"]))
    return out


def _by_build(g: dict, rows: list[dict]) -> list[dict]:
    builds = sorted((r for r in rows if r["grp"] is not None), key=lambda r: -int(r["grp"]))[:C.BUILDS_SHOWN]
    return [_cut_row(g, int(r["grp"]), r["k"], r["n"]) for r in builds]


def _by_platform(g: dict, rows: list[dict]) -> list[dict]:
    order = {"mobile": 0, "desktop": 1, "unknown": 2}
    return [_cut_row(g, r["grp"], r["k"], r["n"]) for r in sorted(rows, key=lambda r: order.get(r["grp"], 9))]


def _by_country(g: dict, rows: list[dict]) -> list[dict]:
    known = sorted((r for r in rows if r["grp"] != "unknown"), key=lambda r: (-r["n"], r["grp"]))[:C.COUNTRIES_SHOWN]
    unknown = [r for r in rows if r["grp"] == "unknown"]
    return [_cut_row(g, r["grp"], r["k"], r["n"]) for r in known + unknown]


def build_gate_diagnosis(cur, excl: str, now: datetime, key: str) -> dict[str, Any]:
    """Cuts for one gate's Diagnose drawer. KeyError for a gate without one (`has_diagnosis`:
    unknown key, Tier A, kind none, NO_DIAGNOSIS_GATES); the route validates before calling."""
    if not has_diagnosis(key):
        raise KeyError(key)
    g = C.GATE_BY_KEY[key]
    today = now.date()
    mature_lo, mature_hi = _mature_window()
    cohort = {
        "signup_to_export_14d": lambda cut: _gate2_rows(cur, excl, today, lo_days=mature_lo, hi_days=mature_hi, cut=cut),
        "finished_to_took_away": lambda cut: _gate4_rows(cur, excl, today, lo_days=mature_lo, hi_days=mature_hi, cut=cut),
        "upload_failure": lambda cut: _gate3_rows(cur, excl, today, days=C.COHORT_DAYS, cut=cut),
        "payers_per_100": lambda cut: _gate6_rows(cur, excl, today, lo_days=C.COHORT_DAYS, hi_days=0, cut=cut),
        "k_factor": lambda cut: _gate9_rows(cur, excl, today, lo_days=C.COHORT_DAYS, hi_days=0, cut=cut),
    }
    # Weekly reads use the gate's own window for cohort gates; the weeks beyond it are zero.
    if key == "revenue_per_payer":
        weekly = [{"group": r["grp"].isoformat(), "n": r["n"], "k": None, "value": None if r["mean"] is None else round(r["mean"], 2),
                   "interval": None, "rag": "grey" if r["n"] < C.SMALL_N_FLOOR else rag_for(r["mean"], g["green"], g["yellow"], g["direction"]),
                   "confidence": None, "text": f"{r['n']} payers"} for r in _gate7(cur, excl, now, cut="weekly") if r["grp"] is not None]
        return {"key": key, "tier": g["tier"], "computed_at": now.isoformat(), "cuts": {"weekly": sorted(weekly, key=lambda r: r["group"])}}
    reader = cohort[key]
    cuts: dict[str, list] = {"weekly": _weekly(g, reader("weekly"), today)}
    if g["tier"] == "B":
        cuts["by_build"] = _by_build(g, reader("by_build"))
        cuts["by_platform"] = _by_platform(g, reader("by_platform"))
        cuts["by_country"] = _by_country(g, reader("by_country"))
    return {"key": key, "tier": g["tier"], "computed_at": now.isoformat(), "cuts": cuts}
