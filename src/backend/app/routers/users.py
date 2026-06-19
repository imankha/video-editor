"""
User-level endpoints (account info, invite codes).

Endpoints:
    GET /api/me/invite-code - Get the user's invite code and shareable URL
"""

import hashlib
import logging
from urllib.parse import quote

from fastapi import APIRouter

from app.services.sharing_db import persist_invite_code
from app.services.user_db import get_profiles
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["users"])


def _default_sport(user_id: str) -> str | None:
    """The acting user's default-profile sport, read from their LOCAL user.sqlite.

    Called only in the owner's own request, where their SQLite is local -- no R2
    download. Best-effort: a missing sport just omits the inheritance hint."""
    try:
        profiles = get_profiles(user_id)
        if not profiles:
            return None
        default = next((p for p in profiles if p.get("is_default")), profiles[0])
        return default.get("sport")
    except Exception as e:
        logger.warning(f"[invite] could not read default sport for {user_id}: {e}")
        return None


@router.get("/invite-code")
async def get_invite_code():
    """Return a deterministic invite code derived from the user's ID.

    The invite URL carries a snapshot of the user's default sport (T2915) so an
    invitee can inherit it at signup. The snapshot is captured here, in the
    inviter's own context, and frozen onto the referral row when the invitee signs up.
    """
    user_id = get_current_user_id()
    code = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    persist_invite_code(user_id, code)
    sport = _default_sport(user_id)
    invite_url = f"https://www.reelballers.com?ref={code}"
    if sport:
        invite_url += f"&sport={quote(sport)}"
    return {
        "invite_code": code,
        "invite_url": invite_url,
    }
