"""
T13810: one `[STATE]` log line after each mutating finished-state gesture.

Every value is READ BACK from the DB at call time (never from the handler's
intent), so a half-applied gesture (e.g. restore nulling published_at before the
archive restore) is visible from the log alone. Chain by req_id with the
middleware's `[REQ] ... profile=` line and the frontend's window.__syncTrace.

Diagnostic only: a failure here is logged at ERROR and never fails the gesture.
"""
import logging

from app.database import get_db_connection
from app.profile_context import get_current_profile_id
from app.queries import downloads_counts
from app.user_context import get_current_req_id, get_current_user_id

logger = logging.getLogger(__name__)


def game_reel_counts(cursor) -> dict:
    """{game_id: published reel count} for every game, via the games list's own helper."""
    from app.routers.games import _compute_reel_counts

    cursor.execute("SELECT id FROM games")
    game_ids = [r["id"] for r in cursor.fetchall()]
    return _compute_reel_counts(cursor, game_ids)


def log_state(gesture: str, project_id: int | None = None, **extra) -> None:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            project = None
            final_videos = []
            auto_for = []
            if project_id is not None:
                cursor.execute(
                    "SELECT archived_at, final_video_id FROM projects WHERE id = ?", (project_id,))
                project = cursor.fetchone()
                cursor.execute(
                    "SELECT id, version, published_at FROM final_videos "
                    "WHERE project_id = ? ORDER BY version, id", (project_id,))
                final_videos = [(r["id"], r["version"], r["published_at"]) for r in cursor.fetchall()]
                cursor.execute("SELECT id FROM raw_clips WHERE auto_project_id = ?", (project_id,))
                auto_for = [r["id"] for r in cursor.fetchall()]
            counts = downloads_counts(cursor)
            reels = game_reel_counts(cursor)
        extras = "".join(f" {k}={v}" for k, v in extra.items())
        logger.info(
            f"[STATE] gesture={gesture} req_id={get_current_req_id()} "
            f"user={get_current_user_id()} profile={get_current_profile_id()} "
            f"project={project_id if project_id is not None else '-'} "
            f"project_row={'present' if project else 'absent'} "
            f"archived_at={project['archived_at'] if project else None} "
            f"final_video_id={project['final_video_id'] if project else None} "
            f"auto_project_id={auto_for} final_videos={final_videos} "
            f"downloads_count={counts['count']} downloads_unwatched={counts['unwatched_count']} "
            f"game_reel_count={','.join(f'{g}:{n}' for g, n in sorted(reels.items())) or '-'}"
            f"{extras}"
        )
    except Exception:
        logger.exception(f"[STATE] gesture={gesture} read-back FAILED project={project_id}")
