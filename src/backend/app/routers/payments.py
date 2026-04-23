"""
Payments Router - Stripe Checkout + Payment Element endpoints (T525, T526).

Provides:
- POST /payments/checkout — Create Stripe Checkout Session (legacy redirect flow)
- POST /payments/create-intent — Create PaymentIntent for inline Payment Element (T526)
- POST /payments/confirm-intent — Verify PaymentIntent and grant credits (T526)
- POST /payments/webhook — Stripe webhook to fulfill credit grants (fallback)
- POST /payments/verify — Verify Checkout Session after redirect (legacy)

Credit packs are defined as constants (not in DB). Prices match T520 analysis.
"""

import logging
import os
import sqlite3

import stripe
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..user_context import get_current_user_id
from ..services.user_db import (
    get_stripe_customer_id,
    set_stripe_customer_id,
    has_processed_payment,
    grant_credits,
)

logger = logging.getLogger(__name__)

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
    """Return Stripe publishable key for frontend Payment Element initialization."""
    return {"publishable_key": STRIPE_PUBLISHABLE_KEY}


# ---------------------------------------------------------------------------
# Credit Packs
# ---------------------------------------------------------------------------

CREDIT_PACKS = {
    "starter": {"credits": 40, "price_cents": 399, "name": "Starter — 40 Credits"},
    "popular": {"credits": 85, "price_cents": 699, "name": "Popular — 85 Credits"},
    "best_value": {"credits": 180, "price_cents": 1299, "name": "Best Value — 180 Credits"},
}

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

    # Get or create Stripe customer
    customer_id = get_stripe_customer_id(user_id)
    if not customer_id:
        customer = stripe.Customer.create(metadata={"user_id": user_id})
        customer_id = customer.id
        set_stripe_customer_id(user_id, customer_id)

    # Create Checkout Session
    session = stripe.checkout.Session.create(
        mode="payment",
        customer=customer_id,
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

    # Get or create Stripe customer
    customer_id = get_stripe_customer_id(user_id)
    if not customer_id:
        customer = stripe.Customer.create(metadata={"user_id": user_id})
        customer_id = customer.id
        set_stripe_customer_id(user_id, customer_id)

    try:
        intent = stripe.PaymentIntent.create(
            amount=pack["price_cents"],
            currency="usd",
            customer=customer_id,
            metadata={
                "user_id": user_id,
                "pack": request.pack,
                "credits": str(pack["credits"]),
            },
            automatic_payment_methods={"enabled": True},
        )
    except stripe.StripeError as e:
        logger.error(f"[Payments] Stripe error creating PaymentIntent for {user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create payment ({e.http_status})")

    logger.info(f"[Payments] PaymentIntent created for {user_id}, pack={request.pack}, pi={intent.id}")
    return {"client_secret": intent.client_secret}


class ConfirmIntentRequest(BaseModel):
    payment_intent_id: str


@router.post("/confirm-intent")
async def confirm_payment_intent(request: ConfirmIntentRequest):
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
        from ..services.user_db import get_credit_balance, get_credit_transactions
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
        raise HTTPException(status_code=400, detail="Invalid payment intent")

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

    try:
        new_balance = grant_credits(user_id, credits, "stripe_purchase", pi_id)
    except sqlite3.IntegrityError:
        # Already processed — idempotent success (race between confirm + webhook)
        logger.info(f"[Payments] Payment {pi_id} already processed (idempotent)")
        from ..services.user_db import get_credit_balance
        balance = get_credit_balance(user_id)
        return {"status": "already_processed", "balance": balance["balance"], "credits": credits}

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
        raise HTTPException(status_code=400, detail="Invalid signature")
    except ValueError:
        logger.warning("[Payments] Webhook payload invalid")
        raise HTTPException(status_code=400, detail="Invalid payload")

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

        # Fast-path: skip work if already processed
        if has_processed_payment(user_id, session_id):
            logger.info(f"[Payments] Duplicate webhook for session {session_id}, skipping")
            return {"status": "already_processed"}

        # UNIQUE index on (user_id, source, reference_id) prevents double-grant atomically
        try:
            new_balance = grant_credits(user_id, credits, "stripe_purchase", session_id)
        except sqlite3.IntegrityError:
            logger.info(f"[Payments] Payment {session_id} already processed (idempotent)")
            return {"status": "already_processed"}

        logger.info(
            f"[Payments] Granted {credits} credits to {user_id} "
            f"(pack={pack}, session={session_id}), balance={new_balance}"
        )
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

        # Fast-path: skip work if already processed
        if has_processed_payment(user_id, pi_id):
            logger.info(f"[Payments] Duplicate webhook for PI {pi_id}, skipping")
            return {"status": "already_processed"}

        # UNIQUE index on (user_id, source, reference_id) prevents double-grant atomically
        try:
            new_balance = grant_credits(user_id, credits, "stripe_purchase", pi_id)
        except sqlite3.IntegrityError:
            logger.info(f"[Payments] Payment {pi_id} already processed (idempotent)")
            return {"status": "already_processed"}

        logger.info(
            f"[Payments] Webhook granted {credits} credits to {user_id} "
            f"(pack={pack}, pi={pi_id}), balance={new_balance}"
        )
        return {"status": "credits_granted", "credits": credits, "balance": new_balance}

    # Return 200 for all other event types (Stripe expects it)
    return {"status": "ignored", "type": event["type"]}


# ---------------------------------------------------------------------------
# Session verification endpoint (works without webhook — needed for local dev)
# ---------------------------------------------------------------------------


@router.post("/verify")
async def verify_session(request: Request):
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
        from ..services.user_db import get_credit_balance, get_credit_transactions
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
        raise HTTPException(status_code=400, detail="Invalid session")

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

    try:
        new_balance = grant_credits(user_id, credits, "stripe_purchase", session_id)
    except sqlite3.IntegrityError:
        # Already processed — idempotent success (race between verify + webhook)
        logger.info(f"[Payments] Payment {session_id} already processed (idempotent)")
        from ..services.user_db import get_credit_balance
        balance = get_credit_balance(user_id)
        return {"status": "already_processed", "balance": balance["balance"], "credits": credits}

    logger.info(
        f"[Payments] Verified + granted {credits} credits to {user_id} "
        f"(pack={pack}, session={session_id}), balance={new_balance}"
    )
    return {"status": "credits_granted", "credits": credits, "balance": new_balance}
