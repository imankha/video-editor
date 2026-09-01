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
import os
import tempfile
from datetime import datetime
from typing import Union

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..analytics import record_milestone
from ..database import get_db_connection
from ..migrations import MigrationBlocked
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
    download_from_r2_global,
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
    # T5130: the publishing profile's sport, frozen onto the share row at
    # creation time (shares.sharer_default_sport, v018/T2915). Lets the public
    # viewer render the sport-ball scrub handle without a live cross-user read.
    # None for a sharer whose sport is unknown -> the viewer keeps the plain dot.
    sport: str | None = None
    # T5220 Scope B: the sharer's LIVE intro attachment, serialized as the
    # {card, previewUrl, field_values, profile} payload IntroPreRoll/
    # MotionPreview already consume (design §5.4). None when nothing resolves
    # (opted out, no card, or the resolution failed non-fatally) -- the
    # frontend simply does not mount a pre-roll.
    intro: dict | None = None


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


# --- Public game link (T5720) ------------------------------------------------
# The anonymous-scope guarantee is STRUCTURAL: these models declare ONLY
# team-layer, public-safe fields. There is deliberately NO game_url / game_blake3
# / video_warm_url / full-game field anywhere in them, so a future careless edit
# that computes a full-game value has nowhere to serialize it -- FastAPI drops
# anything not declared here at the response boundary. Anonymous visitors watch
# the TEAM RECAP ONLY (EPIC decision 3). Do NOT add a game-source field here.

class PublicGameClip(BaseModel):
    name: str
    recap_start: float | None = None
    recap_end: float | None = None
    player_tags: list[str] = []


class PublicGameLinkResponse(BaseModel):
    share_token: str
    is_public: bool = True  # a game_link is public by definition
    game_name: str
    game_date: str | None = None
    sharer_name: str
    recap_url: str | None  # presigned TEAM recap master -- NEVER the game source
    poster_url: str  # stable proxy path, never presigned (T5180)
    clips: list[PublicGameClip] = []
    clip_count: int


# --- Claim & import (T5730) --------------------------------------------------
# The frozen claim contract from T5720 §7 / the Dual-Camera epic. `share_token`
# is carried for the shared identifier but the PATH token is authoritative;
# `import_annotations` is the consent opt-in (game always, annotations optional);
# `target_profile_id` is the explicit athlete pick for multi-profile accounts
# (single-profile accounts omit it).
class ClaimGameRequest(BaseModel):
    share_token: str | None = None
    import_annotations: bool = True
    target_profile_id: str | None = None


class ClaimGameResponse(BaseModel):
    game_id: int
    profile_id: str
    already_claimed: bool
    imported_annotations: bool


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

    if APP_ENV != "production":
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

    if APP_ENV != "production":
        return request.headers.get("X-User-ID")
    return None


def _sharer_r2_prefix(share: dict) -> str:
    """The SHARER's R2 folder prefix (`{env}/users/{uid}/profiles/{pid}`) for
    Modal-dispatched compose (T7090 Phase 3). The share objects live under the
    sharer's profile, NOT the viewer's -- so this is built EXPLICITLY from the
    share row, never from the request ContextVar (which is the viewer's/none)."""
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
    )


def _build_video_r2_key(share: dict) -> str:
    return (
        f"{_sharer_r2_prefix(share)}"
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


def _recap_r2_key(share: dict) -> str:
    """Full R2 key for a game share's recap master under the SHARER's profile
    prefix (`recaps/{game_id}.mp4`, hi-q since T4140)."""
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/recaps/{share['game_id']}.mp4"
    )


