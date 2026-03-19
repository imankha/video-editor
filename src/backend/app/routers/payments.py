"""
Payments Router - Stripe Checkout + webhook endpoints (T525).

Provides:
- POST /payments/checkout — Create Stripe Checkout Session for credit purchase
- POST /payments/webhook — Stripe webhook to fulfill credit grants

Credit packs are defined as constants (not in DB). Prices match T520 analysis.
"""

import logging
import os

import stripe
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..user_context import get_current_user_id
from ..services.auth_db import (
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
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# Frontend URL for redirect after checkout
# In dev: localhost:5173, in staging/prod: from CORS_ORIGINS
_cors = os.getenv("CORS_ORIGINS", "")
FRONTEND_URL = _cors.split(",")[0].strip() if _cors else "http://localhost:5173"

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# ---------------------------------------------------------------------------
# Credit Packs
# ---------------------------------------------------------------------------

CREDIT_PACKS = {
    "starter": {"credits": 120, "price_cents": 499, "name": "Starter — 120 Credits"},
    "popular": {"credits": 400, "price_cents": 1299, "name": "Popular — 400 Credits"},
    "pro": {"credits": 1000, "price_cents": 2499, "name": "Pro — 1,000 Credits"},
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
        success_url=f"{FRONTEND_URL}?payment=success",
        cancel_url=f"{FRONTEND_URL}?payment=cancelled",
    )

    logger.info(f"[Payments] Checkout session created for {user_id}, pack={request.pack}")
    return {"checkout_url": session.url}


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

    # Handle checkout completion
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

        # Idempotency: don't double-grant
        if has_processed_payment(session_id):
            logger.info(f"[Payments] Duplicate webhook for session {session_id}, skipping")
            return {"status": "already_processed"}

        new_balance = grant_credits(user_id, credits, "stripe_purchase", session_id)
        logger.info(
            f"[Payments] Granted {credits} credits to {user_id} "
            f"(pack={pack}, session={session_id}), balance={new_balance}"
        )
        return {"status": "credits_granted", "credits": credits, "balance": new_balance}

    # Return 200 for all other event types (Stripe expects it)
    return {"status": "ignored", "type": event["type"]}
