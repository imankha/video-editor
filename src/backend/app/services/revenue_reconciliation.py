"""Stripe revenue reconciliation (T5760).

Stripe is the source of truth for money. ``user_segments.total_spent_cents`` is a
local cache written at fulfillment time so admin views don't pay Stripe API latency
per page load. Nothing ever checked the two agree, and they drift (refunds, lost
disputes, pre-go-live test-mode noise). This module reconciles them: it builds
per-user Stripe NET revenue and classifies why any local value drifts from it.

``total_spent_cents`` means NET of refunds AND lost disputes/chargebacks — "what the
user actually paid us and we kept" — matching Stripe's own Revenue Recognition
standard (revenue reported net of both contra-revenue accounts).

Design: everything except ``fetch_stripe_intents`` is a PURE function over
already-fetched data, so the whole classifier is unit-testable with mocked Stripe
responses (the container has no live key). Stripe objects (``StripeObject``) subclass
dict, so the pure helpers read every field with ``.get`` and work identically on the
plain-dict fixtures used in tests.
"""

import logging
from datetime import date
from enum import Enum

import stripe

logger = logging.getLogger(__name__)

# Live-mode Stripe go-live (T4940 Workstream C, 2026-07-22). Local spend with zero
# live history must have come from the test-mode era before this date.
GO_LIVE_DATE = date(2026, 7, 22)

# Dispute statuses where funds have been withdrawn from us — subtract from net.
LOST_DISPUTE_STATUSES = frozenset({"lost", "charge_refunded"})
# A dispute we won: funds were NOT withdrawn, never subtract, not pending.
WON_DISPUTE_STATUSES = frozenset({"won"})


class DriftCause(str, Enum):
    ALIGNED = "aligned"          # local == Stripe net (no drift)
    REFUND = "refund"            # merchant refund lowered Stripe net below local
    DISPUTE = "dispute"          # a lost dispute/chargeback lowered Stripe net
    TEST_MODE_ERA = "test_mode_era"  # local > 0 but zero live history (pre-go-live)
    UNKNOWN = "unknown"          # drift with no refund/dispute/zero-history explanation


def _charge_of(intent: dict) -> dict | None:
    """Return the expanded latest_charge, or None if unexpanded/absent.

    When ``expand=['data.latest_charge']`` is passed, ``latest_charge`` is the full
    charge object; without it, it's a bare id string we can't read amounts from.
    """
    charge = intent.get("latest_charge")
    if not charge or isinstance(charge, str):
        return None
    return charge


def _dispute_amounts(charge: dict | None) -> tuple[int, bool]:
    """Return (lost_dispute_cents, has_pending_dispute) for a charge.

    Disputes are separate from refunds. Subtract the disputed amount ONLY when the
    dispute is LOST/withdrawn; won disputes are never subtracted; open ones are
    surfaced as pending (the on-demand pass is the safety net for them).
    """
    if not charge:
        return 0, False
    dispute = charge.get("dispute")
    if not dispute or isinstance(dispute, str):
        # Not expanded (or none). The charge.disputed bool still hints "pending".
        return 0, bool(charge.get("disputed"))
    status = dispute.get("status")
    amount = dispute.get("amount", 0) or 0
    if status in LOST_DISPUTE_STATUSES:
        return amount, False
    if status in WON_DISPUTE_STATUSES:
        return 0, False
    # Anything else is still in flight — surface as pending, do not subtract.
    return 0, True


