"""Admin bug-report endpoints (T3100): list, inspect, correlate, triage, purge.

Split out of routers/admin.py by T5940; every URL is unchanged."""

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ...services.pg import get_pg
from . import require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------------------------------------------------------------------------
# Bug reports (T3100)
# ---------------------------------------------------------------------------

BUG_STATUSES = {"new", "testing", "done", "duplicate"}


@router.get("/bugs")
async def list_bugs(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List bug reports, optionally filtered by status. Paginated. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()

        where_clause = ""
        params: list = []
        if status:
            statuses = [s.strip() for s in status.split(",") if s.strip() in BUG_STATUSES]
            if statuses:
                where_clause = "WHERE status = ANY(%s)"
                params.append(statuses)

        cur.execute(f"SELECT COUNT(*) AS cnt FROM bug_reports {where_clause}", params)
        total = cur.fetchone()["cnt"]
        total_pages = max(1, math.ceil(total / page_size))
        page = min(page, total_pages)

        offset = (page - 1) * page_size
        cur.execute(f"""
            SELECT id, reporter_email, description, page_url, build, status,
                   editor_context, duplicate_of, created_at
            FROM bug_reports {where_clause}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
        """, [*params, page_size, offset])
        rows = cur.fetchall()

    bugs = []
    for row in rows:
        desc = row["description"]
        mode = None
        if row["editor_context"] and isinstance(row["editor_context"], dict):
            mode = row["editor_context"].get("mode")
        bugs.append({
            "id": row["id"],
            "reporter_email": row["reporter_email"],
            "description": desc[:200] if desc else None,
            "page_url": row["page_url"],
            "build": row["build"],
            "status": row["status"],
            "editor_mode": mode,
            "duplicate_of": row["duplicate_of"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    return {"bugs": bugs, "total": total, "page": page, "total_pages": total_pages}


@router.get("/bugs/{bug_id}")
async def get_bug(bug_id: int):
    """Get full bug detail including all JSONB fields and presigned screenshot URL. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM bug_reports WHERE id = %s", (bug_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Bug not found")

    from ...storage import generate_presigned_url_global

    screenshot_url = None
    if row["screenshot_r2_key"]:
        screenshot_url = generate_presigned_url_global(row["screenshot_r2_key"])

    logs_url = None
    if row.get("logs_r2_key"):
        logs_url = generate_presigned_url_global(row["logs_r2_key"])

    result = dict(row)
    for field in ("created_at", "updated_at", "resolved_at"):
        if result[field]:
            result[field] = result[field].isoformat()
    result["screenshot_url"] = screenshot_url
    result["logs_url"] = logs_url

    return result


@router.get("/bugs/{bug_id}/correlated")
async def get_correlated_bugs(bug_id: int):
    """Get all bugs in a duplicate cluster with metadata for delta analysis."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, duplicate_of FROM bug_reports WHERE id = %s", (bug_id,))
        bug = cur.fetchone()
        if not bug:
            raise HTTPException(status_code=404, detail="Bug not found")

        primary_id = bug["duplicate_of"] or bug["id"]

        cur.execute("""
            SELECT id, reporter_email, description, build, editor_context,
                   actions, console_logs, screenshot_r2_key, logs_r2_key,
                   status, duplicate_of, created_at
            FROM bug_reports
            WHERE id = %s OR duplicate_of = %s
            ORDER BY created_at ASC
        """, (primary_id, primary_id))
        cluster = cur.fetchall()

    if len(cluster) <= 1:
        return {"primary_id": primary_id, "cluster_size": len(cluster), "bugs": []}

    from ...storage import generate_presigned_url_global

    bugs = []
    for row in cluster:
        errors = []
        if row["console_logs"] and isinstance(row["console_logs"], list):
            for entry in row["console_logs"]:
                if isinstance(entry, dict) and entry.get("level") == "error":
                    msg = entry.get("message", "")
                    if msg and msg not in errors:
                        errors.append(msg)

        action_types = []
        if row["actions"] and isinstance(row["actions"], list):
            action_types = [
                a.get("type", a.get("action", "unknown"))
                for a in row["actions"] if isinstance(a, dict)
            ]

        screenshot_url = None
        if row["screenshot_r2_key"]:
            screenshot_url = generate_presigned_url_global(row["screenshot_r2_key"])

        logs_url = None
        if row.get("logs_r2_key"):
            logs_url = generate_presigned_url_global(row["logs_r2_key"])

        mode = None
        if row["editor_context"] and isinstance(row["editor_context"], dict):
            mode = row["editor_context"].get("mode")

        bugs.append({
            "id": row["id"],
            "is_primary": row["id"] == primary_id,
            "reporter_email": row["reporter_email"],
            "description": row["description"] or "",
            "build": row["build"],
            "editor_mode": mode,
            "editor_context": row["editor_context"],
            "action_types": action_types,
            "action_count": len(action_types),
            "error_messages": errors,
            "has_screenshot": bool(row["screenshot_r2_key"]),
            "screenshot_url": screenshot_url,
            "has_logs": bool(row.get("logs_r2_key")),
            "logs_url": logs_url,
            "status": row["status"],
            "duplicate_of": row["duplicate_of"],
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        })

    return {
        "primary_id": primary_id,
        "cluster_size": len(cluster),
        "bugs": bugs,
    }


class BugUpdateRequest(BaseModel):
    status: str | None = None
    admin_notes: str | None = None
    duplicate_of: int | None = None


@router.patch("/bugs/{bug_id}")
async def update_bug(bug_id: int, body: BugUpdateRequest):
    """Update bug status, notes, or duplicate_of. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, status FROM bug_reports WHERE id = %s", (bug_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Bug not found")

        updates = ["updated_at = NOW()"]
        params: list = []

        if body.status is not None:
            if body.status not in BUG_STATUSES:
                raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
            updates.append("status = %s")
            params.append(body.status)
            if body.status == "done":
                updates.append("resolved_at = NOW()")

        if body.admin_notes is not None:
            updates.append("admin_notes = %s")
            params.append(body.admin_notes)

        if body.duplicate_of is not None:
            if body.duplicate_of == bug_id:
                raise HTTPException(status_code=400, detail="Cannot mark as duplicate of itself")
            cur.execute("SELECT id FROM bug_reports WHERE id = %s", (body.duplicate_of,))
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail="Duplicate target bug not found")
            updates.append("duplicate_of = %s")
            params.append(body.duplicate_of)
            updates.append("status = 'duplicate'")

        params.append(bug_id)
        cur.execute(
            f"UPDATE bug_reports SET {', '.join(updates)} WHERE id = %s RETURNING *",
            params,
        )
        updated = cur.fetchone()

    result = dict(updated)
    for field in ("created_at", "updated_at", "resolved_at"):
        if result[field]:
            result[field] = result[field].isoformat()
    return result


@router.delete("/bugs/purge")
async def purge_old_bugs(days: int = Query(14, ge=1, le=365)):
    """Delete resolved bugs older than N days. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, screenshot_r2_key, logs_r2_key FROM bug_reports "
            "WHERE status = 'done' AND resolved_at < NOW() - INTERVAL '%s days'",
            (days,),
        )
        rows = cur.fetchall()

        if not rows:
            return {"purged": 0}

        from ...storage import r2_delete_object_global

        for row in rows:
            for key in (row["screenshot_r2_key"], row["logs_r2_key"]):
                if key:
                    r2_delete_object_global(key)

        ids = [r["id"] for r in rows]
        cur.execute(
            "DELETE FROM bug_reports WHERE id = ANY(%s)",
            (ids,),
        )

    return {"purged": len(ids), "bug_ids": ids}


@router.delete("/bugs/{bug_id}")
async def delete_bug(bug_id: int):
    """Delete a bug report and its R2 assets. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, screenshot_r2_key, logs_r2_key FROM bug_reports WHERE id = %s",
            (bug_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bug not found")

        from ...storage import r2_delete_object_global

        for key in (row["screenshot_r2_key"], row["logs_r2_key"]):
            if key:
                r2_delete_object_global(key)

        cur.execute("DELETE FROM bug_reports WHERE id = %s", (bug_id,))

    return {"deleted": bug_id}


@router.get("/bugs/{bug_id}/screenshot")
async def get_bug_screenshot(bug_id: int):
    """Redirect to presigned R2 URL for the bug's screenshot. Admin only."""

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT screenshot_r2_key FROM bug_reports WHERE id = %s", (bug_id,))
        row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Bug not found")
    if not row["screenshot_r2_key"]:
        raise HTTPException(status_code=404, detail="No screenshot for this bug")

    from ...storage import generate_presigned_url_global
    url = generate_presigned_url_global(row["screenshot_r2_key"])
    if not url:
        raise HTTPException(status_code=500, detail="Failed to generate screenshot URL")

    return RedirectResponse(url=url, status_code=307)