def _resolve_share_video_intro(share: dict, *, mode: str):
    """LIVE-resolve the sharer's CURRENT intro attachment for a share's video
    (design §3 rows 2/3, the asymmetric-by-design counterpart to the
    collection path's FROZEN resolution). Opens the sharer's profile.sqlite
    read-only, reads `final_videos.intro_card_id`/`duration` for THIS video
    (the reel's live values, never the share row's own frozen
    `video_duration` snapshot -- the duration GATE must see the same value
    the owner-download path would), then delegates to the same
    `resolve_intro_for_reel` cross-DB assembly every burn/playback egress
    path uses so paths 1/2/3 never diverge in how they read facts.

    `mode`: "playback" (share GET, presigned previewUrl) or "burn" (share
    download, local image path for `compose_serve_time`).

    `mode="playback"` also stamps the reel's own `aspect_ratio` onto the
    returned payload as `aspect` (Stage 4.5 reviewer finding) -- without it
    `IntroPreRoll` has no way to know a landscape reel's intro card should
    render 16:9 rather than defaulting to 9:16, and would show a
    letterboxed portrait card ahead of a landscape video.

    NEVER raises: any failure (DB unreachable, row missing, resolution error)
    degrades to None and logs -- a share resolve/download must never break
    because of the intro.
    """
    from app.services.intro_egress import resolve_intro_for_reel
    from app.services.materialization import open_profile_db_readonly

    try:
        conn = open_profile_db_readonly(share["sharer_user_id"], share["sharer_profile_id"])
    except MigrationBlocked as e:
        # T5085: open_profile_db_readonly now migrates-before-touch and can
        # raise -- this function's documented contract is "never raises",
        # same treatment as conn is None below.
        logger.info(
            f"[shares] sharer profile DB blocked at migration seam ({e.reason}) "
            f"(share_token={share.get('share_token')}) -- serving without intro"
        )
        return None
    if conn is None:
        logger.info(
            f"[shares] could not open sharer profile DB for intro resolution "
            f"(share_token={share.get('share_token')}) -- serving without intro"
        )
        return None
    try:
        row = conn.execute(
            "SELECT intro_card_id, duration, aspect_ratio FROM final_videos WHERE id = ?",
            (share["video_id"],),
        ).fetchone()
        if row is None:
            return None
        payload = resolve_intro_for_reel(
            share["sharer_user_id"], share["sharer_profile_id"],
            row["intro_card_id"], row["duration"], share["video_id"],
            mode=mode, profile_conn=conn,
        )
        if mode == "playback" and payload is not None and row["aspect_ratio"]:
            payload["aspect"] = row["aspect_ratio"]
        return payload
    except Exception as e:
        logger.error(
            f"[shares] intro resolution failed for share_token={share.get('share_token')}: {e}",
            exc_info=True,
        )
        return None
    finally:
        conn.close()


def _resolve_share_metadata(share: dict) -> dict | None:
    """T6360: assemble the download metadata field map + poster ref for a shared
    reel, from the SHARER's profile DB (read-only), reusing the SAME
    `build_download_metadata` the owner-download path uses so tags never diverge
    across egress points. Never raises; None when the sharer DB can't be opened."""
    from app.services.download_metadata import build_download_metadata
    from app.services.materialization import open_profile_db_readonly

    try:
        conn = open_profile_db_readonly(share["sharer_user_id"], share["sharer_profile_id"])
    except MigrationBlocked as e:
        logger.info(
            f"[shares] sharer profile DB blocked at migration seam ({e.reason}) "
            f"(share_token={share.get('share_token')}) -- serving without metadata"
        )
        return None
    if conn is None:
        logger.info(
            f"[shares] could not open sharer profile DB for metadata "
            f"(share_token={share.get('share_token')}) -- serving without metadata"
        )
        return None
    try:
        return build_download_metadata(
            conn, share["video_id"],
            share["sharer_user_id"], share["sharer_profile_id"],
        )
    except Exception as e:
        logger.error(
            f"[shares] metadata assembly failed for share_token={share.get('share_token')}: {e}",
            exc_info=True,
        )
        return None
    finally:
        conn.close()


