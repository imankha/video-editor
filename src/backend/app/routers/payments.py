"""
Payments Router - Stripe Checkout + Payment Element endpoints (T525, T526).

Provides:
- POST /payments/checkout — Create Stripe Checkout Session (legacy redirect flow)
- POST /payments/create-intent — Create PaymentIntent for inline Payment Element (T526)
- POST /payments/confirm-intent — Verify PaymentIntent and grant credits (T526)
- POST /payments/webhook — Stripe webhook to fulfill credit grants (fallback)
- POST /payments/verify — Verify Checkout Session after redirect (legacy)

Credit packs come from app/pricing.json via app.pricing.CREDIT_PACKS (single source, T10210).
"""

import logging
import os
from datetime import UTC, datetime

import stripe
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from ..analytics import record_milestone
from ..pricing import CREDIT_PACKS
from ..services import payments_ledger
from ..services.auth_db import get_user_by_id
from ..services.credit_ledger import CreditsUnavailable, credit_key, grant, has_processed_payment
from ..services.pg import get_pg
from ..services.user_db import get_stripe_customer_id, set_stripe_customer_id
from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)


def _grant_or_503(user_id: str, amount: int, source: str, reference_id: str) -> dict:
    """Grant credits idempotently, returning grant()'s {applied, balance} dict.

    grant() is idempotent (never raises on a retry) -- the only exception left
    to handle is the credits_ready cutover gate, which maps to a retryable 503
    (Stripe/the frontend both retry on 5xx, so the window fails loudly, never
    wrongly -- design 4a).

    Callers MUST gate milestone analytics (record_milestone) on the returned
    `applied`. The `has_processed_payment`
    guard above every call site is a plain UNLOCKED read: two concurrent
    deliveries of the same Stripe event (redelivery, or webhook racing
    /confirm-intent) can both pass it. grant() refuses the second credit
    atomically (applied=False), but the analytics run AFTER the read -- so
    without this gate they run twice and double-count `total_spent_cents`, which
    T5760 reconciliation reads as a false `revenue_drift` and "heals" in the
    wrong direction. Master short-circuited these paths on
    `sqlite3.IntegrityError` BEFORE recording analytics; this gate restores that
    property post-cutover."""
    key = credit_key(source, reference_id)
    try:
        return grant(user_id, amount, source, key, reference_id=reference_id)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None

def _record_purchase_ledger(
    *, user_id, stripe_object_id, amount_cents, currency, stripe_charge_id,
    pack, credits, occurred_at, source, reraise: bool,
):
    """Ledger insert + conditional cache bump in ONE `get_pg()` transaction
    (design §4). Runs on EVERY observation of a succeeded/paid payment — NOT
    gated on `result["applied"]`; the unique (stripe_object_id, kind) key makes
    a redelivery a safe no-op. `reraise` selects the site-type failure mode
    (design §5, ruling 4c): True for webhook sites (so Stripe redelivers),
    False for user-facing sites (which must swallow so the payer still sees
    success).
    """
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            inserted = payments_ledger.record_purchase(
                cur, user_id=user_id, stripe_object_id=stripe_object_id,
                amount_cents=amount_cents, currency=currency,
                stripe_charge_id=stripe_charge_id, pack=pack, credits=credits,
                occurred_at=occurred_at, source=source,
            )
            if inserted:
                payments_ledger.bump_total_spent(cur, user_id, amount_cents)
        return inserted
    except Exception:
        logger.critical(
            "[Payments] Ledger insert failed for purchase pi=%s user=%s amount_cents=%s "
            "source=%s", stripe_object_id, user_id, amount_cents, source, exc_info=True,
        )
        if reraise:
            raise
        return False


def _record_refund_ledger(
    *, user_id, stripe_object_id, amount_cents, currency, stripe_charge_id,
    occurred_at, source, reraise: bool,
):
    """Refund counterpart to `_record_purchase_ledger` (design §4)."""
    try:
        with get_pg() as conn:
            cur = conn.cursor()
            inserted = payments_ledger.record_refund(
                cur, user_id=user_id, stripe_object_id=stripe_object_id,
                amount_cents=amount_cents, currency=currency,
                stripe_charge_id=stripe_charge_id, occurred_at=occurred_at,
                source=source,
            )
            if inserted:
                payments_ledger.bump_total_spent(cur, user_id, amount_cents)
        return inserted
    except Exception:
        logger.critical(
            "[Payments] Ledger insert failed for refund re=%s user=%s amount_cents=%s "
            "source=%s", stripe_object_id, user_id, amount_cents, source, exc_info=True,
        )
        if reraise:
            raise
        return False


