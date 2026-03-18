"""
Credits Router - Credit balance and transaction endpoints (T530).

Provides endpoints for checking credit balance, granting credits,
and viewing transaction history. Credit deduction happens in the
export endpoints (exports.py), not here.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from ..user_context import get_current_user_id
from ..services.auth_db import (
    get_credit_balance,
    grant_credits,
    get_credit_transactions,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits", tags=["credits"])


class GrantRequest(BaseModel):
    amount: int
    source: str
    reference_id: Optional[str] = None


@router.get("")
async def get_balance():
    """Get current credit balance and first-time-free flags."""
    user_id = get_current_user_id()
    return get_credit_balance(user_id)


@router.post("/grant")
async def grant(request: GrantRequest):
    """
    Grant credits to the current user.

    Used by quest system (T540) and admin panel (T550).
    """
    user_id = get_current_user_id()
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    new_balance = grant_credits(user_id, request.amount, request.source, request.reference_id)
    return {"balance": new_balance}


@router.get("/transactions")
async def transactions(limit: int = 50):
    """Get recent credit transactions for the current user."""
    user_id = get_current_user_id()
    return get_credit_transactions(user_id, limit)