def _stamp_shared_download(serve_path: str, tmp_dir: str, share: dict) -> str:
    """Download the sharer's poster (when present) into `tmp_dir` and run the
    T6360 metadata/cover-art stamping pass over the composed share download.
    Returns the path to stream (stamped on success, `serve_path` otherwise).
    Blocking (R2 + ffmpeg) -- callers wrap in `asyncio.to_thread`. Never raises."""
    from pathlib import Path

    from app.services.download_metadata import apply_download_metadata

    meta = _resolve_share_metadata(share)
    if not meta:
        return serve_path
    poster_key = _build_poster_r2_key(share)
    if r2_head_object_global(poster_key) is not None:
        cover_local = os.path.join(tmp_dir, "cover.jpg")
        if download_from_r2_global(poster_key, Path(cover_local)):
            meta["cover_path"] = cover_local
    return apply_download_metadata(serve_path, tmp_dir, meta)


def _recap_poster_r2_key(share: dict) -> str:
    """Full R2 key for a game share's recap POSTER (T5180). Deterministic key,
    generate-on-first-request, overwrite-safe -- mirrors the reel poster prefix
    convention (`recaps/posters/{game_id}.jpg`)."""
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/recaps/posters/{share['game_id']}.jpg"
    )


def _team_recap_r2_key(share: dict) -> str:
    """Full R2 key for a game link's TEAM recap master (T5720,
    `recaps/{game_id}_team.mp4`) under the sharer's profile prefix."""
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/recaps/{share['game_id']}_team.mp4"
    )


def _team_recap_poster_r2_key(share: dict) -> str:
    """Full R2 key for a game link's TEAM recap POSTER (T5720,
    `recaps/posters/{game_id}_team.jpg`) under the sharer's profile prefix."""
    return (
        f"{APP_ENV}/users/{share['sharer_user_id']}"
        f"/profiles/{share['sharer_profile_id']}"
        f"/recaps/posters/{share['game_id']}_team.jpg"
    )


def _resolve_recap_poster_url(share: dict) -> str | None:
    """Stable teammate-poster proxy URL when a recap frame is available, else None
    (T5180). A poster is available iff its object is already cached OR the recap
    source exists (the /poster.jpg endpoint generates it on first request). Never
    a presigned URL -- the edge function absolutizes this relative path with its
    API base. No recap -> None so the edge keeps the branded card (never a broken
    image)."""
    if not share.get("game_id"):
        return None
    if (
        r2_head_object_global(_recap_poster_r2_key(share)) is not None
        or r2_head_object_global(_recap_r2_key(share)) is not None
    ):
        return f"/api/shared/teammate/{share['share_token']}/poster.jpg"
    logger.info(
        f"[Share] no recap for teammate token={share.get('share_token')}; "
        f"branded card fallback"
    )
    return None


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

    # T5180: real recap frame for the unfurl (og:image) when a recap exists;
    # None -> the edge function keeps the branded card. Stable proxy URL only.
    poster_url = _resolve_recap_poster_url(share)

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
            "poster_url": poster_url,
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
        "poster_url": poster_url,
    }


