"""T8620: append-only payments ledger — the local, pseudonymous, per-payment
financial record (purchase/refund/dispute_lost). Stripe remains the source of
truth for money; this table is a reconcilable mirror that outlives account
deletion (no FK to ``users``).

Sole writer of the ``payments`` table. Every helper here takes an ALREADY-OPEN
cursor so the ledger insert joins the caller's transaction (same pattern as
``analytics.add_usage_seconds``) — the caller decides the transaction boundary
(see ``payments.py`` call sites: one ``get_pg()`` block per money event, ledger
insert + conditional ``bump_total_spent`` committing/rolling back together).

Append-only by construction (design §3, ruling 2): the only writes issued here
are INSERTs with ``ON CONFLICT (stripe_object_id, kind) DO NOTHING``, plus
exactly ONE whitelisted metadata-only UPDATE (``fill_missing_charge_id`` — the
second of the two permitted in-place writes in the whole codebase, the first
being T8630's future ``account_deleted_at`` stamp). Nothing here ever UPDATEs
``amount_cents``/``kind``/``stripe_object_id``/``user_id``/``occurred_at``, and
nothing DELETEs a row.
"""

import logging
from enum import Enum

logger = logging.getLogger(__name__)


class PaymentKind(str, Enum):
    """Closed vocabulary for `payments.kind` (design §2)."""

    PURCHASE = "purchase"
    REFUND = "refund"
    DISPUTE_LOST = "dispute_lost"
    DISPUTE_WON = "dispute_won"  # reserved; never written in T8620 (design §2b)


class PaymentSource(str, Enum):
    """Closed vocabulary for `payments.source` (design §2)."""

    CONFIRM_INTENT = "confirm_intent"
    WEBHOOK = "webhook"
    VERIFY = "verify"
    BACKFILL = "backfill"


def _insert_payment_row(
    cur,
    *,
    user_id: str,
    kind: str,
    amount_cents: int,
    currency: str,
    stripe_object_id: str,
    stripe_charge_id: str | None,
    pack: str | None,
    credits: int | None,
    occurred_at,
    source: str,
) -> bool:
    """One INSERT ... ON CONFLICT (stripe_object_id, kind) DO NOTHING.

    Returns True if a row was newly inserted, False if the unique key already
    existed (a redelivery / repeat observation — a SUCCESSFUL no-op, design §4).

    Validates `kind`/`source` against their closed vocabularies (type-safety)
    even though every current call site already passes a `PaymentKind`/
    `PaymentSource` value — this is the single choke point every `record_*`
    helper (and the backfill script) routes through, so a typo'd literal at a
    future call site fails loudly here instead of inserting silently.
    """
    PaymentKind(kind)
    PaymentSource(source)
    cur.execute(
        """
        INSERT INTO payments (
            user_id, kind, amount_cents, currency, stripe_object_id,
            stripe_charge_id, pack, credits, occurred_at, source
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (stripe_object_id, kind) DO NOTHING
        """,
        (
            user_id,
            kind,
            amount_cents,
            currency,
            stripe_object_id,
            stripe_charge_id,
            pack,
            credits,
            occurred_at,
            source,
        ),
    )
    return cur.rowcount == 1


def record_purchase(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,  # pi_...
    amount_cents: int,  # > 0, Stripe-captured
    currency: str,
    stripe_charge_id: str | None,
    pack: str | None,
    credits: int | None,
    occurred_at,
    source: str,
) -> bool:
    """Insert a `purchase` ledger row. Returns True if newly inserted."""
    return _insert_payment_row(
        cur,
        user_id=user_id,
        kind=PaymentKind.PURCHASE.value,
        amount_cents=amount_cents,
        currency=currency,
        stripe_object_id=stripe_object_id,
        stripe_charge_id=stripe_charge_id,
        pack=pack,
        credits=credits,
        occurred_at=occurred_at,
        source=source,
    )


def record_refund(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,  # re_...
    amount_cents: int,  # < 0
    currency: str,
    stripe_charge_id: str | None,
    occurred_at,
    source: str,
) -> bool:
    """Insert a `refund` ledger row. Returns True if newly inserted."""
    return _insert_payment_row(
        cur,
        user_id=user_id,
        kind=PaymentKind.REFUND.value,
        amount_cents=amount_cents,
        currency=currency,
        stripe_object_id=stripe_object_id,
        stripe_charge_id=stripe_charge_id,
        pack=None,
        credits=None,
        occurred_at=occurred_at,
        source=source,
    )


def record_dispute_lost(
    cur,
    *,
    user_id: str,
    stripe_object_id: str,  # dp_...
    amount_cents: int,  # < 0
    currency: str,
    stripe_charge_id: str | None,
    occurred_at,
    source: str = PaymentSource.BACKFILL.value,
) -> bool:
    """Insert a `dispute_lost` ledger row. Backfill-only in T8620 (design §2b) —
    no live dispute webhook exists yet. Returns True if newly inserted."""
    return _insert_payment_row(
        cur,
        user_id=user_id,
        kind=PaymentKind.DISPUTE_LOST.value,
        amount_cents=amount_cents,
        currency=currency,
        stripe_object_id=stripe_object_id,
        stripe_charge_id=stripe_charge_id,
        pack=None,
        credits=None,
        occurred_at=occurred_at,
        source=source,
    )