router = APIRouter(prefix="/payments", tags=["payments"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# Frontend URL for redirect after checkout
# In dev: localhost:5173, in staging/prod: from CORS_ORIGINS
_cors = os.getenv("CORS_ORIGINS", "")
FRONTEND_URL = _cors.split(",")[0].strip() if _cors else "http://localhost:5173"

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY
    logger.info(f"[Payments] Stripe configured: SK={STRIPE_SECRET_KEY[:20]}... PK={STRIPE_PUBLISHABLE_KEY[:20]}...")

# ---------------------------------------------------------------------------
# Public config endpoint (no auth required — publishable key is public)
# ---------------------------------------------------------------------------


@router.get("/config")
async def get_payment_config():
    """Return Stripe publishable key + credit packs for the frontend.

    T4940: packs are single-sourced from CREDIT_PACKS here so the buy modal
    renders backend truth — there is no parallel frontend pricing table.
    """
    packs = [
        {
            "key": key,
            "credits": pack["credits"],
            "price_cents": pack["price_cents"],
            "name": pack["name"],
        }
        for key, pack in CREDIT_PACKS.items()
    ]
    return {"publishable_key": STRIPE_PUBLISHABLE_KEY, "packs": packs}


# ---------------------------------------------------------------------------
# Stripe customer helpers
# ---------------------------------------------------------------------------


def _get_or_create_customer(user_id: str) -> str:
    """Return the user's Stripe customer id, creating one if none is stored."""
    customer_id = get_stripe_customer_id(user_id)
    if not customer_id:
        customer = stripe.Customer.create(metadata={"user_id": user_id})
        customer_id = customer.id
        set_stripe_customer_id(user_id, customer_id)
    return customer_id


def _receipt_email_for(user_id: str) -> str | None:
    """Look up the user's account email server-side for Stripe's receipt_email.

    Never sourced from the client -- a client-supplied email could redirect a
    payment receipt (and the identity trail it carries) to an address the
    payer doesn't control.
    """
    user = get_user_by_id(user_id)
    if not user:
        # users.email is NOT NULL and sessions FK-reference users, so an
        # authenticated request with no users row should be unreachable in
        # prod (dev X-User-ID bypass aside). Log it -- this silently produces
        # exactly the receipt-less charge this task exists to prevent.
        logger.warning(f"[Payments] No users row for {user_id}; PaymentIntent will have no receipt_email")
        return None
    return user["email"]


# ---------------------------------------------------------------------------
# Checkout endpoint
# ---------------------------------------------------------------------------


class CheckoutRequest(BaseModel):
    pack: str


@router.post("/checkout")
async def create_checkout(request: CheckoutRequest):
    """Create a Stripe Checkout Session for a credit pack purchase."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured")

    pack = CREDIT_PACKS.get(request.pack)
    if not pack:
        raise HTTPException(status_code=400, detail=f"Invalid pack: {request.pack}")

    user_id = get_current_user_id()
    customer_id = _get_or_create_customer(user_id)
    receipt_email = _receipt_email_for(user_id)

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "unit_amount": pack["price_cents"],
                    "product_data": {"name": pack["name"]},
                },
                "quantity": 1,
            }
        ],
        metadata={
            "user_id": user_id,
            "pack": request.pack,
            "credits": str(pack["credits"]),
        },
        payment_intent_data={"receipt_email": receipt_email},
        success_url=f"{FRONTEND_URL}?payment=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{FRONTEND_URL}?payment=cancelled",
    )

    logger.info(f"[Payments] Checkout session created for {user_id}, pack={request.pack}")
    return {"checkout_url": session.url}


# ---------------------------------------------------------------------------
# Payment Intent endpoints (T526 — inline Payment Element)
# ---------------------------------------------------------------------------


class CreateIntentRequest(BaseModel):
    pack: str


@router.post("/create-intent")
async def create_payment_intent(request: CreateIntentRequest):
    """Create a Stripe PaymentIntent for inline Payment Element checkout."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured")

    pack = CREDIT_PACKS.get(request.pack)
    if not pack:
        raise HTTPException(status_code=400, detail=f"Invalid pack: {request.pack}")

    user_id = get_current_user_id()
    customer_id = _get_or_create_customer(user_id)
    receipt_email = _receipt_email_for(user_id)

    try:
        intent = stripe.PaymentIntent.create(
            amount=pack["price_cents"],
            currency="usd",
            customer=customer_id,
            receipt_email=receipt_email,
            metadata={
                "user_id": user_id,
                "pack": request.pack,
                "credits": str(pack["credits"]),
            },
            automatic_payment_methods={"enabled": True},
        )
    except stripe.StripeError as e:
        logger.error(f"[Payments] Stripe error creating PaymentIntent for {user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create payment ({e.http_status})") from e

    record_milestone(user_id, "payment_started", {"amount_cents": pack["price_cents"]})
    logger.info(f"[Payments] PaymentIntent created for {user_id}, pack={request.pack}, pi={intent.id}")
    return {"client_secret": intent.client_secret}


class ConfirmIntentRequest(BaseModel):
    payment_intent_id: str


@router.post("/confirm-intent")
async def confirm_payment_intent(request: ConfirmIntentRequest, background_tasks: BackgroundTasks = None):
    """
    Verify a PaymentIntent succeeded and grant credits.

    Called by the frontend after stripe.confirmPayment() resolves successfully.
    Same idempotency pattern as /verify — won't double-grant.
    """
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured")

    user_id = get_current_user_id()
    pi_id = request.payment_intent_id

    # Idempotency: already processed?
    if has_processed_payment(user_id, pi_id):
        from ..services.credit_ledger import get_credit_balance, get_credit_transactions
        balance = get_credit_balance(user_id)
        txns = get_credit_transactions(user_id, limit=50)
        granted = 0
        for tx in txns:
            if tx.get("reference_id") == pi_id and tx.get("source") == "stripe_purchase":
                granted = tx.get("amount", 0)
                break
        return {"status": "already_processed", "balance": balance["balance"], "credits": granted}

    # Retrieve PaymentIntent from Stripe
    try:
        intent = stripe.PaymentIntent.retrieve(pi_id)
    except stripe.StripeError as e:
        logger.error(f"[Payments] Failed to retrieve PaymentIntent {pi_id}: {e}")
        raise HTTPException(status_code=400, detail="Invalid payment intent") from e

    if intent.status != "succeeded":
        return {"status": "not_succeeded", "intent_status": intent.status}

    # Verify this intent belongs to the current user
    metadata = intent.metadata or {}
    intent_user_id = metadata.get("user_id")
    if intent_user_id != user_id:
        logger.warning(f"[Payments] PaymentIntent {pi_id} user mismatch: {intent_user_id} != {user_id}")
        raise HTTPException(status_code=403, detail="Payment does not belong to this user")

    credits = int(metadata.get("credits", 0))
    pack = metadata.get("pack", "unknown")

    if credits <= 0:
        raise HTTPException(status_code=400, detail="Invalid credits in payment metadata")

    # grant() is idempotent on (user_id, "stripe:{pi_id}") -- a race between
    # this and the webhook just reports the same balance twice, never double-grants.
    result = _grant_or_503(user_id, credits, "stripe_purchase", pi_id)
    new_balance = result["balance"]

    pack_info = CREDIT_PACKS.get(pack)
    # Only record milestone analytics for the delivery that ACTUALLY applied the
    # grant -- a concurrent duplicate that lost the idempotency race must not
    # double-count milestone events (see _grant_or_503).
    if result["applied"]:
        record_milestone(user_id, "payment_completed", {"amount_cents": pack_info["price_cents"] if pack_info else 0, "credits": credits})
        record_milestone(user_id, "credit_purchased", {"amount": credits, "cents": pack_info["price_cents"] if pack_info else 0})

    # Site A: ledger insert runs on EVERY observation, not gated on `applied`
    # (design §4, ruling 4). amount_cents from Stripe's captured amount, never
    # the local pack price (design §2c). `latest_charge` is a bare id here
    # (not expanded) -- use it directly if present, else NULL + background fill.
    amount_cents = getattr(intent, "amount_received", None)
    if amount_cents is None and isinstance(intent, dict):
        amount_cents = intent.get("amount_received")
    if not amount_cents:
        logger.critical(
            "[Payments] confirm-intent: succeeded PI %s has no amount_received -- "
            "internal inconsistency, not inserting a ledger row with a guessed amount",
            pi_id,
        )
    else:
        latest_charge = getattr(intent, "latest_charge", None)
        if latest_charge is None and isinstance(intent, dict):
            latest_charge = intent.get("latest_charge")
        stripe_charge_id = latest_charge if isinstance(latest_charge, str) else None

        _record_purchase_ledger(
            user_id=user_id, stripe_object_id=pi_id, amount_cents=amount_cents,
            currency="usd", stripe_charge_id=stripe_charge_id,
            pack=pack if pack_info else None, credits=credits,
            occurred_at=datetime.now(UTC), source=payments_ledger.PaymentSource.CONFIRM_INTENT.value,
            reraise=False,
        )
        if stripe_charge_id is None:
            await payments_ledger.schedule_charge_id_fill(pi_id, background_tasks)

    logger.info(
        f"[Payments] Confirmed + granted {credits} credits to {user_id} "
        f"(pack={pack}, pi={pi_id}), balance={new_balance}"
    )
    return {"status": "credits_granted", "credits": credits, "balance": new_balance}


# ---------------------------------------------------------------------------
# Webhook endpoint
# ---------------------------------------------------------------------------


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Stripe webhook endpoint. Verifies signature and grants credits.

    This endpoint does NOT use get_current_user_id() — there's no user session
    on server-to-server webhook calls. The user_id comes from session metadata.
    Stripe signature verification IS the authentication.
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook not configured")

    # Read raw body for signature verification
    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(body, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.SignatureVerificationError:
        logger.warning("[Payments] Webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Invalid signature") from None
    except ValueError:
        logger.warning("[Payments] Webhook payload invalid")
        raise HTTPException(status_code=400, detail="Invalid payload") from None

    # Handle checkout completion (legacy redirect flow)
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        user_id = metadata.get("user_id")
        credits = int(metadata.get("credits", 0))
        pack = metadata.get("pack", "unknown")
        session_id = session["id"]

        if not user_id or credits <= 0:
            logger.error(f"[Payments] Webhook missing metadata: user_id={user_id}, credits={credits}")
            return {"status": "error", "message": "Missing metadata"}

        # Fast-path: skip the GRANT if already processed -- but the ledger
        # insert below still must run on every observation, including this
        # one (design §4, ruling 4). See the identical comment on the
        # payment_intent.succeeded branch below for why this must not return
        # early.
        already_processed = has_processed_payment(user_id, session_id)
        if already_processed:
            logger.info(f"[Payments] Duplicate webhook for session {session_id}, granting skipped, retrying ledger insert")
            new_balance = None
            pack_info = CREDIT_PACKS.get(pack)
            result = {"applied": False}
        else:
            # idempotency_key = stripe:{session_id} -- credit_ledger.grant() itself
            # refuses a double-credit atomically. `applied` gates the milestone
            # analytics so a redelivery that passed the unlocked
            # has_processed_payment read above cannot double-count them
            # (see _grant_or_503).
            result = _grant_or_503(user_id, credits, "stripe_purchase", session_id)
            new_balance = result["balance"]
            pack_info = CREDIT_PACKS.get(pack)

        if result["applied"]:
            record_milestone(user_id, "credit_purchased", {"amount": credits, "cents": pack_info["price_cents"] if pack_info else 0})

        # Site B: ledger insert runs on EVERY observation, not gated on
        # `applied` (design §4, ruling 4). Amount from session.amount_total
        # (already-captured total, no extra Stripe call -- design §2c), keyed
        # on the PI id (extracted from session["payment_intent"]) so this
        # converges with the verify_session (D) and payment_intent.succeeded
        # (C) sites for the same PI.
        pi_id = session.get("payment_intent")
        amount_cents = session.get("amount_total")
        if not pi_id or not amount_cents:
            logger.critical(
                "[Payments] webhook checkout.session.completed: session %s missing "
                "payment_intent/amount_total -- internal inconsistency, not inserting "
                "a ledger row", session_id,
            )
        else:
            inserted = _record_purchase_ledger(
                user_id=user_id, stripe_object_id=pi_id, amount_cents=amount_cents,
                currency=session.get("currency") or "usd", stripe_charge_id=None,
                pack=pack if pack_info else None, credits=credits,
                occurred_at=datetime.now(UTC), source=payments_ledger.PaymentSource.WEBHOOK.value,
                reraise=True,
            )
            if inserted:
                await payments_ledger.schedule_charge_id_fill(pi_id, None)

        logger.info(
            f"[Payments] Granted {credits} credits to {user_id} "
            f"(pack={pack}, session={session_id}), balance={new_balance}"
        )
        if already_processed:
            return {"status": "already_processed", "credits": credits, "balance": new_balance}
        return {"status": "credits_granted", "credits": credits, "balance": new_balance}

    # Handle PaymentIntent success (T526 — inline Payment Element fallback)
    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        metadata = intent.get("metadata", {})
        user_id = metadata.get("user_id")
        credits = int(metadata.get("credits", 0))
        pack = metadata.get("pack", "unknown")
        pi_id = intent["id"]

        if not user_id or credits <= 0:
            logger.error(f"[Payments] Webhook PI missing metadata: user_id={user_id}, credits={credits}")
            return {"status": "error", "message": "Missing metadata"}

        # Fast-path: skip the GRANT if already processed -- but the ledger
        # insert below still must run on every observation, including this
        # one (design §4, ruling 4). Gating the ledger behind this same
        # fast-path would make a redelivery -- the exact case where a prior
        # ledger write is most likely to have failed -- unable to ever retry
        # it, defeating the whole point of moving the insert off the one-shot
        # `applied` gate. So this branch does NOT return early; it skips
        # straight to the (still unconditional) ledger block below.
        already_processed = has_processed_payment(user_id, pi_id)
        if already_processed:
            logger.info(f"[Payments] Duplicate webhook for PI {pi_id}, granting skipped, retrying ledger insert")
            new_balance = None
            pack_info = CREDIT_PACKS.get(pack)
            result = {"applied": False}
        else:
            # idempotency_key = stripe:{pi_id} -- credit_ledger.grant() itself
            # refuses a double-credit atomically. `applied` gates the milestone
            # analytics so a redelivery that passed the unlocked
            # has_processed_payment read above cannot double-count them
            # (see _grant_or_503).
            result = _grant_or_503(user_id, credits, "stripe_purchase", pi_id)
            new_balance = result["balance"]
            pack_info = CREDIT_PACKS.get(pack)

        if result["applied"]:
            record_milestone(user_id, "credit_purchased", {"amount": credits, "cents": pack_info["price_cents"] if pack_info else 0})

        # Site C: ledger insert runs on EVERY observation, not gated on
        # `applied` (design §4, ruling 4). Amount from intent["amount_received"]
        # (already captured, no extra Stripe call -- design §2c);
        # intent["latest_charge"] is a bare id here, so stripe_charge_id is set
        # directly with no background fill needed.
        amount_cents = intent.get("amount_received")
        if not amount_cents:
            logger.critical(
                "[Payments] webhook payment_intent.succeeded: PI %s has no "
                "amount_received -- internal inconsistency, not inserting a ledger "
                "row with a guessed amount", pi_id,
            )
        else:
            latest_charge = intent.get("latest_charge")
            stripe_charge_id = latest_charge if isinstance(latest_charge, str) else None
            _record_purchase_ledger(
                user_id=user_id, stripe_object_id=pi_id, amount_cents=amount_cents,
                currency=intent.get("currency") or "usd", stripe_charge_id=stripe_charge_id,
                pack=pack if pack_info else None, credits=credits,
                occurred_at=datetime.now(UTC), source=payments_ledger.PaymentSource.WEBHOOK.value,
                reraise=True,
            )
            if stripe_charge_id is None:
                await payments_ledger.schedule_charge_id_fill(pi_id, None)

        logger.info(
            f"[Payments] Webhook granted {credits} credits to {user_id} "
            f"(pack={pack}, pi={pi_id}), balance={new_balance}"
        )
        if already_processed:
            return {"status": "already_processed", "credits": credits, "balance": new_balance}
        return {"status": "credits_granted", "credits": credits, "balance": new_balance}

    # Handle PaymentIntent failure (T7510 — attempt-vs-outcome funnel honesty).
    # `payment_started` fired at intent-creation (the attempt); this is its
    # failure outcome. A card decline is a `refused` (validation/bank rejection);
    # anything else is `unknown`. record_milestone is impersonation-guarded, but a
    # server-to-server webhook has no impersonation context anyway.
    if event["type"] == "payment_intent.payment_failed":
        intent = event["data"]["object"]
        metadata = intent.get("metadata", {})
        user_id = metadata.get("user_id")
        pi_id = intent["id"]
        if not user_id:
            logger.error(f"[Payments] Webhook PI failure missing user_id: pi={pi_id}")
            return {"status": "error", "message": "Missing metadata"}
        last_error = intent.get("last_payment_error") or {}
        reason = "refused" if last_error.get("type") == "card_error" else "unknown"
        record_milestone(user_id, "payment_failed", reason=reason)
        logger.info(
            f"[Payments] PaymentIntent failed for {user_id} (pi={pi_id}, "
            f"reason={reason}, code={last_error.get('code')})"
        )
        return {"status": "payment_failed", "reason": reason}

    # Handle refunds (T5760 — keep total_spent_cents net of refunds in steady state)
    #
    # total_spent_cents means NET of refunds, so a refund lowers it at refund time,
    # keeping steady-state drift from Stripe truth near zero (the on-demand
    # reconciliation pass is the safety net, not the routine correction). OPERATOR
    # STEP: this only fires once `charge.refunded` is added to the LIVE-mode webhook
    # endpoint in the Stripe dashboard (webhook events are per-endpoint + per-mode).
    #
    # T8620: the durable idempotency this comment used to flag as a follow-up is now
    # CLOSED. The refund keys the `payments` ledger row on the individual `re_...` id
    # (unique on (stripe_object_id, kind)) and bumps total_spent_cents only when that
    # insert is genuinely new (`_record_refund_ledger`, below) -- a Stripe redelivery
    # of the same refund event is a safe no-op on both, not a double-decrement.
    if event["type"] == "charge.refunded":
        charge = event["data"]["object"]
        user_id = _user_id_for_charge(charge)
        if not user_id:
            logger.error(f"[Payments] charge.refunded without resolvable user_id: charge={charge.get('id')}")
            return {"status": "error", "message": "No user_id"}

        refund_cents, refund_id = _latest_refund(charge)
        if refund_cents <= 0:
            logger.info(f"[Payments] charge.refunded with zero refund delta: charge={charge.get('id')}")
            return {"status": "ignored", "type": "charge.refunded"}

        if not refund_id:
            logger.critical(
                "[Payments] charge.refunded: charge %s has a nonzero refund delta but "
                "no resolvable individual refund id -- cannot key the ledger row",
                charge.get("id"),
            )
        else:
            _record_refund_ledger(
                user_id=user_id, stripe_object_id=refund_id, amount_cents=-refund_cents,
                currency=charge.get("currency") or "usd", stripe_charge_id=charge.get("id"),
                occurred_at=datetime.now(UTC), source=payments_ledger.PaymentSource.WEBHOOK.value,
                reraise=True,
            )
        logger.info(f"[Payments] Refund recorded: user={user_id}, charge={charge.get('id')}, cents={refund_cents}")
        return {"status": "refund_recorded", "user_id": user_id, "cents": refund_cents}

    # Return 200 for all other event types (Stripe expects it)
    return {"status": "ignored", "type": event["type"]}


def _user_id_for_charge(charge) -> str | None:
    """Resolve our user_id for a Charge. We set metadata.user_id on the PaymentIntent,
    not the Charge, so fall back to retrieving the PI when the charge carries none."""
    meta = charge.get("metadata") or {}
    user_id = meta.get("user_id")
    if user_id:
        return user_id
    pi_id = charge.get("payment_intent")
    if pi_id:
        try:
            pi = stripe.PaymentIntent.retrieve(pi_id)
            return (pi.get("metadata") or {}).get("user_id")
        except stripe.StripeError as e:
            logger.error(f"[Payments] Failed to retrieve PI {pi_id} for refund: {e}")
    return None


def _latest_refund_amount(charge) -> int:
    """Cents refunded by THIS refund event. The newest entry in charge.refunds.data is
    the just-created refund; using it (not the cumulative amount_refunded) keeps partial
    and repeated refunds correct. Falls back to cumulative if the list is absent."""
    return _latest_refund(charge)[0]


def _latest_refund(charge) -> tuple[int, str | None]:
    """(cents, refund_id) for THIS refund event. The newest entry in
    charge.refunds.data is the just-created refund (T8620: also extracts its
    `re_...` id -- the design's required ledger idempotency key, design §2a --
    which the amount-only helper above never needed). Falls back to
    (cumulative amount_refunded, None) if the list is absent; a None id means
    the ledger row cannot be written (logged CRITICAL at the call site)."""
    refunds = charge.get("refunds") or {}
    data = refunds.get("data") if isinstance(refunds, dict) else None
    if data:
        return data[0].get("amount", 0) or 0, data[0].get("id")
    return charge.get("amount_refunded", 0) or 0, None


# ---------------------------------------------------------------------------
# Session verification endpoint (works without webhook — needed for local dev)
# ---------------------------------------------------------------------------


@router.post("/verify")
async def verify_session(request: Request, background_tasks: BackgroundTasks = None):
    """
    Verify a Stripe Checkout Session and grant credits if paid.

    Called by the frontend after returning from Stripe checkout. This provides
    immediate credit granting without waiting for the webhook — essential for
    local dev (where webhooks can't reach localhost) and as a reliability
    fallback in production.

    Same idempotency guard as the webhook: won't double-grant.
    """
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Payments not configured")

    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    user_id = get_current_user_id()

    # Already processed (by webhook or previous verify call)
    if has_processed_payment(user_id, session_id):
        from ..services.credit_ledger import get_credit_balance, get_credit_transactions
        balance = get_credit_balance(user_id)
        # Look up how many credits were granted for this session
        txns = get_credit_transactions(user_id, limit=50)
        granted = 0
        for tx in txns:
            if tx.get("reference_id") == session_id and tx.get("source") == "stripe_purchase":
                granted = tx.get("amount", 0)
                break
        return {"status": "already_processed", "balance": balance["balance"], "credits": granted}

    # Retrieve session from Stripe to verify payment
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.StripeError as e:
        logger.error(f"[Payments] Failed to retrieve session {session_id}: {e}")
        raise HTTPException(status_code=400, detail="Invalid session") from e

    if session.payment_status != "paid":
        return {"status": "unpaid", "payment_status": session.payment_status}

    # Verify this session belongs to the current user
    metadata = session.metadata or {}
    session_user_id = metadata.get("user_id")
    if session_user_id != user_id:
        logger.warning(f"[Payments] Session {session_id} user mismatch: {session_user_id} != {user_id}")
        raise HTTPException(status_code=403, detail="Session does not belong to this user")

    credits = int(metadata.get("credits", 0))
    pack = metadata.get("pack", "unknown")

    if credits <= 0:
        raise HTTPException(status_code=400, detail="Invalid credits in session metadata")

    # grant() is idempotent on (user_id, "stripe:{session_id}") -- a race
    # between this and the webhook just reports the same balance twice. `applied`
    # gates the analytics so the losing delivery cannot double-count revenue
    # (see _grant_or_503).
    result = _grant_or_503(user_id, credits, "stripe_purchase", session_id)
    new_balance = result["balance"]

    pack_info = CREDIT_PACKS.get(pack)
    if result["applied"]:
        record_milestone(user_id, "credit_purchased", {"amount": credits, "cents": pack_info["price_cents"] if pack_info else 0})

    # Site D: ledger insert runs on EVERY observation, not gated on `applied`
    # (design §4, ruling 4). Amount from session.amount_total (already
    # captured, no extra Stripe call -- design §2c), keyed on the PI id
    # (extracted from session.payment_intent) so this converges with the
    # checkout.session.completed (B) and payment_intent.succeeded (C) sites
    # for the same PI.
    pi_id = getattr(session, "payment_intent", None)
    amount_cents = getattr(session, "amount_total", None)
    if not pi_id or not amount_cents:
        logger.critical(
            "[Payments] verify_session: session %s missing payment_intent/"
            "amount_total -- internal inconsistency, not inserting a ledger row",
            session_id,
        )
    else:
        currency = getattr(session, "currency", None) or "usd"
        # User-facing site: ledger failure must never fail the response
        # (design §5, ruling 4c) -- swallow.
        inserted = _record_purchase_ledger(
            user_id=user_id, stripe_object_id=pi_id, amount_cents=amount_cents,
            currency=currency, stripe_charge_id=None,
            pack=pack if pack_info else None, credits=credits,
            occurred_at=datetime.now(UTC), source=payments_ledger.PaymentSource.VERIFY.value,
            reraise=False,
        )
        if inserted:
            await payments_ledger.schedule_charge_id_fill(pi_id, background_tasks)

    logger.info(
        f"[Payments] Verified + granted {credits} credits to {user_id} "
        f"(pack={pack}, session={session_id}), balance={new_balance}"
    )
    return {"status": "credits_granted", "credits": credits, "balance": new_balance}
