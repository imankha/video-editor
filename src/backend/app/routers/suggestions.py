"""
T13210: suggested plays (Veo highlights zip imported onto a game).

Rows live in play_suggestions (v059), never raw_clips, so they stay out of every plays
surface until the rate-to-keep gesture (POST /api/suggestions/{id}/accept) creates a real
play. Every write here traces to one named gesture: Import, Shift all, Rate to keep,
Dismiss/Undo, Remove import. Nothing is reactive.
"""

import json
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.database import get_db_connection
from app.middleware.db_sync import durable_sync
from app.routers.clips import RawClipCreate, _refuse_if_plays_only, save_raw_clip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["suggestions"])

MAX_MOMENTS_PER_IMPORT = 500
MIN_SPAN_S = 0.5


class SuggestedMoment(BaseModel):
    start: float = Field(ge=0)
    end: float
    labels: list[str] = Field(min_length=1)
    # T13245: per-moment form (one Veo clip per game video). Exactly one of this or the
    # body-level video_sequence per request; enforced in import_suggestions.
    video_sequence: int | None = Field(None, ge=1)


class ImportSuggestionsRequest(BaseModel):
    source: Literal["veo_zip"]
    video_sequence: int | None = Field(None, ge=1)
    moments: list[SuggestedMoment] = Field(min_length=1, max_length=MAX_MOMENTS_PER_IMPORT)


class ShiftRequest(BaseModel):
    import_id: str
    delta_s: float


class AcceptRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    name: str = ""
    tags: list[str] = []
    notes: str = ""


class StateRequest(BaseModel):
    state: str


# Every suggestion read joins its video: the row's stamp on the game axis is the video's
# offset + start_time (T13245), so every response carries the offset in one shape.
_SELECT_SUGGESTIONS = (
    "SELECT ps.*, gv.offset_seconds AS video_offset_seconds FROM play_suggestions ps "
    "LEFT JOIN game_videos gv ON gv.game_id = ps.game_id AND gv.sequence = ps.video_sequence"
)


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "import_id": row["import_id"],
        "source": row["source"],
        "video_sequence": row["video_sequence"],
        "start_time": row["start_time"],
        "end_time": row["end_time"],
        "labels": json.loads(row["labels"]),
        "state": row["state"],
        "raw_clip_id": row["raw_clip_id"],
        "video_offset_seconds": row["video_offset_seconds"],
    }