@shared_router.get("/game/{share_token}", response_model=PublicGameLinkResponse)
async def get_shared_game_link(
    share_token: str, background_tasks: BackgroundTasks,
):
    """Public resolver for a broadcast game link (T5720). No auth.

    Anonymous scope is the TEAM RECAP ONLY: this builds a PublicGameLinkResponse
    (a model with NO full-game field), presigns the TEAM recap master, and draws
    the clip rail from the snapshot frozen on the share row at creation. No
    game-source URL, no athlete-layer data, ever leaves here (EPIC decision 3).
    Revoked -> 410; not a game_link / unknown -> 404. Expired game SOURCE does
    not matter: the team recap survives expiry and keeps playing (recap-only
    degradation, NOT T3970's hard block)."""
    from ..services.email import _resolve_sender_name

    share = get_game_share_by_token(share_token)
    if not share or share["share_type"] != "game_link":
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This link is no longer active")

    sharer = get_user_by_id(share["sharer_user_id"])
    sharer_email = sharer["email"] if sharer else share["recipient_email"]
    # Public page: show a friendly display name, never the raw email.
    sharer_name = _resolve_sender_name(sharer_email)

    # Presign the TEAM recap master ONLY -- never the game source. None (recap
    # object evicted) is an explicit state: the edge requires recap_url and
    # falls through to the SPA, which shows a graceful message.
    recap_url = generate_presigned_url_global(_team_recap_r2_key(share), expires_in=14400)

    clip_names = share["clip_names"] or []
    clips = [
        PublicGameClip(
            name=c.get("name") or "Clip",
            recap_start=c.get("recap_start"),
            recap_end=c.get("recap_end"),
            player_tags=c.get("player_tags") or [],
        )
        for c in clip_names
        if isinstance(c, dict)
    ]

    # T4840: record the view off the response path (analytics never on the wire).
    background_tasks.add_task(
        record_milestone,
        share["sharer_user_id"],
        "share_viewed",
        {"share_token": share_token, "sharer_user_id": share["sharer_user_id"],
         "share_type": "game_link"},
    )

    return PublicGameLinkResponse(
        share_token=share_token,
        game_name=share["game_name"] or "Shared Game",
        game_date=share["game_date"],
        sharer_name=sharer_name,
        recap_url=recap_url,
        poster_url=f"/api/shared/game/{share_token}/poster.jpg",
        clips=clips,
        clip_count=len(clips),
    )


@shared_router.get("/game/{share_token}/poster.jpg")
async def get_shared_game_poster(share_token: str):
    """Stable unfurl image for a public game link: the TEAM recap's clearest
    frame (T5720). Generated-on-first-request at `recaps/posters/{game_id}_team.jpg`
    then reused; never a presigned URL in og:image (T4890). 404 when no team
    recap exists -> the edge keeps the branded card (never a broken image)."""
    from ..services.poster import ensure_recap_poster

    share = get_game_share_by_token(share_token)
    if (
        not share
        or share["revoked_at"]
        or share["share_type"] != "game_link"
        or not share.get("game_id")
    ):
        raise HTTPException(404, "Share not found")

    team_poster_key = _team_recap_poster_r2_key(share)
    if not ensure_recap_poster(_team_recap_r2_key(share), team_poster_key):
        raise HTTPException(404, "No recap poster for this share")
    return await _serve_poster_jpeg(team_poster_key)


@shared_router.post("/game/{share_token}/viewed", status_code=204)
async def record_shared_game_view(share_token: str, background_tasks: BackgroundTasks):
    """T4840: fire-and-forget view beacon for the edge-rendered game watch page.
    The edge caches the resolve JSON, so this records a `share_viewed` milestone
    on EVERY render (cache hits included). Unknown token -> 404; revoked -> 204
    with no record; otherwise 204."""
    share = get_game_share_by_token(share_token)
    if not share or share["share_type"] != "game_link":
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        return Response(status_code=204)

    background_tasks.add_task(
        record_milestone,
        share["sharer_user_id"],
        "share_viewed",
        {"share_token": share_token, "sharer_user_id": share["sharer_user_id"],
         "share_type": "game_link"},
    )
    return Response(status_code=204)


