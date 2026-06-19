"""
User-level endpoints (account info, invite codes).

Endpoints:
    GET /api/me/invite-code - Get the user's invite code and shareable URL
"""

import hashlib
import logging

from fastapi import APIRouter

from app.services.sharing_db import mirror_default_sport, persist_invite_code
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["users"])


@router.get("/invite-code")
async def get_invite_code():
    """Return a deterministic invite code derived from the user's ID."""
    user_id = get_current_user_id()
    code = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    persist_invite_code(user_id, code)
    mirror_default_sport(user_id)  # keep the inviter's mirrored sport fresh (T2915)
    return {
        "invite_code": code,
        "invite_url": f"https://www.reelballers.com?ref={code}",
    }
