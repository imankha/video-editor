"""
T1740: Privacy & consumer rights endpoints.

POST /api/privacy/export-data — CCPA data export (downloadable JSON)
DELETE /api/privacy/delete-account — CCPA full account deletion
"""

import json
import logging
import sqlite3
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.database import USER_DATA_BASE
from app.services.auth_db import (
    get_user_by_id,
)
from app.services.user_db import (
    get_all_intro_consents,
    get_all_intro_facts,
    get_all_intro_full_names,
    get_all_intro_photo_keys,
)
from app.storage import (
    APP_ENV,
    R2_BUCKET,
    R2_ENABLED,
    generate_presigned_url,
    get_r2_client,
)
from app.user_context import get_current_user_id
from app.utils.cookies import delete_cookie as _delete_cookie
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/privacy", tags=["privacy"])


def _safe_kv(reader):
    """Run a user_settings KV reader, returning {} on any failure.

    A data-export request must never 500 because one KV read raised; a missing
    map degrades to "no intro data for this profile", not an error.
    """
    try:
        return reader() or {}
    except Exception as e:
        logger.warning(f"[Privacy] intro KV read failed: {e}")
        return {}


def _read_intro_cards(conn) -> list[dict]:
    """Read a profile's intro_cards rows for the CCPA export (T5230).

    An intro card holds a minor's parent-typed free text (title/subtitle), so it
    is personal data that MUST appear in the export. The R2 image OBJECTS
    themselves are already enumerated under `r2_objects` (whole-user-prefix walk);
    this adds the DB rows that give those keys meaning plus the free text.

    Table/column guarded, permanently (T5085: this CCPA export deliberately
    stays on the "tolerate" side of the JIT seam's migrate-before-touch policy
    -- a legal export must never 500 or trigger a surprise migration write; see
    the task's policy table). A below-head profile.sqlite may lack the
    `intro_cards` table entirely or the T6570 `subtitle_text` column, so a
    missing table returns [] and a missing column is simply absent from the
    row dict — never a 500 on a data-export request.
    """
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
    ).fetchone()
    if not exists:
        return []
    cards = []
    for row in conn.execute(
        "SELECT * FROM intro_cards ORDER BY created_at DESC, id DESC"
    ).fetchall():
        card = dict(row)
        # text_elements is a msgpack BLOB (DEAD as of T6640 but old rows may hold
        # one). Decode it best-effort so the export is human-readable JSON rather
        # than raw bytes; drop it on any decode error rather than failing export.
        if "text_elements" in card:
            try:
                card["text_elements"] = decode_data(card["text_elements"]) or {}
            except Exception:
                card["text_elements"] = None
        cards.append(card)
    return cards


