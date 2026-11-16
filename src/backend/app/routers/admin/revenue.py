"""Admin Stripe revenue reconciliation (T5760): the report and the heal action.

Split out of routers/admin.py by T5940; every URL is unchanged."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...services.pg import get_pg
from . import _deletions_for, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# T5760: Stripe revenue reconciliation (Stripe as source of truth for money)
#
# On-demand only — NEVER on the main user-table load path (list_users makes zero
# Stripe calls). total_spent_cents is a local cache for admin speed; this compares
# it against per-user Stripe NET revenue (net of refunds AND lost disputes) and
# offers an explicit heal gesture. No new table — computed on demand.
# ---------------------------------------------------------------------------


def _load_local_spent_positive() -> dict:
    """user_id -> {email, local_cents, account_exists} for every LIVE account whose
    local spend is > 0.

    T8640: the test-account filter is NO LONGER applied in SQL here. It is resolved
    ONCE per request (`_excluded_test_user_ids`) and applied symmetrically to BOTH
    the local map and the Stripe aggregate in `_compute_reconciliation`, so a flagged
    account can never be dropped from one side while surviving on the other (the
    imankh phantom-drift incident). `JOIN users` (inner) keeps this to live accounts;
    a deleted payer has no `users` row and gets its local truth from the ledger
    instead (see `_compute_reconciliation`)."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT u.user_id, u.email, s.total_spent_cents AS cents
            FROM user_segments s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.total_spent_cents > 0
        """)
        return {
            r["user_id"]: {"email": r["email"], "local_cents": r["cents"] or 0,
                           "account_exists": True}
            for r in cur.fetchall()
        }


def _excluded_test_user_ids() -> set:
    """T8640: the set of user_ids the test-account filter hides, resolved ONCE and
    applied identically to the local map, the Stripe aggregate, and email lookup.

    Faithful to the `_test_exclusion` COALESCE(u.is_test_account, s.was_test_account,
    false) semantics: a live flagged account (users.is_test_account) OR a deleted one
    whose de-identified user_segments snapshot carries was_test_account. The second
    arm catches a live test user with no segment row."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT s.user_id FROM user_segments s
            LEFT JOIN users u ON u.user_id = s.user_id
            WHERE COALESCE(u.is_test_account, s.was_test_account, false)
            UNION
            SELECT user_id FROM users WHERE is_test_account
        """)
        return {r["user_id"] for r in cur.fetchall()}


def _ledger_sum_for(user_ids: list) -> dict:
    """user_id -> SUM(payments.amount_cents) for the given ids (ledger net, signed).

    T8640 option 1: a deleted payer's local truth is the append-only ledger, which the
    T8620 backfill made equal to the Stripe net — so the row reconciles by
    construction instead of showing a bare 0 against Stripe."""
    if not user_ids:
        return {}
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT user_id, COALESCE(SUM(amount_cents), 0) AS cents "
            "FROM payments WHERE user_id = ANY(%s) GROUP BY user_id",
            (user_ids,),
        )
        return {r["user_id"]: r["cents"] for r in cur.fetchall()}


def _emails_for(user_ids: list[str]) -> dict:
    if not user_ids:
        return {}
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, email FROM users WHERE user_id = ANY(%s)", (user_ids,))
        return {r["user_id"]: r["email"] for r in cur.fetchall()}


def _compute_reconciliation(exclude_test: bool = True) -> tuple[list, dict]:
    """Return (rows, stripe_agg). Fetches Stripe once; pure classification after.

    Covers only users with local spend > 0 OR live Stripe history — aligned rows for
    the whole user base would be noise.

    T8640:
    - A LIVE account's local truth is its `total_spent_cents` cache (this panel audits
      that cache against Stripe). A DELETED payer (no `users` row) has no cache to
      audit, so its local truth is the ledger sum — usually == Stripe net, so the row
      is aligned and drops off the drift view (option 1).
    - The test-account exclusion is resolved ONCE and applied to BOTH sides, so a
      flagged account is either absent from both or aligned across both — never a
      one-sided phantom.
    - id-only (deleted) rows carry `deleted_at` from account_deletions (Decision D).
    """
    from ...services.revenue_reconciliation import (
        build_stripe_net_by_user,
        classify_users,
        fetch_stripe_intents,
    )

    stripe_agg = build_stripe_net_by_user(fetch_stripe_intents())
    local = _load_local_spent_positive()

    stripe_only = [uid for uid in stripe_agg if uid not in local]
    if stripe_only:
        emails = _emails_for(stripe_only)
        # No `users` row -> deleted payer: local truth comes from the ledger.
        deleted_only = [uid for uid in stripe_only if uid not in emails]
        ledger_sums = _ledger_sum_for(deleted_only)
        for uid in stripe_only:
            exists = uid in emails
            local[uid] = {
                "email": emails.get(uid),
                "local_cents": 0 if exists else ledger_sums.get(uid, 0),
                "account_exists": exists,
            }

    # Symmetric test-account exclusion: resolve once, apply to BOTH maps.
    if exclude_test:
        excluded = _excluded_test_user_ids()
        if excluded:
            local = {k: v for k, v in local.items() if k not in excluded}
            stripe_agg = {k: v for k, v in stripe_agg.items() if k not in excluded}

    rows = classify_users(local, stripe_agg)

    # Decision D: attach deletion context to id-only (deleted-account) rows.
    missing_account = [r["user_id"] for r in rows if not r.get("account_exists", True)]
    deletions = _deletions_for(missing_account)
    for r in rows:
        deleted_at = deletions.get(r["user_id"])
        r["deleted_at"] = deleted_at.date().isoformat() if deleted_at else None

    return rows, stripe_agg


def _require_stripe_configured():
    import stripe
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")


@router.get("/revenue-reconciliation")
async def revenue_reconciliation(exclude_test: bool = True):
    """Per-user local vs Stripe-net revenue with delta + cause. Admin only, on-demand.

    T8640: honours the SAME test-account filter the rest of the admin panel uses
    (`exclude_test`, default ON like `list_users`), applied symmetrically to both the
    local and the Stripe side."""
    _require_stripe_configured()

    from ...services.revenue_reconciliation import GO_LIVE_DATE

    rows, _ = _compute_reconciliation(exclude_test)
    drifted = [r for r in rows if r["drifted"]]
    summary = {
        "total_users": len(rows),
        "drifted_users": len(drifted),
        "aligned_users": len(rows) - len(drifted),
        "total_local_cents": sum(r["local_cents"] for r in rows),
        "total_stripe_net_cents": sum(r["stripe_net_cents"] for r in rows),
        "total_delta_cents": sum(r["delta_cents"] for r in rows),
    }
    return {
        "rows": rows,
        "summary": summary,
        "go_live_date": GO_LIVE_DATE.isoformat(),
    }


class RevenueHealRequest(BaseModel):
    user_ids: list[str] | None = None
    all_drifted: bool = False
    exclude_test: bool = True


@router.post("/revenue-reconciliation/heal")
async def heal_revenue_reconciliation(request: RevenueHealRequest):
    """Adopt the Stripe net figure into total_spent_cents. Explicit admin gesture.

    Recomputes Stripe truth server-side (never trusts a client-supplied amount) and
    sets each target user's total_spent_cents to their Stripe net (net of refunds and
    lost disputes). ``all_drifted`` heals every drifted user; otherwise heals the
    given ``user_ids``.

    T8640: an ``account_deleted`` row has no local cache to write (its truth is the
    append-only ledger). ``set_total_spent`` must NOT be attempted for it — doing so
    would either return None (permanent-red) or write a de-identified deleted
    account's cache pointlessly. Such a row is skipped with an explicit reason and
    ``healed: False`` so the panel never reports a success that changed nothing.

    A row that is not ``drifted`` (never drifted, or another writer already caught
    it up since this report was generated) is skipped too, for the same reason:
    writing a freshly-fetched Stripe net back over an already-correct cache can
    silently clobber a newer value the row doesn't yet reflect, and reporting
    ``healed: True`` for a write that changed nothing is exactly the lie this
    endpoint exists to stop telling.
    """
    _require_stripe_configured()

    from ...analytics import set_total_spent
    from ...services.revenue_reconciliation import DriftCause

    rows, stripe_agg = _compute_reconciliation(request.exclude_test)
    row_by_uid = {r["user_id"]: r for r in rows}

    if request.all_drifted:
        targets = [r["user_id"] for r in rows if r["drifted"]]
    elif request.user_ids:
        targets = request.user_ids
    else:
        raise HTTPException(status_code=400, detail="Provide user_ids or all_drifted")

    results = []
    for uid in targets:
        # Only heal users present in the freshly recomputed report. A user_id the
        # client sends that isn't in the report (never had local spend or live
        # Stripe history) would otherwise be silently zeroed — skip it instead.
        if uid not in row_by_uid:
            results.append({"user_id": uid, "skipped": "not in report", "healed": False})
            continue
        if row_by_uid[uid]["cause"] == DriftCause.ACCOUNT_DELETED.value:
            results.append({
                "user_id": uid,
                "skipped": "account deleted; reconciled from ledger",
                "healed": False,
            })
            continue
        if not row_by_uid[uid]["drifted"]:
            results.append({
                "user_id": uid,
                "skipped": "already aligned",
                "healed": False,
                "old_cents": row_by_uid[uid]["local_cents"],
                "new_cents": row_by_uid[uid]["stripe_net_cents"],
            })
            continue
        net_cents = stripe_agg.get(uid, {}).get("net_cents", 0)
        old_cents = set_total_spent(uid, net_cents)
        results.append({
            "user_id": uid,
            "old_cents": old_cents,
            "new_cents": net_cents,
            "healed": old_cents is not None,
        })

    return {"results": results, "healed": sum(1 for r in results if r["healed"])}
