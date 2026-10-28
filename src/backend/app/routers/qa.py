"""
T13810: read-only server truth for the client-side sync checker.

GET /api/qa/sync-state answers, for the ids given, what the DB says about a
project's finished state, using the SAME helpers the list endpoints use (never a
re-implementation, or the probe would lie). The frontend's window.__syncCheck
diffs this against every client holder of the same data.

Always mounted (the user QAs on staging); authenticated by the session
middleware; reads only the caller's own profile DB; logs nothing.
"""
from fastapi import APIRouter

from app.database import get_db_connection
from app.queries import downloads_counts
from app.routers.clips import _get_highlight_instances_by_clip
from app.routers.games import _compute_reel_counts

router = APIRouter(prefix="/api/qa", tags=["qa"])


def _rows(cursor, sql, params=()):
    cursor.execute(sql, params)
    return [dict(r) for r in cursor.fetchall()]


@router.get("/sync-state")
async def sync_state(
    project_id: int | None = None,
    raw_clip_id: int | None = None,
    game_id: int | None = None,
):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        out = {"project": None, "final_videos": [], "raw_clip": None, "highlight_instances": [], "counts": {}}

        if project_id is not None:
            cursor.execute(
                "SELECT id, archived_at, restored_at, final_video_id, is_auto_created, source_raw_clip_id "
                "FROM projects WHERE id = ?", (project_id,))
            row = cursor.fetchone()
            out["final_videos"] = _rows(
                cursor,
                "SELECT id, version, published_at, watched_at, filename FROM final_videos "
                "WHERE project_id = ? ORDER BY version, id", (project_id,))
            if row:
                out["project"] = dict(row)
                # The same two flags GET /api/projects computes per project.
                out["project"]["has_final_video"] = 1 if out["final_videos"] else 0
                out["project"]["is_published"] = 1 if any(v["published_at"] for v in out["final_videos"]) else 0
                if raw_clip_id is None:
                    raw_clip_id = row["source_raw_clip_id"]

        if raw_clip_id is not None:
            cursor.execute(
                "SELECT id, auto_project_id, my_athlete, shared_by FROM raw_clips WHERE id = ?",
                (raw_clip_id,))
            clip = cursor.fetchone()
            if clip:
                out["raw_clip"] = dict(clip)
                out["highlight_instances"] = _get_highlight_instances_by_clip(
                    cursor, [raw_clip_id]).get(raw_clip_id, [])

        counts = downloads_counts(cursor)
        out["counts"] = {
            "downloads_count": counts["count"],
            "downloads_unwatched": counts["unwatched_count"],
            "game_reel_count": (
                _compute_reel_counts(cursor, [game_id]).get(game_id, 0) if game_id is not None else None
            ),
        }
        return out
