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
from datetime import datetime
from typing import Union

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel

from ..analytics import record_milestone
from ..database import get_db_connection
from ..profile_context import get_current_profile_id
from ..services.auth_db import (
    get_user_by_email,
    get_user_by_id,
    validate_session,
)
from ..services.poster import poster_basename, poster_rel_path
from ..services.sharing_db import (
    create_shares,
    get_active_public_share_for_video,
    get_collection_share_by_token,
    get_game_share_by_token,
    get_pending_shares_for_email,
    get_share_by_token,
    list_contacts_for_user,
    list_shares_for_video,
    revoke_share,
    update_share_visibility,
)
from ..storage import (
    APP_ENV,
    generate_presigned_url_global,
    r2_head_object_global,
)
from ..user_context import get_current_user_id

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
    email_sent: bool | None = None


class ShareCreateResponse(BaseModel):
    shares: list[ShareCreateRecipient]


class ShareDetailResponse(BaseModel):
    share_token: str
    video_name: str | None
    video_duration: float | None
    video_url: str | None
    video_poster_url: str | None = None
    video_poster_width: int | None = None
    video_poster_height: int | None = None
    is_public: bool
    shared_at: Union[str, datetime]


class ShareListItem(BaseModel):
    id: int
    share_token: str
    recipient_email: str
    is_public: bool
    shared_at: Union[str, datetime]
    revoked_at: Union[str, datetime] | None


class ContactsResponse(BaseModel):
    contacts: list[str]


class ShareVisibilityRequest(BaseModel):
    is_public: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_email_from_request(request: Request) -> str | None:
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


def _get_user_id_from_request(request: Request) -> str | None:
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


def _build_poster_r2_key(share: dict) -> str:
    """Full R2 key for the share's first-frame poster (T4890).

    The poster key is DETERMINISTIC from the video filename under the SAME
    per-profile prefix as the video (`final_videos/posters/{video_filename}.jpg`),
    so it needs no extra snapshot on the share row -- it follows the exact same
    access model as `_build_video_r2_key`.
    """
    rel = poster_rel_path(poster_basename(share["video_filename"]))
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/{rel}"
    )


def _resolve_poster(share: dict) -> tuple[str | None, int | None, int | None]:
    """(url, width, height) for a share's poster, or (None, None, None) if absent.

    Existence is decided by an R2 HEAD (the object store is where the unfurl
    crawler will actually fetch it, so this is the honest source of truth AND it
    means a backfill of legacy reels lights up their EXISTING share links
    immediately). No silent fallback: a reel without a poster yields None so the
    edge page omits the og:image tag, and we log at info. Never raises.

    Width/height come from the poster object's user-metadata (set at generation);
    they are optional -- absent metadata just omits og:image:width/height.

    The URL is the STABLE relative proxy path (/api/shared/{token}/poster.jpg),
    never a presigned R2 URL: unfurl crawlers refetch og:image long after a
    4h signature expires, and the edge-cached HTML would bake in a dead link.
    The edge function absolutizes it with its API base."""
    poster_key = _build_poster_r2_key(share)
    head = r2_head_object_global(poster_key)
    if head is None:
        logger.info(
            f"[Share] no poster for token={share.get('share_token')} "
            f"({poster_key}); omitting og:image"
        )
        return (None, None, None)
    meta = head.get("Metadata") or {}
    width = _int_or_none(meta.get("width"))
    height = _int_or_none(meta.get("height"))
    return (f"/api/shared/{share['share_token']}/poster.jpg", width, height)


def _int_or_none(value) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Gallery shares router (always authenticated)
# ---------------------------------------------------------------------------

@gallery_shares_router.get("/contacts", response_model=ContactsResponse)
async def get_contacts():
    user_id = get_current_user_id()
    contacts = list_contacts_for_user(user_id)
    return ContactsResponse(contacts=contacts)