@shared_router.post("/game/{share_token}/claim", response_model=ClaimGameResponse)
async def claim_shared_game(
    share_token: str, body: ClaimGameRequest, request: Request,
):
    """Claim a public game link into the caller's account (T5730).

    A signed-in user GESTURE -- never a silent materialize on auth (EPIC decision
    8). The deferred no-account path completes here after signup, via the import
    dialog's explicit Confirm. Game is always imported; team annotations are
    opt-in (`import_annotations`). Multi-profile accounts pick the athlete profile
    (`target_profile_id`); single-profile accounts omit it.

    Routes through materialize_game_share so the copied game + clips inherit a
    NON-NULL `shared_by` (T5330 -- onboarding stays blind to imported content).
    Idempotent: claim twice -> same local game; a re-claim with annotations after a
    game-only claim adds the Team-layer clips to that same game.

    Errors: 401 (not signed in -- /api/shared is public, so this is enforced
    here), 404 (unknown / not a game_link), 410 (revoked), 400 (missing/foreign
    profile), 503 (R2 sync could not be confirmed -- retryable, never a lying 200)."""
    import asyncio

    from app.services.db_refresh import RefreshFailed
    from app.services.materialization import claim_game_link
    from app.services.user_db import get_profiles

    # Auth required. The /api/shared prefix is allowlisted (public resolve), so an
    # unauthenticated request lands here with no user context -> explicit 401.
    user_id = _get_user_id_from_request(request)
    if not user_id:
        raise HTTPException(401, "Sign in to claim this game")

    share = get_game_share_by_token(share_token)
    if not share or share["share_type"] != "game_link":
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This link is no longer active")

    # Resolve the target profile: explicit pick, or the sole profile for a
    # single-profile account. A missing pick on a multi-profile account, or a
    # foreign id, is a loud 400 -- never a silent default into the wrong athlete.
    profiles = await asyncio.to_thread(get_profiles, user_id)
    profile_ids = {p["id"] for p in profiles}
    target = body.target_profile_id
    if target:
        if target not in profile_ids:
            raise HTTPException(400, "Unknown profile")
    elif len(profiles) == 1:
        target = profiles[0]["id"]
    else:
        raise HTTPException(400, "Choose a profile to import this game into")

    sharer = get_user_by_id(share["sharer_user_id"])
    sharer_email = sharer["email"] if sharer else share["recipient_email"]

    try:
        # Blocking R2 I/O (sharer DB pull + recipient materialize/sync) -- offload
        # so this doesn't serialize the event loop (T6200).
        result = await asyncio.to_thread(
            claim_game_link,
            share=share,
            claimer_user_id=user_id,
            claimer_profile_id=target,
            include_annotations=body.import_annotations,
            sharer_email=sharer_email,
        )
    except (RefreshFailed, MigrationBlocked) as e:
        # A profile DB could not be confirmed current / synced, or is below
        # head and could not be migrated (T5085) -- retryable, not a partial
        # success. Mirrors the payments-grant 503 contract.
        raise HTTPException(
            status_code=503,
            detail={"code": "sync_failed",
                    "message": "Could not import right now, please retry."},
        ) from e

    return ClaimGameResponse(
        # profile_id is the profile the game ACTUALLY landed in (claim_game_link
        # may override the pick on an annotations-upgrade re-claim), so the client
        # lands on the right profile's recap.
        game_id=result["game_id"],
        profile_id=result.get("profile_id") or target,
        already_claimed=result["already_claimed"],
        imported_annotations=result["imported_annotations"],
    )


@shared_router.get("/collection/{share_token}")
async def get_shared_collection(share_token: str, request: Request, background_tasks: BackgroundTasks):
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

    # T4315 round 4 (MAJOR-1): record_milestone(sharer_user_id, ...) is a
    # foreign-user get_user_db_connection call (the viewer is rarely the
    # sharer) -- round 2's structural guard (MAJOR-4) makes it a possible R2
    # HEAD/download. round 3's asyncio.to_thread kept the event loop free for
    # OTHER requests but this handler still AWAITED it, so the response
    # itself still waited on the HEAD. Match the sibling route (:488, T4840):
    # background_tasks.add_task truly gets it off the response path.
    background_tasks.add_task(
        record_milestone,
        share["sharer_user_id"],
        "share_viewed",
        {
            "share_token": share_token,
            "sharer_user_id": share["sharer_user_id"],
            "share_type": "collection",
        },
    )

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
    intro = await asyncio.to_thread(_resolve_share_video_intro, share, mode="playback")

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
        sport=share["sharer_default_sport"],
        intro=intro,
    )


