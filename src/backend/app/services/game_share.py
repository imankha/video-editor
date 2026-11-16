"""
One share flow for games (T4640).

POST /api/games/{id}/share (share_game) and POST /api/games/{id}/share-playback
(share_playback) run the same steps once the endpoint has loaded the game and
picked each recipient's clips: create a share row per recipient, warm the recap
poster, send the emails (revoking a share whose email failed), and -- only when
every email went out -- deliver each share: materialize it into a single-profile
recipient's account, or leave a pending-share row for a non-user, a multi-profile
user, or a recipient whose DB can't be confirmed right now.

The endpoints differ only in what they pass in: the email function, the
existing-share lookup (share_playback reuses an active share instead of creating
a second one), the per-recipient clips, the tag_name channel value and the extra
share-row fields.

Collaborators are imported inside the function, like the endpoints did before
this flow existed: tests patch them on their source modules.
"""

import asyncio
import contextlib
import logging
import os
from collections.abc import Awaitable, Callable

from app.profile_context import get_current_profile_id
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)


async def share_game_flow(
    *,
    game_id: int,
    game_name: str,
    game_blake3: str | None,
    emails: list[str],
    clips_by_email: dict[str, list[dict]],
    send_email: Callable[..., Awaitable[bool]],
    find_existing_share: Callable[[str], dict | None] | None,
    tag_name: str | None,
    share_fields: dict,
    log_tag: str,
) -> dict:
    """Create, email and deliver one game share per email.

    find_existing_share(email) returns an active share to reuse (no new row, no
    email) or None; pass None to always create. share_fields are extra
    create_game_share kwargs. log_tag prefixes every log line ("[share-game]").
    Returns the endpoint's response body: {"results": [...], "all_sent": bool}.
    """
    from app.migrations import MigrationBlocked
    from app.services.auth_db import get_user_by_email, get_user_by_id
    from app.services.db_refresh import RefreshFailed
    from app.services.email import _get_share_url, _is_existing_user, _resolve_sender_name
    from app.services.materialization import (
        RecipientProfileBelowHead,
        materialize_game_share,
        serialize_clip_data,
    )
    from app.services.poster import warm_recap_poster
    from app.services.sharing_db import (
        create_game_share,
        create_pending_share,
        get_share_by_token,
        revoke_share,
    )
    from app.services.user_db import get_profiles

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    sharer = get_user_by_id(user_id)
    sharer_email = sharer["email"] if sharer else user_id
    sender_name = _resolve_sender_name(sharer_email)

    share_records = []
    for email in emails:
        duplicate = find_existing_share(email) if find_existing_share else None
        if duplicate:
            share_records.append({
                "share_token": duplicate["share_token"],
                "recipient_email": email,
                "duplicate": True,
            })
            continue
        try:
            share = create_game_share(
                game_id=game_id,
                tag_name=tag_name,
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                recipient_email=email,
                game_name=game_name,
                game_blake3=game_blake3,
                **share_fields,
            )
            share_records.append(share)
        except Exception as e:
            logger.error(f"{log_tag} Failed to create share record: {e}")
            share_records.append(None)

    if any(share_records):
        # T5270: warm the recap poster now (share-creation gesture) so the
        # crawler that pastes this link never pays the ffmpeg cost.
        await warm_recap_poster(user_id, profile_id, game_id)

    if not os.getenv("RESEND_API_KEY"):
        for email, share in zip(emails, share_records):
            if share:
                url = _get_share_url(share["share_token"], "game")
                logger.warning(f"{log_tag} DEV MODE -- {email}: {url}")

    email_results = []
    all_sent = True
    pairs = list(zip(emails, share_records))
    tasks = {}
    for email, share in pairs:
        if share and share.get("duplicate"):
            # Recipient already has an active share for this game; don't resend email.
            continue
        tasks[email] = send_email(
            recipient_email=email,
            sharer_email=sharer_email,
            game_name=game_name,
            share_token=share["share_token"] if share else None,
            sender_name=sender_name,
            is_first_touch=not _is_existing_user(email),
        )

    if tasks:
        send_results = await asyncio.gather(*tasks.values())
        for (email, share), sent in zip(pairs, send_results):
            email_results.append({"email": email, "sent": sent})
            if not sent:
                all_sent = False
                if share:
                    with contextlib.suppress(Exception):
                        revoke_share(share["share_token"], user_id)

    if not (all_sent and email_results):
        return {"results": email_results, "all_sent": all_sent}

    for email, share in pairs:
        if not share:
            continue
        # T5740: the clips this recipient's scope resolved to, up front. The
        # pending-share snapshot and the live materialize both use them so the
        # scope choice is honored on every delivery path.
        clips = clips_by_email[email]
        try:
            recipient_user = get_user_by_email(email)
            share_record = get_share_by_token(share["share_token"])
            if not share_record:
                continue

            if not recipient_user:
                reason = "non-user"
            else:
                # T4315 round 3 (MAJOR NEW-D): get_profiles(recipient_user_id)
                # is a foreign-user get_user_db_connection call -- round 2's
                # structural guard (MAJOR-4) makes it a possible R2 HEAD, so
                # it needs the same asyncio.to_thread offload as
                # materialize_game_share below, not just that call alone.
                #
                # T4315 round 5 (BLOCKING-2): get_profiles used to sit
                # OUTSIDE this try. An R2 blip there raises RefreshFailed
                # (the PARENT of ProfileDBRefreshFailed, which the round-4
                # except did not catch) straight into the outer
                # `except Exception` below -- logged and silently dropped,
                # no pending-share row, permanently unrecoverable without
                # the sharer re-sharing. Both R2-touching calls
                # (get_profiles AND materialize_game_share) are inside ONE
                # try with the SAME pending-share fallback either way --
                # correct even when the profile count is unknown (T3230 /
                # resolve-pending-shares resolves it later).
                try:
                    profiles = await asyncio.to_thread(get_profiles, recipient_user["user_id"])
                    if len(profiles) == 1:
                        # T4315 round 2 (MAJOR-2): materialize_game_share
                        # does a real R2 HEAD (require_fresh) and possibly a
                        # full profile.sqlite download -- offload so a batch
                        # of teammate emails never blocks this worker's
                        # event loop.
                        await asyncio.to_thread(
                            materialize_game_share,
                            sharer_user_id=user_id,
                            sharer_profile_id=profile_id,
                            recipient_user_id=recipient_user["user_id"],
                            recipient_profile_id=profiles[0]["id"],
                            game_id=game_id,
                            # The channel, not a teammate tag: the scope is
                            # expressed by the explicit clip_data.
                            tag_name=tag_name,
                            share_id=share_record["id"],
                            clip_data=clips,
                            sharer_email=sharer_email,
                        )
                        logger.info(f"{log_tag} Materialized for {email}")
                        continue
                    reason = "multi-profile user"
                except (RefreshFailed, RecipientProfileBelowHead, MigrationBlocked):
                    # T4315 round 4 (MINOR) + round 5 (BLOCKING-2): a refused
                    # freshness confirmation (get_profiles' foreign-user HEAD,
                    # or materialize_game_share's require_fresh / contended-
                    # checkpoint refusal) must not silently drop the share --
                    # fall back to a pending-share row so login auto-
                    # materialize (T3230) or a manual resolve-pending-shares
                    # retries it.
                    # T6780: a below-head recipient profile DB (v026 shared_by
                    # absent, deploy->migrate window) is the same "can't
                    # materialize now, defer + retry after migration" case
                    # (NOT a 503 that would fail the whole multi-recipient
                    # share for one below-head recipient).
                    # T5085: MigrationBlocked (get_profiles ->
                    # ensure_user_database, or materialize_game_share ->
                    # ensure_profile_db_local) is that same class too -- it
                    # must ride this fallback, never the bare except Exception
                    # below.
                    reason = "refused"

            create_pending_share(
                share_id=share_record["id"],
                sharer_user_id=user_id,
                sharer_profile_id=profile_id,
                invited_email=email,
                game_id=game_id,
                tag_name=tag_name,
                clip_data_bytes=serialize_clip_data(clips),
            )
            if reason == "refused":
                logger.warning(
                    f"{log_tag} Materialization refused for {email} "
                    f"(target DB unconfirmed) -- created pending share for retry"
                )
            else:
                logger.info(f"{log_tag} Created pending share for {reason} {email}")
        except Exception as e:
            logger.error(f"{log_tag} Materialization failed for {email}: {e}")

    return {"results": email_results, "all_sent": all_sent}
