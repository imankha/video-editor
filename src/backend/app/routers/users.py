"""
User-level endpoints (account info, invite codes).

Endpoints:
    GET /api/me/invite-code - Get the user's invite code and shareable URL
    POST /api/me/resume-point - Write the server-held resume point (T14980)
    DELETE /api/me/resume-point - Clear it (e.g. the restored target 404'd)
"""

import logging
from urllib.parse import quote

from fastapi import APIRouter, Response
from pydantic import BaseModel

from app.services.resume_points import delete_resume_point, upsert_resume_point
from app.services.sharing_db import ensure_invite_code
from app.services.user_db import get_default_profile_sport
from app.user_context import get_current_impersonator_id, get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["users"])


@router.get("/invite-code")
async def get_invite_code():
    """Return a deterministic invite code derived from the user's ID.

    The invite URL carries a snapshot of the user's default sport (T2915) so an
    invitee can inherit it at signup. The snapshot is captured here, in the
    inviter's own context, and frozen onto the referral row when the invitee signs up.
    """
    user_id = get_current_user_id()
    code = ensure_invite_code(user_id)
    sport = get_default_profile_sport(user_id)
    invite_url = f"https://www.reelballers.com?ref={code}"
    if sport:
        invite_url += f"&sport={quote(sport)}"
    return {
        "invite_code": code,
        "invite_url": invite_url,
    }


class ResumePointReport(BaseModel):
    """T14980: the whole resume point, sent as one datum (never a partial
    patch -- "surgical" here means the single row, not a sub-field). Every
    field optional: a beacon/gesture must never fail validation; unknown or
    out-of-vocabulary values are dropped server-side in resume_points.py."""

    path: str | None = None
    profile_id: str | None = None
    screen: str | None = None
    step: str | None = None
    t: float | None = None
    dialog: str | None = None
    tab: str | None = None
    build: int | None = None
    left_at: str | None = None


@router.post("/resume-point", status_code=204)
async def set_resume_point(payload: ResumePointReport) -> Response:
    """Write the resume point from a navigation gesture or the exit beacon
    (`navigator.sendBeacon`, hence POST for both write kinds -- it can only
    POST). Impersonated sessions accept-and-discard (204), exactly like
    record_milestone's guard, so an admin looking around never moves the
    user's own resume point."""
    if get_current_impersonator_id():
        return Response(status_code=204)

    user_id = get_current_user_id()
    upsert_resume_point(user_id, payload.model_dump())
    return Response(status_code=204)


@router.delete("/resume-point", status_code=204)
async def clear_resume_point() -> Response:
    """Clears the row -- used when the restored target 404s, so a stale point
    can't loop. Impersonated sessions accept-and-discard, same as the write."""
    if get_current_impersonator_id():
        return Response(status_code=204)

    delete_resume_point(get_current_user_id())
    return Response(status_code=204)