@shared_router.get("/{share_token}/download")
async def download_shared_video(share_token: str, request: Request):
    """T5220 Scope C: the share-download egress that closes the pre-existing
    gap (`SharedVideoOverlay.handleDownload` used to `fetch(share.video_url)`
    directly at the raw R2 object -- no outro, no intro). Token-gated
    identically to `get_shared_video`; streams the SAME composed
    `[intro?][reel][outro?]` a burn download gets via `compose_serve_time`,
    resolved LIVE from the sharer's current attachment (never the caller's).
    Non-fatal at every rung -- HTTP 200 whenever the reel itself is readable.
    """
    share = get_share_by_token(share_token)
    if not share:
        raise HTTPException(404, "Share not found")
    if share["revoked_at"]:
        raise HTTPException(410, "This share has been revoked")

    if not share["is_public"]:
        email = _get_email_from_request(request)
        if not email or email.lower() != share["recipient_email"].lower():
            raise HTTPException(403, "Access denied")

    presigned_url = generate_presigned_url_global(_build_video_r2_key(share))
    if not presigned_url:
        raise HTTPException(status_code=404, detail="Video file not found in storage")

    from .downloads import generate_download_filename
    download_filename = generate_download_filename(share["video_name"])
    dl_headers = {
        "Content-Disposition": f'attachment; filename="{download_filename}"',
        "Cache-Control": "no-cache",
    }

    async def _stream_shared_composed():
        import shutil as _shutil

        import httpx

        tmp_dir = tempfile.mkdtemp(prefix="rb_share_dl_compose_")
        try:
            original_path = os.path.join(tmp_dir, "original.mp4")
            out_path = os.path.join(tmp_dir, "composed.mp4")

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=10.0)
            ) as client, client.stream("GET", presigned_url) as response:
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"R2 returned {response.status_code}",
                    )
                with open(original_path, "wb") as fout:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        fout.write(chunk)

            serve_path = original_path
            intro = await asyncio.to_thread(_resolve_share_video_intro, share, mode="burn")
            try:
                # T7090 Phase 3: dispatch the compose (Modal when enabled, local
                # otherwise). The R2 scratch objects belong to the SHARER, so pass
                # the sharer's explicit prefix -- never the viewer's ContextVar.
                from app.services.serve_time_video import compose_serve_time_dispatched
                if await asyncio.to_thread(
                    compose_serve_time_dispatched, original_path, out_path,
                    user_id=share["sharer_user_id"], user_prefix=_sharer_r2_prefix(share),
                    intro=intro, outro=True,
                ):
                    serve_path = out_path
            except Exception as exc:
                logger.error(
                    f"[shares] compose failed for share_token={share_token}: {exc}"
                )
            finally:
                if intro is not None:
                    intro.cleanup()

            serve_path = await asyncio.to_thread(
                _stamp_shared_download, serve_path, tmp_dir, share,
            )

            with open(serve_path, "rb") as fin:
                while True:
                    chunk = fin.read(1024 * 1024)
                    if not chunk:
                        break
                    yield chunk
        finally:
            _shutil.rmtree(tmp_dir, ignore_errors=True)

    return StreamingResponse(
        _stream_shared_composed(),
        media_type="video/mp4",
        headers=dl_headers,
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


@shared_router.get("/teammate/{share_token}/poster.jpg")
async def get_shared_teammate_poster(share_token: str):
    """Stable unfurl image for a TEAMMATE (game) share: the game recap's clearest
    frame (T5180). Generated-on-first-request and cached at the deterministic key
    `recaps/posters/{game_id}.jpg`, then reused. Whole-clip clearest-frame policy
    (recaps have no slow-mo data). Never a presigned URL in og:image (T4890). 404
    when no recap exists/reclaimed -> the edge function falls back to the branded
    card (never a broken image)."""
    share = get_game_share_by_token(share_token)
    if (
        not share
        or share["revoked_at"]
        or share["share_type"] not in ("game", "annotation_playback")
        or not share.get("game_id")
    ):
        raise HTTPException(404, "Share not found")

    from ..services.poster import ensure_recap_poster
    recap_poster_key = _recap_poster_r2_key(share)
    if not ensure_recap_poster(_recap_r2_key(share), recap_poster_key):
        raise HTTPException(404, "No recap poster for this share")
    return await _serve_poster_jpeg(recap_poster_key)


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