def bump_total_spent(cur, user_id: str, amount_cents: int) -> None:
    """Cursor-taking `total_spent_cents` cache bump (design §6).

    The surviving body of the old `increment_total_spent`/`decrement_total_spent`
    free functions, unified into one sign-agnostic helper that joins the
    caller's open transaction. MUST be called ONLY when the caller's
    `record_purchase`/`record_refund`/`record_dispute_lost` call just returned
    True (a newly inserted row) — never on a False/no-op, and never
    standalone. A positive `amount_cents` increments; a negative decrements
    with the existing floor-at-0 + warning behavior.

    Never raises — a missing `user_segments` row (a payer with no segment row,
    or T8620's pseudonymous post-deletion tombstone) logs CRITICAL and leaves
    the cache untouched; the `payments` row is the durable record regardless
    (ruling 3).
    """
    if amount_cents >= 0:
        cur.execute(
            "UPDATE user_segments SET total_spent_cents = total_spent_cents + %s WHERE user_id = %s",
            (amount_cents, user_id),
        )
        if cur.rowcount == 0:
            logger.critical(
                "[Payments] bump_total_spent matched no user_segments row: user=%s "
                "amount_cents=%s — payment recorded in payments ledger, cache not updated",
                user_id, amount_cents,
            )
            return
        logger.info(
            "[Payments] bump_total_spent incremented: user=%s amount_cents=%s",
            user_id, amount_cents,
        )
        return

    # Negative amount_cents: decrement, flooring at 0 (decrement_total_spent's
    # existing behavior, design §6).
    cur.execute(
        "SELECT total_spent_cents FROM user_segments WHERE user_id = %s",
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        logger.critical(
            "[Payments] bump_total_spent matched no user_segments row: user=%s "
            "amount_cents=%s — payment recorded in payments ledger, cache not updated",
            user_id, amount_cents,
        )
        return

    current = row["total_spent_cents"] or 0
    new_value = current + amount_cents  # amount_cents is negative here
    if new_value < 0:
        logger.warning(
            "[Payments] Refund exceeds recorded spend for %s (current=%s amount_cents=%s) — flooring to 0",
            user_id, current, amount_cents,
        )
        new_value = 0
    cur.execute(
        "UPDATE user_segments SET total_spent_cents = %s WHERE user_id = %s",
        (new_value, user_id),
    )
    logger.info(
        "[Payments] bump_total_spent decremented: user=%s amount_cents=%s new=%s",
        user_id, amount_cents, new_value,
    )


def fill_missing_charge_id(cur, *, stripe_object_id: str, stripe_charge_id: str) -> bool:
    """The SOLE UPDATE statement against `payments` anywhere in the codebase
    (design §4a/§3 ruling 2 — the second of exactly two permitted in-place
    writes). Fills `stripe_charge_id` on a purchase row only when it is
    currently NULL, so it is naturally idempotent and syntactically incapable
    of touching any other column. Returns True if it changed a row.
    """
    cur.execute(
        """
        UPDATE payments SET stripe_charge_id = %s
        WHERE stripe_object_id = %s AND kind = 'purchase' AND stripe_charge_id IS NULL
        """,
        (stripe_charge_id, stripe_object_id),
    )
    return cur.rowcount == 1


def fill_missing_charge_id_background(pi_id: str) -> None:
    """Background entry point for the async `stripe_charge_id` fill (design
    §4a, ruling 5). Scheduled AFTER the ledger row's transaction has committed
    — never inside it, so it can never delay or fail the payment response.

    Retrieves the PaymentIntent's `latest_charge` id from Stripe and runs the
    single whitelisted `fill_missing_charge_id` UPDATE in its own `get_pg()`
    block. The WHOLE block is wrapped in try/except: any exception (Stripe
    error, DB error, timeout) is logged and swallowed — never raises, never
    retries, never touches any other column.
    """
    try:
        import stripe

        from .pg import get_pg

        intent = stripe.PaymentIntent.retrieve(pi_id, expand=["latest_charge"])
        charge = intent.get("latest_charge") if isinstance(intent, dict) else intent.latest_charge
        if not charge:
            logger.warning("[Payments] fill_missing_charge_id_background: no latest_charge for pi=%s", pi_id)
            return
        charge_id = charge.get("id") if isinstance(charge, dict) else charge.id
        if not charge_id:
            logger.warning("[Payments] fill_missing_charge_id_background: latest_charge has no id for pi=%s", pi_id)
            return

        with get_pg() as conn:
            cur = conn.cursor()
            changed = fill_missing_charge_id(cur, stripe_object_id=pi_id, stripe_charge_id=charge_id)
        logger.info(
            "[Payments] fill_missing_charge_id_background: pi=%s charge_id=%s changed=%s",
            pi_id, charge_id, changed,
        )
    except Exception:
        logger.warning(
            "[Payments] fill_missing_charge_id_background failed for pi=%s (non-fatal, "
            "backfill will catch it later)", pi_id, exc_info=True,
        )


async def schedule_charge_id_fill(pi_id: str, background_tasks=None) -> None:
    """Schedule the background charge-id fill using whichever post-response
    mechanism the call site has wired (design §4a): FastAPI `BackgroundTasks`
    when the handler has one in scope, otherwise the codebase's existing
    `poster_warmer.fire_and_forget` fire-and-forget idiom for handlers with no
    `BackgroundTasks` parameter (the webhook endpoint).
    """
    if background_tasks is not None:
        background_tasks.add_task(fill_missing_charge_id_background, pi_id)
        return

    from .poster_warmer import fire_and_forget
    from ..utils.offload import run_in_context

    async def _run():
        await run_in_context(fill_missing_charge_id_background, pi_id)

    fire_and_forget(_run())
