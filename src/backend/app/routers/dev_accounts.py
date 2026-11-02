"""T11500: dev-only account picker backend.

Every pick creates a BRAND-NEW account (new user_id => new R2 prefix and CAS
baseline, so two stacks/picks can never SYNC_CONFLICT on one object):
  - empty:  a fresh users row; session init (the reload's authenticated
            /api/auth/init, design D1) creates its default profile.
  - upload / full: cloned from a template account by account_clone.

Gating, three layers (copying T4120 test_seams): main._mount_dev_only_routers
mounts this router only when storage._test_seams_enabled(); every handler
re-checks first and 404s before any side effect; the frontend only calls it in
import.meta.env.DEV. Mounted under the already-allowlisted /api/auth/ prefix so a
logged-out caller reaches routing (prod/staging answer a true 404, not 401).

Both handlers are plain `def` (blocking PG + R2 run in the threadpool).
No SQLite writes happen here (D1).
"""
import logging
import os
import re
from datetime import UTC, datetime
from enum import Enum

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import storage
from app.services import account_clone, auth_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/dev-accounts", tags=["dev-accounts"])


class DevAccountPreset(str, Enum):
    EMPTY = "empty"
    UPLOAD = "upload"
    FULL = "full"


TEMPLATE_EMAILS: dict[DevAccountPreset, str] = {
    DevAccountPreset.UPLOAD: "dev-template+upload@reelballers.local",
    DevAccountPreset.FULL: "dev-template+full@reelballers.local",
}

_PRESET_INFO = {
    DevAccountPreset.EMPTY: ("Empty account", "A brand-new user: no games, no clips."),
    DevAccountPreset.UPLOAD: ("Just an upload", "One ready uploaded game. No annotations, no projects."),
    DevAccountPreset.FULL: (
        "Full account",
        "Two profiles; a game with ~6 plays; clips in Framing, Spotlight and finished.",
    ),
}

_STACK_ID_RE = re.compile(r"^[a-z0-9._-]+$")
BUILD_TEMPLATES_HINT = "templates not built: run scripts/build_dev_account_templates.py"


def _require_dev_accounts_enabled() -> None:
    """Layer 2 of the prod-impossibility gate: 404 before any side effect."""
    if not storage._test_seams_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def current_stack_id() -> str:
    stack = os.getenv("DEV_STACK_ID") or "host"
    if not _STACK_ID_RE.match(stack):
        raise HTTPException(status_code=500, detail=f"invalid DEV_STACK_ID {stack!r}: must match [a-z0-9._-]+")
    return stack


def dev_account_email(preset: DevAccountPreset, stack_id: str, now: datetime, user_id: str) -> str:
    """dev+<preset>+<stack>+<yyyymmddThhmmss>-<6hex>@reelballers.local (design D8)."""
    return (
        f"dev+{preset.value}+{stack_id}+{now.strftime('%Y%m%dT%H%M%S')}"
        f"-{user_id.replace('-', '')[:6]}@reelballers.local"
    )


def _template_row(preset: DevAccountPreset) -> dict | None:
    return auth_db.get_user_by_email(TEMPLATE_EMAILS[preset])


@router.get("")
def list_dev_accounts() -> dict:
    _require_dev_accounts_enabled()
    presets = []
    for preset in DevAccountPreset:
        label, description = _PRESET_INFO[preset]
        available, reason = True, None
        if preset is not DevAccountPreset.EMPTY:
            if not storage.R2_ENABLED:
                available, reason = False, "R2 disabled on this backend"
            elif _template_row(preset) is None:
                available, reason = False, BUILD_TEMPLATES_HINT
        presets.append({
            "id": preset.value, "label": label, "description": description,
            "available": available, "unavailable_reason": reason,
        })
    return {"stack_id": current_stack_id(), "presets": presets}


@router.post("/{preset}")
def create_dev_account(preset: DevAccountPreset) -> JSONResponse:
    _require_dev_accounts_enabled()
    # Imported here: auth.py is heavy and only the cookie helper is needed.
    from app.routers.auth import _issue_session_cookie

    stack = current_stack_id()
    user_id = auth_db.generate_user_id()
    now = datetime.now(UTC)
    email = dev_account_email(preset, stack, now, user_id)
    objects = 0
    seconds = 0.0

    if preset is DevAccountPreset.EMPTY:
        auth_db.create_user(user_id, email=email, verified_at=now.isoformat(), is_test_account=True)
    else:
        if not storage.R2_ENABLED:
            return JSONResponse(
                status_code=409,
                content={"code": "r2_disabled", "detail": "R2 disabled on this backend; clone presets need R2"},
            )
        template = _template_row(preset)
        if template is None:
            return JSONResponse(
                status_code=409, content={"code": "template_missing", "detail": BUILD_TEMPLATES_HINT},
            )
        try:
            result = account_clone.clone_account_for_dev(
                r2=storage.get_r2_client(), bucket=storage.R2_BUCKET, env=storage.APP_ENV,
                template_user_id=template["user_id"], new_user_id=user_id, new_email=email,
            )
        except account_clone.AccountCloneError as e:
            logger.critical(f"[DevAccounts] clone failed preset={preset.value} reason={e.reason}: {e}")
            return JSONResponse(
                status_code=500,
                content={"code": "clone_failed", "detail": str(e), "reason": e.reason},
            )
        objects, seconds = result.objects_copied, result.seconds

    logger.info(
        f"[DevAccounts] preset={preset.value} stack={stack} user_id={user_id} "
        f"objects={objects} seconds={seconds:.2f}"
    )
    return _issue_session_cookie(
        user_id, {"user_id": user_id, "email": email, "preset": preset.value, "dev_account": True}
    )
