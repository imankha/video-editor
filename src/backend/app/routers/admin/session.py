"""Admin session endpoints: GET /me (open to every user) and impersonation (T1510).

Split out of routers/admin.py by T5940; every URL is unchanged."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ...services.auth_db import (
    IMPERSONATION_TTL_MINUTES,
    create_impersonation_session,
    find_or_create_admin_restore_session,
    get_user_by_id,
    invalidate_session,
    is_admin,
    log_impersonation,
    validate_session,
)
from ...storage import APP_ENV
from ...user_context import get_current_user_id
from ...utils.cookies import delete_cookie as _delete_cookie_raw
from ...utils.cookies import set_cookie as _set_cookie_raw
from . import require_admin

logger = logging.getLogger(__name__)

# T4610: `open_router` holds the only two admin routes that are open by design (GET /me,
# POST /impersonate/stop, authorised by the session's impersonator id). main.py includes it
# BEFORE every guarded admin router, or POST /impersonate/stop would match the guarded
# /impersonate/{target_user_id} first. test_t4610_admin_router_guard.py asserts every
# /api/admin route outside that pair carries the guard.
router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
open_router = APIRouter(prefix="/admin", tags=["admin"])


@open_router.get("/me")
# T9130: sync def -> anyio threadpool, off the event loop. is_admin() makes two
# blocking psycopg2 round-trips (auth_db.py); no await in the body. Same flip class
# as T8020's admin_dashboard. See backend-services.md concurrency model.
def admin_me():
    """Check if the current user is an admin. Safe for all users — never 403."""
    user_id = get_current_user_id()
    return {"is_admin": is_admin(user_id), "environment": APP_ENV}



# ---------------------------------------------------------------------------
# T1510: Impersonation
# ---------------------------------------------------------------------------


def _set_session_cookie(response: Response, session_id: str) -> None:
    _set_cookie_raw(response, "rb_session", session_id)


def _clear_machine_pin_cookie(response: Response) -> None:
    """T1190 hook: clear fly_machine_id so the next request re-routes to the
    correct Fly machine for whichever user we are now acting as."""
    _delete_cookie_raw(response, "fly_machine_id")


@open_router.post("/impersonate/stop")
async def stop_impersonation(request: Request, response: Response):
    """Stop impersonating and restore the admin's own session."""
    session_id = request.cookies.get("rb_session")
    sess = validate_session(session_id) if session_id else None

    if not sess or not sess.get("impersonator_user_id"):
        raise HTTPException(status_code=400, detail="not_impersonating")

    admin_id = sess["impersonator_user_id"]
    target_id = sess["user_id"]
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    log_impersonation(admin_id, target_id, "stop", ip, user_agent)

    invalidate_session(session_id)
    restore_sid = find_or_create_admin_restore_session(admin_id)
    _set_session_cookie(response, restore_sid)
    _clear_machine_pin_cookie(response)

    return {"ok": True, "admin_user_id": admin_id}


@router.post("/impersonate/{target_user_id}")
async def impersonate(target_user_id: str, request: Request, response: Response):
    """Start impersonating a target user. Admin only.

    Target user_id comes from the path param only — never from a client store.
    Admin cannot impersonate another admin (privilege laundering).
    """
    admin_id = get_current_user_id()

    if admin_id == target_user_id:
        raise HTTPException(status_code=400, detail="cannot_impersonate_self")

    target = get_user_by_id(target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="target_not_found")

    if is_admin(target_user_id):
        raise HTTPException(
            status_code=403, detail="cannot_impersonate_another_admin"
        )

    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    log_impersonation(admin_id, target_user_id, "start", ip, user_agent)

    session_id = create_impersonation_session(
        target_user_id, admin_id, ttl_minutes=IMPERSONATION_TTL_MINUTES
    )
    _set_session_cookie(response, session_id)
    _clear_machine_pin_cookie(response)

    # T14990: hand the target's resume point (resolved) back so the admin's
    # browser can land there instead of '/' -- read-only, same as the detail
    # panel's read; never writes the target's own point.
    from ...services.resume_points import get_resume_point, resolve_resume_point_titles
    raw_resume_point = get_resume_point(target_user_id)
    resume_point = resolve_resume_point_titles(target_user_id, raw_resume_point) if raw_resume_point else None

    return {
        "ok": True,
        "target_user_id": target_user_id,
        "target_email": target.get("email"),
        "ttl_minutes": IMPERSONATION_TTL_MINUTES,
        "resume_point": resume_point,
    }
