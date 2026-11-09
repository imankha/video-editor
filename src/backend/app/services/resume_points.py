"""T14980: the server-held resume point -- one JSONB row per user naming the
page/object they were last on. Written on navigation gestures (surgical,
whole-point UPSERT since it is one datum) and the best-effort exit beacon;
read once as part of GET /api/auth/me.

Postgres only (`user_resume_points`, v047) -- see pg.py's _SCHEMA_DDL comment
for why this is not a user.sqlite write. No R2 sync, no per-user write lock:
the route that calls this is listed in db_sync.SKIP_SYNC_PATHS.
"""

import json
import logging
from datetime import UTC, datetime, timedelta

from app.analytics import BREADCRUMB_SCREENS
from app.services.pg import get_pg

logger = logging.getLogger(__name__)

# Mirrors the frontend EDITOR_MODES home entry ("project-manager" in
# BREADCRUMB_SCREENS) plus the home sub-tabs, which BREADCRUMB_SCREENS does not
# carry (that vocabulary is screens, not tabs).
RESUME_SCREENS = BREADCRUMB_SCREENS

# Closed per-screen sub-step vocabulary (task spec: "mode sub-step when the
# screen has one"). A screen with no entry here records no step.
RESUME_STEPS_BY_SCREEN = {
    "annotate": frozenset({"mark", "review"}),
    "framing": frozenset({"crop", "review", "export"}),
    "overlay": frozenset({"pick", "text", "export"}),
}

RESUME_TABS = frozenset({"games", "reels", "published"})

# Blocking-dialog impression names are open-ended (see analytics.IMPRESSION_KINDS);
# bound the stored slug the same way record_impression bounds its own.
_MAX_DIALOG_LEN = 48
_MAX_PATH_LEN = 300

# Age ceiling the backend also enforces (defense in depth; the client checks too
# per the task spec, but a stale row must not be handed back regardless of who asks).
RESUME_MAX_AGE_DAYS = 30

# Whole-point JSON size cap -- this is one small datum, never a second copy of
# anything, so a point this large is a bug, not a legitimate payload.
_MAX_POINT_BYTES = 2048


def _clean_point(raw: dict) -> dict | None:
    """Validate/bound a client-supplied point against the closed vocabularies.
    Returns None (and logs) if nothing usable survives -- an invalid value is
    DROPPED, never stored, per the "no silent fallback" rule: we don't guess a
    default location, we simply don't record a bad one.
    """
    if not isinstance(raw, dict):
        return None

    path = raw.get("path")
    if not isinstance(path, str) or not path.startswith("/") or len(path) > _MAX_PATH_LEN:
        logger.warning("[ResumePoint] Dropping point with invalid path: %r", path)
        return None

    screen = raw.get("screen")
    if screen is not None and screen not in RESUME_SCREENS:
        logger.warning("[ResumePoint] Dropping unknown screen: %r", screen)
        screen = None

    step = raw.get("step")
    allowed_steps = RESUME_STEPS_BY_SCREEN.get(screen, frozenset())
    if step is not None and step not in allowed_steps:
        step = None

    profile_id = raw.get("profile_id")
    if profile_id is not None and not isinstance(profile_id, str):
        profile_id = None

    t = raw.get("t")
    if not isinstance(t, (int, float)) or isinstance(t, bool) or t < 0:
        t = None

    dialog = raw.get("dialog")
    if dialog is not None:
        if not isinstance(dialog, str) or not dialog:
            dialog = None
        else:
            dialog = dialog[:_MAX_DIALOG_LEN]

    tab = raw.get("tab")
    if tab is not None and tab not in RESUME_TABS:
        tab = None

    build = raw.get("build")
    if not isinstance(build, int) or isinstance(build, bool) or build < 0:
        build = None

    left_at = raw.get("left_at")
    if not isinstance(left_at, str):
        left_at = None

    point = {
        "path": path,
        "profile_id": profile_id,
        "screen": screen,
        "step": step,
        "t": t,
        "dialog": dialog,
        "tab": tab,
        "build": build,
        "left_at": left_at,
    }

    if len(json.dumps(point)) > _MAX_POINT_BYTES:
        logger.warning("[ResumePoint] Dropping oversized point for storage cap")
        return None

    return point


def upsert_resume_point(user_id: str, raw_point: dict) -> bool:
    """Write the whole point in one UPSERT (it is one datum, not a collection --
    "surgical" here means the single row, never a second copy). Returns False
    (writes nothing) when the point fails validation.
    """
    point = _clean_point(raw_point)
    if point is None:
        return False

    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO user_resume_points (user_id, point, updated_at)
            VALUES (%s, %s, now())
            ON CONFLICT (user_id) DO UPDATE
                SET point = EXCLUDED.point, updated_at = now()
            """,
            (user_id, json.dumps(point)),
        )
    return True


def get_resume_point(user_id: str) -> dict | None:
    """Read-only. Returns None when there is no row, or the row is older than
    RESUME_MAX_AGE_DAYS (a stale point is treated as absent, never handed back
    for the client to restore into)."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT point, updated_at FROM user_resume_points WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()

    if not row:
        return None

    updated_at = row["updated_at"]
    if updated_at and updated_at < datetime.now(UTC) - timedelta(days=RESUME_MAX_AGE_DAYS):
        return None

    point = row["point"]
    return json.loads(point) if isinstance(point, str) else point


def delete_resume_point(user_id: str) -> None:
    """Clears the row (deleted account cascades on its own via the FK; this is
    the explicit DELETE path -- used when a restored target 404s, so the stale
    point can't loop)."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM user_resume_points WHERE user_id = %s", (user_id,))