@router.post("/export-data")
async def export_user_data(request: Request):
    """CCPA: Download all personal data as JSON.

    Collects: auth record, user.sqlite metadata, profile metadata,
    R2 object listing with presigned download URLs.
    Does NOT include raw video file bytes (too large).
    """
    user_id = get_current_user_id()
    logger.info(f"[Privacy] Data export requested: user={user_id}")

    export = {"exported_at": datetime.utcnow().isoformat(), "user_id": user_id}

    # 1. Auth record
    user_record = get_user_by_id(user_id)
    if user_record:
        export["account"] = {
            "email": user_record.get("email"),
            "google_id": "linked" if user_record.get("google_id") else None,
            "created_at": user_record.get("created_at"),
            "terms_accepted_at": user_record.get("terms_accepted_at"),
        }

    # 2. Credit transactions (Postgres, T5840)
    try:
        from app.services.credit_ledger import get_credit_transactions
        export["credit_transactions"] = get_credit_transactions(user_id, limit=100)
    except Exception as e:
        logger.warning(f"[Privacy] Failed to read credit transactions: {e}")
        export["credit_transactions"] = []

    # 3. Profile metadata
    #
    # Player-intro personal data (T5230) is TWO-tiered: per-card free text lives
    # in each profile.sqlite (`intro_cards`), while the parental-consent
    # timestamp, position/class/team facts, full name and photo key live in the
    # per-profile user.sqlite settings KV. The KV maps are read ONCE here (keyed
    # by profile_id) and stitched onto each profile below. All of it is a minor's
    # personal data and must be exportable (CCPA right-to-know).
    intro_consents = _safe_kv(lambda: get_all_intro_consents(user_id))
    intro_facts = _safe_kv(lambda: get_all_intro_facts(user_id))
    intro_full_names = _safe_kv(lambda: get_all_intro_full_names(user_id))
    intro_photo_keys = _safe_kv(lambda: get_all_intro_photo_keys(user_id))

    def _intro_kv_for(pid: str) -> dict:
        return {
            "intro_consent_at": intro_consents.get(pid),
            "intro_photo_key": intro_photo_keys.get(pid),
            "intro_full_name": intro_full_names.get(pid),
            "intro_facts": intro_facts.get(pid, {}),
        }

    profiles_dir = USER_DATA_BASE / user_id / "profiles"
    export["profiles"] = []
    seen_profile_ids: set[str] = set()
    if profiles_dir.exists():
        for profile_db in profiles_dir.glob("*/profile.sqlite"):
            profile_id = profile_db.parent.name
            seen_profile_ids.add(profile_id)
            profile_data = {
                "profile_id": profile_id,
                "games": [],
                "projects": [],
                "intro_cards": [],
                **_intro_kv_for(profile_id),
            }
            try:
                conn = sqlite3.connect(str(profile_db))
                conn.row_factory = sqlite3.Row

                games = conn.execute(
                    "SELECT name, blake3_hash, created_at FROM games ORDER BY created_at DESC"
                ).fetchall()
                profile_data["games"] = [dict(g) for g in games]

                projects = conn.execute(
                    "SELECT id, name, created_at FROM projects ORDER BY created_at DESC"
                ).fetchall()
                profile_data["projects"] = [dict(p) for p in projects]

                profile_data["intro_cards"] = _read_intro_cards(conn)

                conn.close()
            except Exception as e:
                logger.warning(f"[Privacy] Failed to read profile {profile_id}: {e}")
            export["profiles"].append(profile_data)

    # Intro consent/facts/photo live in user.sqlite, which is present even when a
    # profile's profile.sqlite is not locally cached (so the glob above missed
    # it). Emit those profiles too so a minor's consent/facts are never silently
    # omitted from the export.
    for pid in set(intro_consents) | set(intro_facts) | set(intro_full_names) | set(intro_photo_keys):
        if pid in seen_profile_ids:
            continue
        export["profiles"].append({
            "profile_id": pid,
            "games": [],
            "projects": [],
            "intro_cards": [],
            **_intro_kv_for(pid),
        })

    # 4. R2 object listing with presigned URLs
    export["r2_objects"] = []
    if R2_ENABLED:
        try:
            client = get_r2_client()
            if client:
                prefix = f"{APP_ENV}/users/{user_id}/"
                paginator = client.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
                    for obj in page.get("Contents", []):
                        key = obj["Key"]
                        relative = key[len(prefix):]
                        url = generate_presigned_url(user_id, relative, expires_in=86400)
                        export["r2_objects"].append({
                            "key": relative,
                            "size_bytes": obj["Size"],
                            "last_modified": obj["LastModified"].isoformat(),
                            "download_url": url,
                        })
        except Exception as e:
            logger.error(f"[Privacy] R2 listing failed: {e}")

    content = json.dumps(export, indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="reelballers-data-export-{user_id[:8]}.json"'
        },
    )


@router.delete("/delete-account")
async def delete_account(request: Request):
    """CCPA: Full account deletion. Permanent and immediate.

    Deletes: R2 objects, local files, auth DB records, sessions.
    Modeled after _reset_test_account() in auth.py.
    """
    user_id = get_current_user_id()
    logger.info(f"[Privacy] Account deletion requested: user={user_id}")

    # 1. Purge local + R2 + in-process caches + sessions. This is the step that
    #    guarantees a reregister for the same identity starts fresh: the R2 copy of
    #    user.sqlite is what resurrects a zombie account (bugs 33/34/35). Raises on R2
    #    error -> report failure instead of a partial (resurrectable) deletion.
    from app.routers.auth import _purge_user_data
    try:
        _purge_user_data(user_id)
    except Exception as e:
        logger.error(f"[Privacy] Storage purge failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete cloud storage data") from e

    # 2. Best-effort Postgres identity-row cleanup. The storage purge above already
    #    guarantees a fresh reregister (bugs 33/34/35) even if these rows survive, so it
    #    runs AFTER the purge. NOTE: `users` still has a plain (no ON DELETE CASCADE) FK
    #    from `shares.sharer_user_id`, so DELETE FROM users can still raise for a user who
    #    owns a share -> 500 with storage already gone. That FK gap is PRE-EXISTING and
    #    tracked separately (needs owned-row cleanup or ON DELETE CASCADE via a Postgres
    #    migration — blast radius on recipients of the user's shares makes it a deliberate
    #    design call); it does NOT reintroduce the zombie, because R2 is purged regardless
    #    of the users row. (T6770: the matching `game_storage_refs` FK is now covered --
    #    _purge_user_data deletes the user's game_storage_refs rows before this runs, since
    #    that table is now the LIVE derived ref-set, not the dead pre-T2930 table it was.)
    try:
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM referrals WHERE referrer_id = %s OR referred_id = %s", (user_id, user_id))
            # T5840: credits/credit_transactions/credit_reservations are purged
            # by _purge_user_data above (shared with DELETE /api/auth/user) --
            # do not duplicate the deletes here.
            cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
        logger.info(f"[Privacy] Cleared auth DB records for user={user_id}")
    except Exception as e:
        logger.error(f"[Privacy] Auth DB cleanup failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete account records") from e

    # 3. Clear session cookie
    response = JSONResponse(content={"deleted": True, "user_id": user_id})
    _delete_cookie(response, "rb_session")

    logger.info(f"[Privacy] Account fully deleted: user={user_id}")
    return response