def _require_game(cursor, game_id: int) -> None:
    if not cursor.execute("SELECT 1 FROM games WHERE id = ?", (game_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Game not found")


@router.get("/games/{game_id:int}/suggestions")
async def list_suggestions(game_id: int):
    """Read-only: every suggestion on the game (open, accepted, dismissed), in time order."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        _require_game(cursor, game_id)
        rows = cursor.execute(
            f"{_SELECT_SUGGESTIONS} WHERE ps.game_id = ? ORDER BY ps.video_sequence, ps.start_time, ps.id",
            (game_id,),
        ).fetchall()
    return {"suggestions": [_serialize(r) for r in rows]}


@router.post("/games/{game_id:int}/suggestions")
async def import_suggestions(
    game_id: int,
    body: ImportSuggestionsRequest,
    _durable: None = Depends(durable_sync),
):
    """Import gesture: one batch insert. Idempotent on (game_id, source, video_sequence, start_time, labels):
    re-dropping the same zip adds nothing and returns the existing import_id."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        _require_game(cursor, game_id)
        _refuse_if_plays_only(cursor, game_id)
        if body.video_sequence is not None:
            if any(m.video_sequence is not None for m in body.moments):
                raise HTTPException(
                    status_code=422,
                    detail="Send video_sequence either on the request or on every moment, not both",
                )
            seqs = [body.video_sequence] * len(body.moments)
        else:
            if any(m.video_sequence is None for m in body.moments):
                raise HTTPException(
                    status_code=422,
                    detail="video_sequence is required on the request or on every moment",
                )
            seqs = [m.video_sequence for m in body.moments]
        for m in body.moments:
            if m.end - m.start < MIN_SPAN_S:
                raise HTTPException(status_code=422, detail="Each moment must span at least half a second")
        durations = {}
        for seq in set(seqs):
            video = cursor.execute(
                "SELECT duration FROM game_videos WHERE game_id = ? AND sequence = ?",
                (game_id, seq),
            ).fetchone()
            if not video:
                # Body-level form keeps its historical 404; a per-moment reference is bad input.
                code = 404 if body.video_sequence is not None else 422
                raise HTTPException(status_code=code, detail=f"No video with sequence {seq} for this game")
            durations[seq] = video["duration"]
        for m, seq in zip(body.moments, seqs):
            dur = durations[seq]
            if dur is not None and m.end > dur:
                raise HTTPException(
                    status_code=422,
                    detail=f"Moment runs to {m.end:.0f}s but video {seq} is {dur:.0f}s: wrong video?",
                )

        existing = {
            (r["video_sequence"], r["start_time"], r["labels"]): r["import_id"]
            for r in cursor.execute(
                "SELECT video_sequence, start_time, labels, import_id FROM play_suggestions "
                "WHERE game_id = ? AND source = ?",
                (game_id, body.source),
            ).fetchall()
        }
        import_id = None
        inserted = 0
        new_id = uuid.uuid4().hex
        for m, seq in zip(body.moments, seqs):
            labels_json = json.dumps(m.labels)
            prior = existing.get((seq, m.start, labels_json))
            if prior:
                import_id = import_id or prior
                continue
            cursor.execute(
                "INSERT INTO play_suggestions (game_id, source, import_id, video_sequence, start_time, end_time, labels) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (game_id, body.source, new_id, seq, m.start, m.end, labels_json),
            )
            inserted += 1
        conn.commit()
    logger.info(f"[suggestions] import game={game_id} seqs={sorted(set(seqs))} inserted={inserted}/{len(body.moments)}")
    return {"import_id": import_id if inserted == 0 else new_id, "inserted": inserted}


@router.patch("/games/{game_id:int}/suggestions/shift")
async def shift_import(
    game_id: int,
    body: ShiftRequest,
    _durable: None = Depends(durable_sync),
):
    """Shift-all gesture: one surgical UPDATE of start/end for ONE import's rows."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE play_suggestions SET "
            "start_time = MAX(0, start_time + ?), "
            "end_time = MAX(MAX(0, start_time + ?) + ?, end_time + ?) "
            "WHERE game_id = ? AND import_id = ?",
            (body.delta_s, body.delta_s, MIN_SPAN_S, body.delta_s, game_id, body.import_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Import not found")
        conn.commit()
        rows = cursor.execute(
            f"{_SELECT_SUGGESTIONS} WHERE ps.game_id = ? AND ps.import_id = ? ORDER BY ps.start_time",
            (game_id, body.import_id),
        ).fetchall()
    logger.info(f"[suggestions] shift game={game_id} import={body.import_id} delta={body.delta_s}")
    return {"suggestions": [_serialize(r) for r in rows]}


@router.delete("/games/{game_id:int}/suggestions")
async def remove_import(
    game_id: int,
    import_id: str = Query(...),
    _durable: None = Depends(durable_sync),
):
    """Remove-import gesture. Plays already kept from the import stay (they are real plays)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM play_suggestions WHERE game_id = ? AND import_id = ?", (game_id, import_id)
        )
        removed = cursor.rowcount
        conn.commit()
    logger.info(f"[suggestions] remove game={game_id} import={import_id} rows={removed}")
    return {"removed": removed}


@router.patch("/suggestions/{suggestion_id:int}")
async def set_state(
    suggestion_id: int,
    body: StateRequest,
    _durable: None = Depends(durable_sync),
):
    """Dismiss / Undo gesture. 'accepted' is reachable only through accept_suggestion."""
    if body.state not in ("open", "dismissed"):
        raise HTTPException(status_code=422, detail="state must be 'open' or 'dismissed'")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        row = cursor.execute("SELECT state FROM play_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Suggestion not found")
        if row["state"] == "accepted":
            raise HTTPException(status_code=409, detail="Delete the play to reopen an accepted suggestion")
        cursor.execute("UPDATE play_suggestions SET state = ? WHERE id = ?", (body.state, suggestion_id))
        conn.commit()
    return {"id": suggestion_id, "state": body.state}


@router.post("/suggestions/{suggestion_id:int}/accept")
async def accept_suggestion(
    suggestion_id: int,
    body: AcceptRequest,
    _durable: None = Depends(durable_sync),
):
    """Rate-to-keep gesture: ONE request creates the rated play and links the suggestion.

    The play goes through save_raw_clip itself (single write path for plays: natural-key
    idempotency, plays-only refusal, milestones). That call commits on its own, so the link
    is a second transaction in the same request; a failure between them leaves a play with
    an open suggestion, and a retry heals it because save_raw_clip is idempotent on
    (game_id, end_time, video_sequence).
    """
    with get_db_connection() as conn:
        row = conn.cursor().execute(
            f"{_SELECT_SUGGESTIONS} WHERE ps.id = ?", (suggestion_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if row["state"] == "accepted" and row["raw_clip_id"] is not None:
        return {"raw_clip_id": row["raw_clip_id"], "suggestion": _serialize(row)}

    saved = await save_raw_clip(
        RawClipCreate(
            game_id=row["game_id"],
            start_time=row["start_time"],
            end_time=row["end_time"],
            video_sequence=row["video_sequence"],
            name=body.name,
            rating=body.rating,
            tags=body.tags,
            notes=body.notes,
        ),
        BackgroundTasks(),
        _durable=None,
        client_game_id=None,
    )
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE play_suggestions SET state = 'accepted', raw_clip_id = ? WHERE id = ?",
            (saved.raw_clip_id, suggestion_id),
        )
        conn.commit()
        row = cursor.execute(f"{_SELECT_SUGGESTIONS} WHERE ps.id = ?", (suggestion_id,)).fetchone()
    logger.info(f"[suggestions] accept id={suggestion_id} raw_clip={saved.raw_clip_id}")
    return {"raw_clip_id": saved.raw_clip_id, "suggestion": _serialize(row)}
