"""
Credits Router - Credit balance and transaction endpoints (T530).

Provides endpoints for checking credit balance, granting credits,
and viewing transaction history. Credit deduction happens in the
export endpoints (exports.py), not here.
"""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import credit_ledger
from ..services.credit_ledger import CreditsUnavailable, get_credit_balance, get_credit_transactions
from ..storage import APP_ENV
from ..user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits", tags=["credits"])


class GrantRequest(BaseModel):
    amount: int
    source: str
    reference_id: str | None = None


def grant_credits(user_id: str, amount: int, source: str, reference_id: str | None = None) -> int:
    """Test-only key derivation. `source` is CLIENT-supplied here (unlike every
    other grant call site) so it is not part of the registered KEY_PREFIX map --
    this does NOT go through credit_ledger.credit_key(). A reference_id is used
    verbatim as the key when given (mirrors the old NULL-is-not-a-key SQLite
    behavior: no reference_id means every call is a distinct grant)."""
    key = f"selfgrant:{reference_id}" if reference_id else f"selfgrant:{uuid.uuid4().hex}"
    result = credit_ledger.grant(user_id, amount, source, key, reference_id=reference_id)
    return result["balance"]


@router.get("")
async def get_balance():
    """Get current credit balance."""
    user_id = get_current_user_id()
    return get_credit_balance(user_id)


@router.post("/grant")
async def grant(request: GrantRequest):
    """
    Grant credits to the CURRENT user with a client-supplied amount — test-only.

    NOT REACHABLE IN PRODUCTION (hard 404, mirroring auth.py's dev-login gate).
    The original docstring claimed "used by quest system (T540) and admin panel
    (T550)", but both grant server-side today and never call this endpoint:
      - quests    -> T8120: no longer per-quest; session_init.py grant_quest_chain_credits(user_id)
                     grants the whole chain total upfront at signup/next login (server picks the amount)
      - admin     -> admin.py  admin_grant_credits / admin_bulk_grant_credits (admin-gated)
      - Stripe    -> payments.py grant_credits(..., "stripe_purchase", pi_id)
      - signup    -> session_init.py new_account_bonus
    No production frontend code calls it; only e2e specs do (regression-tests,
    new-user-flow). Left open, it let ANY authenticated production user mint
    unlimited credits for free, bypassing Stripe entirely.
    """
    if APP_ENV == "production":
        raise HTTPException(status_code=404, detail="Not found")

    user_id = get_current_user_id()
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    try:
        new_balance = grant_credits(user_id, request.amount, request.source, request.reference_id)
    except CreditsUnavailable:
        raise HTTPException(status_code=503, detail={"code": "credits_unavailable", "retryable": True}) from None
    return {"balance": new_balance}


@router.get("/transactions")
async def transactions(limit: int = 50):
    """Get recent credit transactions for the current user."""
    user_id = get_current_user_id()
    return get_credit_transactions(user_id, limit)
