"""
Share endpoints -- two routers for different auth contexts.

gallery_shares_router (/api/gallery):
  - POST /{video_id}/share  -- create shares (authenticated sharer)
  - GET /{video_id}/shares  -- list shares for a video (authenticated sharer)

shared_router (/api/shared):
  - GET /{share_token}       -- get share + presigned URL (optional auth)
  - PATCH /{share_token}     -- toggle visibility (authenticated sharer)
  - DELETE /{share_token}    -- revoke share (authenticated sharer)
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..user_context import get_current_user_id
from ..profile_context import get_current_profile_id
from ..database import get_db_connection
from ..storage import APP_ENV, generate_presigned_url_global
from ..services.sharing_db import (
    create_shares,
    get_share_by_token,
    list_contacts_for_user,
    list_shares_for_video,
    update_share_visibility,
    revoke_share,
)
from ..services.auth_db import (
    get_user_by_email,
    get_user_by_id,
    validate_session,
)

logger = logging.getLogger(__name__)

gallery_shares_router = APIRouter(prefix="/api/gallery", tags=["shares"])
shared_router = APIRouter(prefix="/api/shared", tags=["shares"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ShareCreateRequest(BaseModel):
    recipient_emails: list[str]
    is_public: bool = False


class ShareCreateRecipient(BaseModel):
    share_token: str
    recipient_email: str
    is_existing_user: bool


class ShareCreateResponse(BaseModel):
    shares: list[ShareCreateRecipient]


class ShareDetailResponse(BaseModel):
    share_token: str
    video_name: Optional[str]
    video_duration: Optional[float]
    video_url: Optional[str]
    is_public: bool
    shared_at: str


class ShareListItem(BaseModel):
    id: int
    share_token: str
    recipient_email: str
    is_public: bool
    shared_at: str
    revoked_at: Optional[str]


class ContactsResponse(BaseModel):
    contacts: list[str]


class ShareVisibilityRequest(BaseModel):
    is_public: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_email_from_request(request: Request) -> Optional[str]:
    session_id = request.cookies.get("rb_session")
    if session_id:
        session = validate_session(session_id)
        if session:
            return session.get("email")
        return None

    user_id = request.headers.get("X-User-ID")
    if user_id:
        user = get_user_by_id(user_id)
        return user["email"] if user else None
    return None


def _get_user_id_from_request(request: Request) -> Optional[str]:
    session_id = request.cookies.get("rb_session")
    if session_id:
        session = validate_session(session_id)
        if session:
            return session.get("user_id")
        return None

    return request.headers.get("X-User-ID")


def _build_video_r2_key(share: dict) -> str:
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/final_videos/{share['video_filename']}"
    )


# ---------------------------------------------------------------------------
# Gallery shares router (always authenticated)
# ---------------------------------------------------------------------------

@gallery_shares_router.get("/contacts", response_model=ContactsResponse)
async def get_contacts():
    user_id = get_current_user_id()
    contacts = list_contacts_for_user(user_id)
    return ContactsResponse(contacts=contacts)


@gallery_shares_router.post("/{video_id}/share", response_model=ShareCreateResponse)
async def create_share(video_id: int, body: ShareCreateRequest):
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """SELECT fv.filename, COALESCE(fv.name, p.name) as name, fv.duration
               FROM final_videos fv
               LEFT JOIN projects p ON fv.project_id = p.id
               WHERE fv.id = ?""",
            (video_id,),
        )
        video = cursor.fetchone()
        if not video:
            raise HTTPException(404, "Video not found")

    recipient_emails = body.recipient_emails
    if not recipient_emails:
        if not body.is_public:
            raise HTTPException(400, "At least one recipient email is required")
        sharer = get_user_by_id(user_id)
        recipient_emails = [sharer["email"] if sharer else user_id]

    existing_emails: set[str] = set()
    for email in recipient_emails:
        user = get_user_by_email(email.lower().strip())
        if user:
            existing_emails.add(email.lower().strip())

    shares = create_shares(
        video_id=video_id,
        sharer_user_id=user_id,
        sharer_profile_id=profile_id,
        video_filename=video["filename"],
        video_name=video["name"],
        video_duration=video["duration"],
        recipient_emails=recipient_emails,
        is_public=body.is_public,
    )

    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    is_self_share = not body.recipient_emails and body.is_public
    if is_self_share:
        logger.info("[Share] Public self-share -- skipping email")
    else:
        from ..services.email import send_share_email
        for s in shares:
            if s["recipient_email"].lower() == sharer_email.lower():
                logger.info(f"[Share] Skipping email to self ({sharer_email})")
            else:
                logger.info(f"[Share] Sending email to {s['recipient_email']}")
                asyncio.create_task(send_share_email(
                    recipient_email=s["recipient_email"],
                    sharer_email=sharer_email,
                    share_token=s["share_token"],
                    video_name=video["name"],
                ))

    return ShareCreateResponse(
        shares=[
            ShareCreateRecipient(
                share_token=s["share_token"],
                recipient_email=s["recipient_email"],
                is_existing_user=s["recipient_email"] in existing_emails,
            )
            for s in shares
        ]
    )


@gallery_shares_router.get("/{video_id}/shares", response_model=list[ShareListItem])
async def list_video_shares(video_id: int):
    user_id = get_current_user_id()
    shares = list_shares_for_video(video_id, user_id)
    return [
        ShareListItem(
            id=s["id"],
            share_token=s["share_token"],
            recipient_email=s["recipient_email"],
            is_public=bool(s["is_public"]),
            shared_at=s["shared_at"],
            revoked_at=s["revoked_at"],
        )
        for s in shares
    ]


# ---------------------------------------------------------------------------
# Shared router (optional auth -- /api/shared/ is in AUTH_ALLOWLIST_PREFIXES)
# ---------------------------------------------------------------------------

@shared_router.get("/{share_token}", response_model=ShareDetailResponse)
async def get_shared_video(share_token: str, request: Request):
    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This share has been revoked")

    if not share["is_public"]:
        email = _get_email_from_request(request)
        if not email or email.lower() != share["recipient_email"].lower():
            raise HTTPException(403, "Access denied")

    video_url = generate_presigned_url_global(_build_video_r2_key(share))

    return ShareDetailResponse(
        share_token=share["share_token"],
        video_name=share["video_name"],
        video_duration=share["video_duration"],
        video_url=video_url,
        is_public=bool(share["is_public"]),
        shared_at=share["shared_at"],
    )


@shared_router.patch("/{share_token}")
async def patch_shared_video(share_token: str, body: ShareVisibilityRequest, request: Request):
    user_id = _get_user_id_from_request(request)
    if not user_id:
        raise HTTPException(401, "Authentication required")

    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["sharer_user_id"] != user_id:
        raise HTTPException(403, "Only the sharer can modify this share")

    updated = update_share_visibility(share_token, body.is_public, user_id)
    if not updated:
        raise HTTPException(409, "Share is revoked or not found")

    return {"ok": True}


@shared_router.delete("/{share_token}")
async def delete_shared_video(share_token: str, request: Request):
    user_id = _get_user_id_from_request(request)
    if not user_id:
        raise HTTPException(401, "Authentication required")

    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["sharer_user_id"] != user_id:
        raise HTTPException(403, "Only the sharer can revoke this share")

    revoked = revoke_share(share_token, user_id)
    if not revoked:
        raise HTTPException(409, "Share is already revoked")

    return {"ok": True}