@gallery_shares_router.post("/{video_id}/share", response_model=ShareCreateResponse)
async def create_share(video_id: int, body: ShareCreateRequest, background_tasks: BackgroundTasks):
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
        # Idempotent public link: repeated "Copy Link" clicks must return the
        # SAME active share instead of piling up rows. Only reuse a share that
        # snapshots the video's CURRENT filename (a re-export invalidates old
        # shares' snapshots, so those correctly get a fresh link).
        existing = get_active_public_share_for_video(
            video_id, user_id, video["filename"]
        )
        if existing:
            return ShareCreateResponse(shares=[
                ShareCreateRecipient(
                    share_token=existing["share_token"],
                    recipient_email=existing["recipient_email"],
                    is_existing_user=True,
                    email_sent=None,
                )
            ])
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
    # Analytics off the response path (T4840 pattern): Copy Link's toast waits
    # on this response, and the milestone is a Postgres write it never needed.
    background_tasks.add_task(
        record_milestone, user_id, "share_completed",
        {"recipient_count": len(recipient_emails), "share_type": "public" if body.is_public else "direct"},
    )

    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    is_self_share = not body.recipient_emails and body.is_public

    email_results = {}
    if not is_self_share:
        from ..services.email import _is_existing_user, _resolve_sender_name, send_share_email
        sender_name = _resolve_sender_name(sharer_email)
        tasks = {}
        for s in shares:
            if s["recipient_email"].lower() == sharer_email.lower():
                continue
            is_first_touch = not _is_existing_user(s["recipient_email"])
            tasks[s["recipient_email"]] = send_share_email(
                recipient_email=s["recipient_email"],
                sharer_email=sharer_email,
                share_token=s["share_token"],
                video_name=video["name"],
                sender_name=sender_name,
                is_first_touch=is_first_touch,
            )
        if tasks:
            results = await asyncio.gather(*tasks.values())
            email_results = dict(zip(tasks.keys(), results))
            for email in tasks:
                background_tasks.add_task(
                    record_milestone, user_id, "invite_sent",
                    {"recipient_email": email, "share_type": "public" if body.is_public else "direct"},
                )

    return ShareCreateResponse(
        shares=[
            ShareCreateRecipient(
                share_token=s["share_token"],
                recipient_email=s["recipient_email"],
                is_existing_user=s["recipient_email"] in existing_emails,
                email_sent=email_results.get(s["recipient_email"]),
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

@shared_router.get("/teammate/{share_token}")
async def get_shared_teammate(share_token: str, request: Request):
    share = get_game_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["share_type"] not in ("game", "annotation_playback"):
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This share has been revoked")

    sharer = get_user_by_id(share["sharer_user_id"])
    sharer_email = sharer["email"] if sharer else "Unknown"

    game_name = share["game_name"] or "Shared Game"
    game_blake3 = share["game_blake3"]
    first_clip_start = share["first_clip_start"]
    clip_names = share["clip_names"] or []

    video_warm_url = None
    if game_blake3:
        video_warm_url = generate_presigned_url_global(f"games/{game_blake3}.mp4", expires_in=14400)

    if share["materialized_at"]:
        return {
            "materialized": True,
            "share_token": share_token,
            "sharer_email": sharer_email,
            "game_name": game_name,
            "game_blake3": game_blake3,
            "first_clip_start": first_clip_start,
            "clip_count": len(clip_names),
            "clip_names": clip_names,
            "video_warm_url": video_warm_url,
        }

    recipient_user = get_user_by_email(share["recipient_email"])
    recipient_has_account = recipient_user is not None

    pending = get_pending_shares_for_email(share["recipient_email"])
    pending_for_share = [p for p in pending if p["share_id"] == share["id"]]
    pending_ids = [p["id"] for p in pending_for_share]

    return {
        "share_token": share_token,
        "sharer_email": sharer_email,
        "game_name": game_name,
        "game_blake3": game_blake3,
        "first_clip_start": first_clip_start,
        "pending_ids": pending_ids,
        "materialized": False,
        "recipient_has_account": recipient_has_account,
        "clip_count": len(clip_names),
        "clip_names": clip_names,
        "video_warm_url": video_warm_url,
    }


@shared_router.get("/collection/{share_token}")
async def get_shared_collection(share_token: str, request: Request):
    """Public resolver for a collection share (T3620). Revoked -> 410; private ->
    recipient-email gate (403); otherwise evaluate the stored definition LIVE
    against the sharer's profile DB and return presigned members. Empty / DB
    evicted -> 200 with empty members (a 'no highlights yet' state, not 404)."""
    share = get_collection_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This share has been revoked")

    if not share["collection_is_public"]:
        email = _get_email_from_request(request)
        if not email or email.lower() != share["recipient_email"].lower():
            raise HTTPException(403, "Access denied")

    record_milestone(share["sharer_user_id"], "share_viewed", {
        "share_token": share_token,
        "sharer_user_id": share["sharer_user_id"],
        "share_type": "collection",
    })

    from .collections import resolve_collection_share
    return resolve_collection_share(share)


@shared_router.get("/{share_token}", response_model=ShareDetailResponse)
async def get_shared_video(share_token: str, request: Request, background_tasks: BackgroundTasks):
    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This share has been revoked")

    if not share["is_public"]:
        email = _get_email_from_request(request)
        if not email or email.lower() != share["recipient_email"].lower():
            raise HTTPException(403, "Access denied")

    # T4840: record the view off the response path so the JSON no longer waits
    # on 2 Postgres writes + opening the sharer's SQLite. Semantics identical.
    background_tasks.add_task(
        record_milestone,
        share["sharer_user_id"],
        "share_viewed",
        {"share_token": share_token, "sharer_user_id": share["sharer_user_id"]},
    )

    video_url = generate_presigned_url_global(_build_video_r2_key(share))
    # T4890: absolute, unauthenticated poster URL (same access model as video_url)
    # so the edge share page can emit og:image/twitter:image + <video poster>.
    poster_url, poster_w, poster_h = _resolve_poster(share)

    return ShareDetailResponse(
        share_token=share["share_token"],
        video_name=share["video_name"],
        video_duration=share["video_duration"],
        video_url=video_url,
        video_poster_url=poster_url,
        video_poster_width=poster_w,
        video_poster_height=poster_h,
        is_public=bool(share["is_public"]),
        shared_at=share["shared_at"],
    )


async def _serve_poster_jpeg(poster_key: str) -> Response:
    """Proxy a poster object with a FRESH presign per request (24h client cache).
    404 when the object is absent; 502 on an R2 fetch failure. Never presigned
    URLs in responses - crawlers refetch after signatures expire."""
    if r2_head_object_global(poster_key) is None:
        raise HTTPException(404, "No poster for this share")

    import httpx
    url = generate_presigned_url_global(poster_key)
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        raise HTTPException(502, "Poster fetch failed")
    return Response(
        content=resp.content,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@shared_router.get("/collection/{share_token}/poster.jpg")
async def get_shared_collection_poster(share_token: str):
    """Stable unfurl image for a COLLECTION share: the first member's poster.

    Public collections only - crawlers cannot authenticate, and a private
    collection's unfurl should reveal nothing.
    """
    share = get_collection_share_by_token(share_token)
    if not share or share["revoked_at"] or not share["collection_is_public"]:
        raise HTTPException(404, "Share not found")

    from .collections import first_member_poster_key
    poster_key = first_member_poster_key(share)
    if poster_key is None:
        raise HTTPException(404, "No poster for this share")
    return await _serve_poster_jpeg(poster_key)


@shared_router.get("/{share_token}/poster.jpg")
async def get_shared_poster(share_token: str):
    """Stable public poster image for unfurl crawlers (T4890 follow-up).

    og:image must never embed a presigned URL: crawlers refetch after the
    signature's 4h expiry and the edge-cached share HTML would carry a dead
    link. This proxies the poster object with a FRESH presign per request.
    Access model: knowing the share token grants the poster (one frame of an
    already-shared video), same trust boundary as the share link itself.
    """
    share = get_share_by_token(share_token)
    if not share or share["revoked_at"]:
        raise HTTPException(404, "Share not found")
    return await _serve_poster_jpeg(_build_poster_r2_key(share))


@shared_router.post("/{share_token}/viewed", status_code=204)
async def record_shared_view(share_token: str, background_tasks: BackgroundTasks):
    """T4840: fire-and-forget view beacon for the edge-rendered share page.

    The edge Pages Function edge-caches the share JSON, so `get_shared_video`
    no longer runs on every view. This tiny endpoint lets the edge page record
    a `share_viewed` milestone on EVERY render (cache hits included) so view
    analytics don't regress. No auth -- public shares are viewed anonymously
    today, and `record_milestone` is scheduled in the background exactly as
    `get_shared_video` now does. Unknown token -> 404; otherwise 204.
    """
    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        # Revoked shares no longer render on the edge; don't record a view.
        return Response(status_code=204)

    background_tasks.add_task(
        record_milestone,
        share["sharer_user_id"],
        "share_viewed",
        {"share_token": share_token, "sharer_user_id": share["sharer_user_id"]},
    )
    return Response(status_code=204)


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