def build_stripe_net_by_user(intents: list) -> dict:
    """Aggregate succeeded live PaymentIntents into per-user Stripe truth.

    Groups by ``metadata.user_id`` (every PI we create carries it; customers were
    wiped/recreated by user_db v007, so never group by customer id). Per user:
    ``net = Σ (amount_captured - amount_refunded - lost_dispute_amount)``.
    """
    agg: dict[str, dict] = {}
    for intent in intents:
        # PaymentIntent.list has no server-side status filter, so filter here.
        if intent.get("status") != "succeeded":
            continue
        meta = intent.get("metadata") or {}
        user_id = meta.get("user_id")
        if not user_id:
            logger.warning("[Reconcile] Succeeded PI without metadata.user_id: %s", intent.get("id"))
            continue

        charge = _charge_of(intent)
        captured = (charge.get("amount_captured", 0) if charge else intent.get("amount_received", 0)) or 0
        refunded = (charge.get("amount_refunded", 0) if charge else 0) or 0
        lost_dispute_raw, pending_dispute = _dispute_amounts(charge)
        # A dispute resolved by refunding the charge (status ``charge_refunded``) sets
        # BOTH ``amount_refunded`` and the dispute amount for the SAME money leaving us.
        # Net the dispute against the refund so that money is subtracted once, not
        # twice. A genuine lost dispute (funds withdrawn directly, no refund) has
        # ``refunded == 0`` so the full dispute amount still subtracts.
        lost_dispute = max(lost_dispute_raw - refunded, 0)

        rec = agg.setdefault(user_id, {
            "gross_cents": 0,
            "refunded_cents": 0,
            "disputed_lost_cents": 0,
            "net_cents": 0,
            "pi_count": 0,
            "has_pending_dispute": False,
            "latest_created": 0,
        })
        rec["gross_cents"] += captured
        rec["refunded_cents"] += refunded
        rec["disputed_lost_cents"] += lost_dispute
        rec["net_cents"] += captured - refunded - lost_dispute
        rec["pi_count"] += 1
        rec["has_pending_dispute"] = rec["has_pending_dispute"] or pending_dispute
        rec["latest_created"] = max(rec["latest_created"], intent.get("created") or 0)
    return agg


def _classify_cause(delta_cents: int, local_cents: int, pi_count: int,
                    refunded_cents: int, disputed_lost_cents: int) -> DriftCause:
    """Classify why local drifts from Stripe net. Pure over aggregated numbers.

    Priority: aligned -> test_mode_era (zero live history) -> dispute -> refund ->
    unknown. test_mode_era wins over refund/dispute because zero live history means
    the local value can only be pre-go-live test-mode noise regardless of anything
    else.
    """
    if delta_cents == 0:
        return DriftCause.ALIGNED
    if pi_count == 0 and local_cents > 0:
        return DriftCause.TEST_MODE_ERA
    if disputed_lost_cents > 0:
        return DriftCause.DISPUTE
    if refunded_cents > 0:
        return DriftCause.REFUND
    return DriftCause.UNKNOWN


def classify_users(local_by_user: dict, stripe_agg: dict) -> list[dict]:
    """Build per-user reconciliation rows. Pure over fetched data.

    ``local_by_user``: ``{user_id: {"email": str|None, "local_cents": int}}``.
    ``stripe_agg``: output of :func:`build_stripe_net_by_user`.
    Covers the union of both key sets; ``delta = local - stripe_net`` (positive = the
    local cache is too high, the common case).
    """
    rows = []
    for uid in set(local_by_user) | set(stripe_agg):
        local = local_by_user.get(uid, {})
        local_cents = local.get("local_cents", 0)
        s = stripe_agg.get(uid, {})
        stripe_net = s.get("net_cents", 0)
        pi_count = s.get("pi_count", 0)
        refunded = s.get("refunded_cents", 0)
        disputed_lost = s.get("disputed_lost_cents", 0)
        delta = local_cents - stripe_net
        cause = _classify_cause(delta, local_cents, pi_count, refunded, disputed_lost)
        rows.append({
            "user_id": uid,
            "email": local.get("email"),
            "local_cents": local_cents,
            "stripe_net_cents": stripe_net,
            "stripe_gross_cents": s.get("gross_cents", 0),
            "refunded_cents": refunded,
            "disputed_lost_cents": disputed_lost,
            "delta_cents": delta,
            "cause": cause.value,
            "pi_count": pi_count,
            "has_pending_dispute": s.get("has_pending_dispute", False),
            "drifted": delta != 0,
        })
    # Drifted first, largest absolute drift on top; aligned rows after.
    rows.sort(key=lambda r: (not r["drifted"], -abs(r["delta_cents"])))
    return rows


def fetch_stripe_intents(limit: int = 100) -> list:
    """Paginate live-mode PaymentIntents, expanding latest_charge + its dispute.

    Auto-pagination via ``auto_paging_iter``. Expanding ``data.latest_charge`` (and
    its ``dispute``) avoids an N+1 per PI. Volume is tiny (~a handful of PIs) but we
    still paginate correctly. NOT pure — the only network touch in this module.
    """
    intents: list = []
    listing = stripe.PaymentIntent.list(
        limit=limit,
        expand=["data.latest_charge", "data.latest_charge.dispute"],
    )
    for pi in listing.auto_paging_iter():
        intents.append(pi)
    return intents
