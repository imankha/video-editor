"""
T1740: Privacy & consumer rights endpoints.

POST /api/privacy/export-data — CCPA data export (downloadable JSON)
DELETE /api/privacy/delete-account — CCPA full account deletion
"""

import json
import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from app.database import USER_DATA_BASE
from app.storage import (
    APP_ENV,
    R2_BUCKET,
    R2_ENABLED,
    generate_presigned_url,
    get_r2_client,
)
from app.services.auth_db import (
    get_user_by_id,
    invalidate_user_sessions,
)
from app.user_context import get_current_user_id
from app.utils.cookies import delete_cookie as _delete_cookie

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/privacy", tags=["privacy"])


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

    # 2. User DB data (credits, transactions)
    user_db_path = USER_DATA_BASE / user_id / "user.sqlite"
    if user_db_path.exists():
        try:
            conn = sqlite3.connect(str(user_db_path))
            conn.row_factory = sqlite3.Row

            # Credit transactions
            rows = conn.execute(
                "SELECT * FROM credit_transactions ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            export["credit_transactions"] = [dict(r) for r in rows]

            conn.close()
        except Exception as e:
            logger.warning(f"[Privacy] Failed to read user DB: {e}")
            export["credit_transactions"] = []

    # 3. Profile metadata
    profiles_dir = USER_DATA_BASE / user_id / "profiles"
    export["profiles"] = []
    if profiles_dir.exists():
        for profile_db in profiles_dir.glob("*/profile.sqlite"):
            profile_id = profile_db.parent.name
            profile_data = {"profile_id": profile_id, "games": [], "projects": []}
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

                conn.close()
            except Exception as e:
                logger.warning(f"[Privacy] Failed to read profile {profile_id}: {e}")
            export["profiles"].append(profile_data)

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

    # 1. Delete R2 objects
    if R2_ENABLED:
        try:
            client = get_r2_client()
            if client:
                prefix = f"{APP_ENV}/users/{user_id}/"
                paginator = client.get_paginator("list_objects_v2")
                deleted_count = 0
                for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
                    objects = page.get("Contents", [])
                    if objects:
                        keys = [{"Key": obj["Key"]} for obj in objects]
                        client.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": keys})
                        deleted_count += len(keys)
                logger.info(f"[Privacy] Deleted {deleted_count} R2 objects for user={user_id}")
        except Exception as e:
            logger.error(f"[Privacy] R2 deletion failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to delete cloud storage data")

    # 2. Delete local user folder
    user_path = USER_DATA_BASE / user_id
    if user_path.exists():
        shutil.rmtree(user_path)
        logger.info(f"[Privacy] Deleted local folder: {user_path}")

    # 3. Delete auth DB records (sessions + user)
    try:
        invalidate_user_sessions(user_id)
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
            cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
        logger.info(f"[Privacy] Cleared auth DB records for user={user_id}")
    except Exception as e:
        logger.error(f"[Privacy] Auth DB cleanup failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete account records")

    # 4. Clear session cookie
    response = JSONResponse(content={"deleted": True, "user_id": user_id})
    _delete_cookie(response, "rb_session")

    logger.info(f"[Privacy] Account fully deleted: user={user_id}")
    return response
